import { describe, expect, it } from 'vitest';
import {
  allowlistEnvelope,
  allowlistEventProperties,
  ANALYTICS_EVENT_PROPERTIES,
} from './allowlist';

/**
 * Adversarial values that must never survive the boundary, whatever field a
 * caller smuggles them into: a person's name and address, a secret, customer
 * prose, a raw error message and stack, and a query-bearing URL.
 */
const SENTINELS = [
  'Dana Example',
  'dana@corp.example',
  'Acme Rocket Partners',
  'sk-live-777',
  'call Dana about the renewal',
  'Cannot read properties of undefined',
  '?token=secret',
];

function expectNoSentinels(payload: unknown): void {
  const serialized = JSON.stringify(payload);
  for (const sentinel of SENTINELS) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe('allowlistEnvelope', () => {
  it('keeps only registered log fields, dropping prose, errors, secrets, and business values', () => {
    const filtered = allowlistEnvelope('log', {
      time: '2026-09-29T00:00:00.000Z',
      level: 'error',
      msg: 'Provider request failed',
      component: 'DataProvider',
      operation: 'getForecastSummary',
      durationMs: 42,
      error: { name: 'Error', message: SENTINELS[5], stack: `stack ${SENTINELS[1]}` },
      name: SENTINELS[0],
      email: SENTINELS[1],
      revenue: 500_000,
      title: SENTINELS[4],
      inventedField: SENTINELS[3],
    });

    expect(filtered).toEqual({
      time: '2026-09-29T00:00:00.000Z',
      level: 'error',
      msg: 'Provider request failed',
      component: 'DataProvider',
      operation: 'getForecastSummary',
      durationMs: 42,
    });
    expectNoSentinels(filtered);
  });

  it('keeps registered metric fields and drops unknown attribute keys', () => {
    const filtered = allowlistEnvelope('metric', {
      kind: 'counter',
      name: 'provider.call',
      attributes: { method: 'getTargets', status: 'ok', note: SENTINELS[4], smuggled: 1 },
      delta: 3,
      reason: SENTINELS[5],
    });

    expect(filtered).toEqual({
      kind: 'counter',
      name: 'provider.call',
      attributes: { method: 'getTargets', status: 'ok' },
      delta: 3,
    });
    expectNoSentinels(filtered);
  });

  it('keeps registered span fields and drops unregistered span attributes', () => {
    const filtered = allowlistEnvelope('trace', {
      name: 'provider.listPartners',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      parentSpanId: '0011223344556677',
      traceFlags: '01',
      status: 'error',
      startedAt: 1,
      endedAt: 13,
      durationMs: 12,
      attributes: { providerId: 'local', method: 'listPartners', partner: SENTINELS[2] },
      responseBody: [{ account: SENTINELS[2] }],
    });

    expect(filtered).toEqual({
      name: 'provider.listPartners',
      traceId: '0af7651916cd43dd8448eb211c80319c',
      spanId: 'b7ad6b7169203331',
      parentSpanId: '0011223344556677',
      traceFlags: '01',
      status: 'error',
      startedAt: 1,
      endedAt: 13,
      durationMs: 12,
      attributes: { providerId: 'local', method: 'listPartners' },
    });
    expectNoSentinels(filtered);
  });

  it('rejects unregistered analytics events outright', () => {
    expect(allowlistEnvelope('event', { event: 'page_scrolled', properties: {} })).toBeNull();
    expect(allowlistEnvelope('event', { event: 42, properties: {} })).toBeNull();
  });

  it('keeps only the properties registered for each analytics event', () => {
    for (const [event, keys] of ANALYTICS_EVENT_PROPERTIES) {
      const registered = Object.fromEntries(keys.map((key, index) => [key, `value-${index}`]));
      const filtered = allowlistEnvelope('event', {
        event,
        properties: { ...registered, smuggled: SENTINELS[3], note: SENTINELS[4] },
      });

      expect(filtered).toEqual({ event, properties: registered });
      expectNoSentinels(filtered);
    }
  });

  it('treats missing or malformed event properties as empty rather than failing', () => {
    expect(allowlistEnvelope('event', { event: 'route_view' })).toEqual({
      event: 'route_view',
      properties: {},
    });
    expect(allowlistEnvelope('event', { event: 'route_view', properties: 'junk' })).toEqual({
      event: 'route_view',
      properties: {},
    });
  });

  it('ships errors as a technical classification with no message, stack, or breadcrumbs', () => {
    const filtered = allowlistEnvelope('error', {
      name: 'TypeError',
      fingerprint: '1c3a5e7f',
      category: 'provider',
      severity: 'warning',
      route: 'forecasting',
      providerId: 'remote',
      message: SENTINELS[5],
      stack: `at openPipeline ${SENTINELS[1]}`,
      breadcrumbs: [{ message: SENTINELS[4] }],
      userAgent: 'jsdom',
      context: { componentStack: SENTINELS[0] },
    });

    expect(filtered).toEqual({
      name: 'TypeError',
      fingerprint: '1c3a5e7f',
      category: 'provider',
      severity: 'warning',
      route: 'forecasting',
      providerId: 'remote',
    });
    expectNoSentinels(filtered);
  });

  it('ships alerts keyed and counted, with prose titles and summaries kept local', () => {
    const filtered = allowlistEnvelope('alert', {
      id: 'abc123',
      key: 'error:1c3a5e7f',
      severity: 'critical',
      suppressed: 2,
      timestamp: '2026-09-29T00:00:00.000Z',
      release: '9f2c1ab',
      environment: 'production',
      sessionId: '0af7651916cd43dd8448eb211c80319c',
      title: SENTINELS[4],
      summary: `${SENTINELS[0]} hit ${SENTINELS[5]}`,
      detail: {
        fingerprint: '1c3a5e7f',
        category: 'render',
        route: 'forecasting',
        providerId: 'remote',
        sessionCount: 3,
        reason: SENTINELS[5],
        endpoint: `https://collector.test/ingest${SENTINELS[6]}`,
      },
    });

    expect(filtered).toEqual({
      id: 'abc123',
      key: 'error:1c3a5e7f',
      severity: 'critical',
      suppressed: 2,
      timestamp: '2026-09-29T00:00:00.000Z',
      release: '9f2c1ab',
      environment: 'production',
      sessionId: '0af7651916cd43dd8448eb211c80319c',
      detail: {
        fingerprint: '1c3a5e7f',
        category: 'render',
        route: 'forecasting',
        providerId: 'remote',
        sessionCount: 3,
      },
    });
    expectNoSentinels(filtered);
  });

  it('ships health checks without their free-text detail lines', () => {
    const filtered = allowlistEnvelope('health', {
      status: 'degraded',
      service: 'gtm-partner-dashboard',
      release: '9f2c1ab',
      environment: 'production',
      sessionId: '0af7651916cd43dd8448eb211c80319c',
      route: 'home',
      providerId: 'local',
      generatedAt: '2026-09-29T00:00:00.000Z',
      uptimeMs: 1200,
      checks: [
        { name: 'dataSeam', status: 'unavailable', latencyMs: 10_001, detail: SENTINELS[5] },
        { name: 'flags', status: 'ok', detail: SENTINELS[4] },
        'not-a-check',
      ],
    });

    expect(filtered).toEqual({
      status: 'degraded',
      service: 'gtm-partner-dashboard',
      release: '9f2c1ab',
      environment: 'production',
      sessionId: '0af7651916cd43dd8448eb211c80319c',
      route: 'home',
      providerId: 'local',
      generatedAt: '2026-09-29T00:00:00.000Z',
      uptimeMs: 1200,
      checks: [
        { name: 'dataSeam', status: 'unavailable', latencyMs: 10_001 },
        { name: 'flags', status: 'ok' },
      ],
    });
    expectNoSentinels(filtered);
  });

  it('drops nulls, objects, and mixed arrays down to technical values', () => {
    const filtered = allowlistEnvelope('log', {
      msg: 'static message',
      route: null,
      durationMs: Number.NaN,
      channels: ['email', { smuggled: SENTINELS[3] }, 'slack'],
    });

    expect(filtered).toEqual({ msg: 'static message', channels: ['email', 'slack'] });
    expectNoSentinels(filtered);
  });
});

describe('allowlistEventProperties', () => {
  it('returns null for unregistered events and filtered properties otherwise', () => {
    expect(allowlistEventProperties('not_an_event', {})).toBeNull();
    expect(
      allowlistEventProperties('notification_sent', {
        kind: 'registration-approved',
        channels: ['email'],
        body: SENTINELS[4],
      }),
    ).toEqual({ kind: 'registration-approved', channels: ['email'] });
  });
});
