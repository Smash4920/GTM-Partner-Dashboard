import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger, logger, type LogRecord } from './logging';
import { createTraceContext, traceProviderRequest } from './tracing';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createTraceContext', () => {
  it('creates valid W3C propagation headers and a request id', () => {
    const context = createTraceContext();

    expect(context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(context.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(context.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(context.headers).toEqual({
      traceparent: `00-${context.traceId}-${context.spanId}-01`,
      'x-request-id': context.requestId,
    });
  });

  it('creates a child span without breaking cross-system correlation', () => {
    const parent = createTraceContext();
    const child = createTraceContext(parent);

    expect(child.traceId).toBe(parent.traceId);
    expect(child.requestId).toBe(parent.requestId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(child.spanId).not.toBe(parent.spanId);
    expect(child.headers.traceparent).toBe(`00-${parent.traceId}-${child.spanId}-01`);
  });
});

describe('traceProviderRequest', () => {
  it('passes propagation context to the provider and correlates its logs', async () => {
    const records: LogRecord[] = [];
    const testLogger = createLogger({ level: 'debug', sink: (record) => records.push(record) });
    vi.spyOn(logger, 'child').mockImplementation((fields) => testLogger.child(fields));

    let seenTraceId = '';
    await traceProviderRequest('getForecastSummary', async (context) => {
      seenTraceId = context.traceId;
      return 'answer';
    });

    expect(records.map((record) => record.msg)).toEqual([
      'Provider request started',
      'Provider request completed',
    ]);
    expect(records.every((record) => record.traceId === seenTraceId)).toBe(true);
    expect(records[0]).toMatchObject({
      operation: 'getForecastSummary',
      requestId: expect.any(String),
      spanId: expect.any(String),
    });
  });

  it('logs and rethrows provider failures', async () => {
    const records: LogRecord[] = [];
    const testLogger = createLogger({ level: 'debug', sink: (record) => records.push(record) });
    vi.spyOn(logger, 'child').mockImplementation((fields) => testLogger.child(fields));
    const failure = new Error('upstream unavailable');

    await expect(
      traceProviderRequest('listPartners', async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);

    expect(records.at(-1)).toMatchObject({
      level: 'error',
      msg: 'Provider request failed',
      operation: 'listPartners',
      error: { name: 'Error', message: 'upstream unavailable' },
    });
  });
});
