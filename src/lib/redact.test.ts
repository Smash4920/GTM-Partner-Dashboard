import { describe, expect, it } from 'vitest';
import { createLogger, type LogRecord, type LogSink } from './logging';
import { maskEmailsInString, REDACTED, redactRecord, scrubbingSink } from './redact';

describe('redactRecord', () => {
  it('replaces credential-shaped fields wherever they sit, and keeps the rest', () => {
    const scrubbed = redactRecord({
      component: 'App',
      opportunityId: 'opp-0007',
      apiKey: 'placeholder-secret',
      session: { token: 'abc', expiresAt: '2026-09-18' },
      note: 'shared by dana@corp.example in the QBR',
    });

    expect(scrubbed.component).toBe('App');
    expect(scrubbed.opportunityId).toBe('opp-0007');
    expect(scrubbed.apiKey).toBe(REDACTED);
    expect(scrubbed.session).toEqual({ token: REDACTED, expiresAt: '2026-09-18' });
    expect(scrubbed.note).toBe('shared by d***@corp.example in the QBR');
  });

  it('matches compound and differently-cased key spellings', () => {
    const scrubbed = redactRecord({
      userEmail: 'dana@corp.example',
      'x-api-key': 'k',
      refreshToken: 't',
      authorizationCode: 12345,
    });

    expect(scrubbed.userEmail).toBe(REDACTED);
    expect(scrubbed['x-api-key']).toBe(REDACTED);
    expect(scrubbed.refreshToken).toBe(REDACTED);
    expect(scrubbed.authorizationCode).toBe(REDACTED);
  });

  it('redacts the whole value, not the interesting characters, for sensitive keys', () => {
    const scrubbed = redactRecord({
      credentials: [{ password: 'hunter2', email: 'dana@corp.example' }],
    });

    expect(scrubbed.credentials).toBe(REDACTED);
  });

  it('walks nested collections under ordinary keys without flattening them', () => {
    const scrubbed = redactRecord({
      channels: ['email', 'slack'],
      owner: { name: 'Dana', contact: { email: 'dana@corp.example' } },
    });

    expect(scrubbed.channels).toEqual(['email', 'slack']);
    expect(scrubbed.owner).toEqual({ name: 'Dana', contact: { email: REDACTED } });
  });

  it('keeps error diagnostics but masks addresses inside message and stack', () => {
    const failure = new Error('invite for dana@corp.example bounced');
    const scrubbed = redactRecord({ error: failure });

    const fields = scrubbed.error as { name: string; message: string };
    expect(fields.name).toBe('Error');
    expect(fields.message).toBe('invite for d***@corp.example bounced');
  });

  it('survives circular references and cuts off runaway depth', () => {
    const context: Record<string, unknown> = { nested: 'leaf' };
    context.self = context;
    let deep: Record<string, unknown> = { marker: true };
    for (let level = 0; level < 8; level += 1) {
      deep = { next: deep };
    }

    const scrubbed = redactRecord({ circular: context, deep });

    expect(JSON.stringify(scrubbed.circular)).toContain('[circular]');
    expect(JSON.stringify(scrubbed.deep)).toContain('[truncated object]');
    expect(JSON.stringify(scrubbed.deep)).not.toContain('marker');
  });

  it('handles dates, deep arrays, and undefined fields the way a record carries them', () => {
    let deepArray: unknown[] = ['bottom'];
    for (let level = 0; level < 8; level += 1) {
      deepArray = [deepArray];
    }

    const scrubbed = redactRecord({
      reviewedAt: new Date('2026-09-18T00:00:00Z'),
      matrix: deepArray,
      pendingField: undefined,
      owner: 'ops',
    });

    expect(scrubbed.reviewedAt).toBe('2026-09-18T00:00:00.000Z');
    expect(JSON.stringify(scrubbed.matrix)).toContain('[truncated array]');
    expect('pendingField' in scrubbed).toBe(false);
    expect(scrubbed.owner).toBe('ops');
  });

  it('does not mutate the record it was handed', () => {
    const record = { apiKey: 'placeholder-secret', stage: 'discovery' };

    redactRecord(record);

    expect(record.apiKey).toBe('placeholder-secret');
  });
});

describe('maskEmailsInString', () => {
  it('masks the local part and keeps the domain', () => {
    expect(maskEmailsInString('dana@corp.example')).toBe('d***@corp.example');
    expect(maskEmailsInString('cc ops+deal@corp.example now')).toBe('cc o***@corp.example now');
    expect(maskEmailsInString('no address here')).toBe('no address here');
  });
});

describe('scrubbingSink', () => {
  it('hands the wrapped sink redacted records and leaves other sinks alone', () => {
    const shipped: LogRecord[] = [];
    const shippedSink: LogSink = (record) => {
      shipped.push(record);
    };
    const local: LogRecord[] = [];
    const localSink: LogSink = (record) => {
      local.push(record);
    };
    const log = createLogger({
      sink: localSink,
      fields: { component: 'TeamAccessPanel' },
    });
    const shipSink = scrubbingSink(shippedSink);
    shipSink({ time: 't', level: 'warn', msg: 'Invite failed', email: 'dana@corp.example' });

    expect(shipped[0]).toMatchObject({ msg: 'Invite failed', email: REDACTED });
    expect(local).toHaveLength(0);

    // The console-style sink keeps what it is handed: redaction belongs to the
    // boundary, not to the developer's own console.
    log.warn('kept', { apiKey: 'k' });
    expect(local[0]).toMatchObject({ apiKey: 'k' });
  });
});
