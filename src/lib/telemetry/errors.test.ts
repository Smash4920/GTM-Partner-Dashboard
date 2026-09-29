import { describe, expect, it, vi } from 'vitest';
import { createErrorTracker, fingerprintError, type Breadcrumb, type ErrorInsight } from './errors';
import { MetricsRegistry } from './metrics';
import type { AlertInput } from './alerts';

function tracker(
  tuning: {
    maxBreadcrumbs?: number;
    maxFingerprints?: number;
    now?: () => number;
    raiseAlert?: (input: AlertInput) => void;
  } = {},
) {
  const envelopes: Array<{ data: Record<string, unknown>; traceparent?: string }> = [];
  const alerts: AlertInput[] = [];
  const metrics = new MetricsRegistry();
  const defaults = {
    getContext: () => ({ route: 'forecasting', providerId: 'remote' }),
    metrics,
    onEnvelope: (data: Record<string, unknown>, traceparent?: string) => {
      envelopes.push({ data, traceparent });
    },
    raiseAlert: (input: AlertInput) => {
      alerts.push(input);
    },
  };
  const client = createErrorTracker({ ...defaults, ...tuning });
  return { client, envelopes, alerts, metrics };
}

describe('fingerprintError', () => {
  const stack = [
    'TypeError: Cannot read properties of undefined',
    '    at openPipeline (https://cdn.test/assets/index-9f2c.js:1:2345)',
    '    at getForecastSummary (https://cdn.test/assets/index-9f2c.js:2:98)',
  ].join('\n');

  it('groups the same defect across line-number drift and minified renames', () => {
    const renumbered = stack.replace('1:2345', '1:9999');

    expect(fingerprintError('TypeError', 'boom', stack)).toBe(
      fingerprintError('TypeError', 'boom', renumbered),
    );
  });

  it('separates defects by name and by shape', () => {
    expect(fingerprintError('TypeError', 'boom', stack)).not.toBe(
      fingerprintError('RangeError', 'boom', stack),
    );
    expect(fingerprintError('TypeError', 'boom', stack)).not.toBe(
      fingerprintError(
        'TypeError',
        'boom',
        `${stack}\n    at render (https://cdn.test/assets/index-9f2c.js:3:1)`,
      ),
    );
  });

  it('falls back to name and message when there is no stack', () => {
    expect(fingerprintError('Error', 'CRM is down')).toBe(fingerprintError('Error', 'CRM is down'));
    expect(fingerprintError('Error', 'CRM is down')).not.toBe(
      fingerprintError('Error', 'CRM is up'),
    );
    expect(fingerprintError('Error', 'x')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('createErrorTracker capture', () => {
  it('sends one critical envelope with the technical classification only, and alerts by fingerprint', () => {
    const { client, envelopes, alerts } = tracker();
    const failure = new TypeError('Cannot read properties of undefined');

    const record = client.capture(failure, {
      category: 'render',
      severity: 'critical',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    });

    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.traceparent).toBe(
      '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    );
    // The envelope is the exact registered shape (VAL-SEC-004): class,
    // fingerprint, category, severity, route, provider — and nothing else.
    // The raw message, stack, breadcrumbs, and user agent never leave.
    expect(envelopes[0]?.data).toEqual({
      name: 'TypeError',
      fingerprint: record.fingerprint,
      category: 'render',
      severity: 'critical',
      route: 'forecasting',
      providerId: 'remote',
    });
    expect(JSON.stringify(envelopes[0]?.data)).not.toContain('Cannot read properties of undefined');
    expect(alerts[0]).toMatchObject({
      key: `error:${record.fingerprint}`,
      severity: 'critical',
      title: 'TypeError in render',
    });
    // The alert text carries no raw error prose either.
    expect(alerts[0]?.summary).not.toContain('Cannot read properties of undefined');
    expect(alerts[0]?.summary).toContain(record.fingerprint);
  });

  it('normalizes things that were thrown without being Errors', () => {
    const { client, envelopes, alerts } = tracker();

    client.capture('registration queue desynced');

    expect(envelopes[0]?.data).toMatchObject({ name: 'Error' });
    expect(envelopes[0]?.data).not.toHaveProperty('message');
    // The message survives in the local insight, never in the envelope.
    expect(client.insights()[0]?.message).toBe('registration queue desynced');
    expect(alerts[0]?.severity).toBe('warning');
  });

  it('labels whatever a rejecting promise actually carried, not a guessed name', () => {
    const { client, envelopes } = tracker();

    client.capture({ weird: true });

    expect(envelopes[0]?.data).toMatchObject({ name: 'object' });
    expect(envelopes[0]?.data).not.toHaveProperty('message');
  });

  it('exposes the breadcrumb ring for inspection, newest last', () => {
    const { client } = tracker();

    client.addBreadcrumb('Route changed', { route: 'partner-view' });
    client.addBreadcrumb('Provider selected', { providerId: 'remote' });

    const trail = client.breadcrumbs();
    expect(trail.map((crumb) => crumb.message)).toEqual(['Route changed', 'Provider selected']);
    expect(trail[0]?.data).toEqual({ route: 'partner-view' });
  });

  it('keeps an info capture from de-escalating a warning already on record', () => {
    const { client } = tracker();

    client.capture(new Error('loud failure'), { severity: 'warning' });
    client.capture(new Error('loud failure'), { severity: 'info' });

    expect(client.insights()[0]?.severity).toBe('warning');
  });

  it('aggregates repeat captures under one fingerprint with escalating severity', () => {
    const { client } = tracker();

    const first = client.capture(new Error('transient'), { severity: 'warning' });
    client.capture(new Error('transient'), { severity: 'warning' });
    const third = client.capture(new Error('transient'), { severity: 'critical' });

    expect(third.fingerprint).toBe(first.fingerprint);
    expect(third.count).toBe(3);
    const insight = client
      .insights()
      .find((candidate: ErrorInsight) => candidate.fingerprint === first.fingerprint);
    expect(insight).toMatchObject({ count: 3, severity: 'critical' });
    expect(insight?.firstSeenAt).toBeLessThanOrEqual(insight?.lastSeenAt ?? 0);
  });

  it('keeps the breadcrumb trail local: captured for insights, never on the envelope', () => {
    const { client, envelopes } = tracker();

    client.addBreadcrumb('Route changed', { route: 'forecasting' });
    client.addBreadcrumb('provider.getForecastSummary failed');
    client.capture(new Error('widget render failed'));

    const trail = client.breadcrumbs();
    expect(trail.map((crumb: Breadcrumb) => crumb.message)).toEqual([
      'Route changed',
      'provider.getForecastSummary failed',
    ]);
    expect(envelopes[0]?.data).not.toHaveProperty('breadcrumbs');
  });

  it('keeps only the most recent breadcrumbs', () => {
    const { client, envelopes } = tracker({ maxBreadcrumbs: 2 });

    client.addBreadcrumb('first');
    client.addBreadcrumb('second');
    client.addBreadcrumb('third');
    client.capture(new Error('boom'));

    const trail = client.breadcrumbs();
    expect(trail.map((crumb: Breadcrumb) => crumb.message)).toEqual(['second', 'third']);
    expect(envelopes[0]?.data).not.toHaveProperty('breadcrumbs');
  });

  it('counts errors inside a trailing window and drops the old ones', () => {
    const { client } = tracker({
      now: (() => {
        let at = 0;
        return () => (at += 1_000);
      })(),
    });

    client.capture(new Error('early one'));
    client.capture(new Error('recent one'));
    client.capture(new Error('recent two'));

    expect(client.recentErrorCount(2_500)).toBe(2);
    expect(client.recentErrorCount(60_000)).toBe(3);
  });

  it('records each capture as a metric the health check can read', () => {
    const { client, metrics } = tracker();

    client.capture(new Error('one'), { category: 'provider' });
    client.capture(new Error('two'), { category: 'provider' });

    expect(metrics.counterTotal('telemetry.error')).toBe(2);
  });

  it('bounds the fingerprint table by forgetting the least recently seen defect', () => {
    const { client } = tracker({
      maxFingerprints: 2,
      now: (() => {
        let at = 0;
        return () => (at += 100);
      })(),
    });

    client.capture(new Error('first defect'));
    client.capture(new Error('second defect'));
    client.capture(new Error('first defect again'));

    expect(client.insights()).toHaveLength(2);
    const names = client.insights().map((insight: ErrorInsight) => insight.message);
    expect(names).toContain('second defect');
    expect(names).not.toContain('first defect');
  });

  it('raises exactly one alert per capture, even when the envelope is the only output', () => {
    const seen = vi.fn();
    const { client } = tracker({ raiseAlert: seen });

    client.capture(new Error('ignored by alerting'));

    expect(seen).toHaveBeenCalledTimes(1);
  });
});
