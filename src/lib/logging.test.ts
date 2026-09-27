import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LOG_LEVELS,
  consoleSink,
  createLogger,
  isLogLevel,
  type LogContext,
  type LogLevel,
  type LogRecord,
  type LogSink,
} from './logging';

/** A sink that keeps what it is handed so assertions can read the records. */
function capture(): { records: LogRecord[]; sink: LogSink } {
  const records: LogRecord[] = [];
  const sink: LogSink = (record) => {
    records.push(record);
  };
  return { records, sink };
}

function lastRecord(records: LogRecord[]): LogRecord {
  if (records.length === 0) throw new Error('no record was emitted');
  return records[records.length - 1];
}

describe('createLogger', () => {
  it('emits one flat record per event, envelope plus context', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink, fields: { component: 'test' } });

    log.warn('Deal reg SLA lapsed', { registrationId: 'reg-0001', overdueDays: 4 });

    expect(records).toHaveLength(1);
    const entry = records[0];
    expect(entry.level).toBe('warn');
    expect(entry.msg).toBe('Deal reg SLA lapsed');
    expect(entry.registrationId).toBe('reg-0001');
    expect(entry.overdueDays).toBe(4);
    expect(entry.component).toBe('test');
    expect(Number.isNaN(Date.parse(entry.time))).toBe(false);
  });

  it('keeps the envelope when context reuses its field names', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink });

    log.info('real message', { msg: 'decoy', level: 'error', time: 'not a time' });

    const entry = lastRecord(records);
    expect(entry.msg).toBe('real message');
    expect(entry.level).toBe('info');
    expect(entry.time).not.toBe('not a time');
  });

  it('drops records below the configured level', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink, level: 'warn' });

    log.debug('below the bar');
    log.info('still below the bar');
    log.warn('kept');
    log.error('kept too');

    expect(records.map((entry) => entry.level)).toEqual(['warn', 'error']);
  });

  it('retargets existing loggers, children included, through setLevel', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink, level: 'error' });
    const childLog = log.child({ component: 'child' });

    log.warn('suppressed');
    childLog.warn('suppressed in the child too');
    log.setLevel('debug');
    childLog.debug('through the shared state');

    expect(records).toHaveLength(1);
    expect(lastRecord(records).component).toBe('child');
  });

  it('carries child fields on every record and lets call-site context win', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink, fields: { component: 'parent' } });
    const childLog = log.child({ component: 'child', view: 'forecasting' });

    childLog.info('edited', { view: 'partner' });
    log.info('parent log');

    expect(records[0]).toMatchObject({ component: 'child', view: 'partner' });
    expect(records[1]).toMatchObject({ component: 'parent' });
  });

  it('merges fields all the way down a chain of children', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink }).child({ a: 1 }).child({ b: 2 });

    log.debug('deep child');

    expect(lastRecord(records)).toMatchObject({ a: 1, b: 2 });
  });
});

describe('record serialization', () => {
  it('serializes an Error to name, message, and stack, and follows the cause chain', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink });
    const cause = new Error('the CRM call timed out');
    const error = new Error('Failed to load dashboard data', { cause });

    log.error('Failed to load dashboard data', { error });

    expect(lastRecord(records).error).toMatchObject({
      name: 'Error',
      message: 'Failed to load dashboard data',
    });
    const fields = lastRecord(records).error as { stack: string; cause: { message: string } };
    expect(fields.stack).toEqual(expect.any(String));
    expect(fields.cause.message).toBe('the CRM call timed out');
  });

  it('drops undefined context fields and keeps the rest', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink });

    log.info('partial', { registrationId: undefined, opportunityId: 'opp-042' });

    const entry = lastRecord(records);
    expect('registrationId' in entry).toBe(false);
    expect(entry.opportunityId).toBe('opp-042');
  });

  it('writes dates as ISO strings and functions as labeled placeholders', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink });

    log.debug('shapes', { sentAt: new Date('2026-09-18T00:00:00Z'), hook: function namedHook() {} });

    const entry = lastRecord(records);
    expect(entry.sentAt).toBe('2026-09-18T00:00:00.000Z');
    expect(entry.hook).toBe('[function namedHook]');
  });

  it('survives circular references instead of throwing', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink });
    const node: LogContext = { id: 'n-1' };
    node.self = node;

    log.warn('circular', { node });

    expect(lastRecord(records).node).toEqual({ id: 'n-1', self: '[circular]' });
  });

  it('cuts off nesting deeper than the serialization limit', () => {
    const { records, sink } = capture();
    const log = createLogger({ sink });
    let deep: LogContext = { leaf: true };
    for (let i = 0; i < 6; i += 1) {
      deep = { child: deep };
    }

    log.info('deep', { deep });

    const serialized = JSON.stringify(lastRecord(records).deep);
    expect(serialized).toContain('[truncated object]');
    expect(serialized).not.toContain('leaf');
  });
});

describe('consoleSink', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes each record to the console method matching its level', () => {
    const spies: Record<LogLevel, ReturnType<typeof vi.spyOn>> = {
      debug: vi.spyOn(console, 'debug').mockImplementation(() => {}),
      info: vi.spyOn(console, 'info').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    const sample: Record<LogLevel, LogRecord> = {
      debug: { time: 't', level: 'debug', msg: 'd' },
      info: { time: 't', level: 'info', msg: 'i' },
      warn: { time: 't', level: 'warn', msg: 'w' },
      error: { time: 't', level: 'error', msg: 'e' },
    };

    for (const level of LOG_LEVELS) {
      consoleSink(sample[level]);
    }

    for (const level of LOG_LEVELS) {
      expect(spies[level]).toHaveBeenCalledTimes(1);
      expect(spies[level]).toHaveBeenCalledWith(sample[level]);
    }
    expect(spies.debug).not.toHaveBeenCalledWith(sample.info);
  });
});

describe('isLogLevel', () => {
  it('accepts the four levels and rejects everything else', () => {
    for (const level of LOG_LEVELS) {
      expect(isLogLevel(level)).toBe(true);
    }
    for (const value of ['trace', 'verbose', '', undefined, 3, null]) {
      expect(isLogLevel(value)).toBe(false);
    }
  });
});
