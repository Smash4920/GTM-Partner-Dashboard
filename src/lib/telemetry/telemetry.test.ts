import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HealthArtifact } from '../health';
import { createLogger } from '../logging';
import { clearFlagOverrides, setFlagOverride } from './flags';
import type { TelemetryConfig } from './config';
import { parseTraceparent } from './trace';
import { createTelemetry, type TelemetryFacade, type TelemetryOptions } from './telemetry';
import type { TelemetryBatch, TelemetryEnvelope } from './transport';

const CONFIG: TelemetryConfig = {
  endpoint: 'https://collector.test/ingest',
  dashboardUrl: null,
  analyticsMeasurementId: null,
  logShipLevel: 'warn',
  sampleRate: 1,
  release: 'test-release',
  environment: 'test',
  issues: [],
};

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const PARENT_SPAN = 'b7ad6b7169203331';

interface Harness {
  client: TelemetryFacade;
  batches: () => TelemetryBatch[];
  envelopes: () => TelemetryEnvelope[];
  fetchCalls: () => number;
}

const clients: TelemetryFacade[] = [];

function harness(
  options: Partial<TelemetryOptions> = {},
  config: TelemetryConfig = CONFIG,
): Harness {
  const requests: TelemetryBatch[] = [];
  const fetchImpl = (async (_input: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as TelemetryBatch);
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  const client = createTelemetry({ config, fetchImpl, ...options });
  clients.push(client);
  return {
    client,
    batches: () => requests,
    envelopes: () => requests.flatMap((batch) => batch.envelopes),
    fetchCalls: () => requests.length,
  };
}

const healthyArtifact: HealthArtifact = {
  status: 'ok',
  service: 'gtm-partner-dashboard',
  release: 'test-release',
  environment: 'test',
  sessionId: TRACE_ID,
  route: 'home',
  providerId: 'local',
  generatedAt: '2026-09-18T00:00:00.000Z',
  uptimeMs: 1_200,
  checks: [{ name: 'appShell', status: 'ok', detail: '1 root children' }],
};

beforeEach(() => {
  clearFlagOverrides();
});

afterEach(() => {
  clearFlagOverrides();
  for (const client of clients.splice(0)) client.dispose();
  // Undo any analytics script install so one test's gtag cannot leak into
  // the next test's window.
  document.head.querySelectorAll('script[data-test-ga]').forEach((script) => script.remove());
  document.head.querySelectorAll('script[src*="googletagmanager"]').forEach((s) => s.remove());
  delete window.gtag;
  delete window.dataLayer;
});

describe('createTelemetry context', () => {
  it('describes the session: release, environment, a random session id, and a trace', () => {
    const { client } = harness();

    const context = client.contextSnapshot();

    expect(context).toMatchObject({
      release: 'test-release',
      environment: 'test',
      route: null,
      providerId: null,
    });
    expect(context.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(parseTraceparent(context.traceparent)?.traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('continues the trace the page was served under', () => {
    const { client } = harness({
      incomingTraceContext: parseTraceparent(`00-${TRACE_ID}-${PARENT_SPAN}-01`),
    });

    expect(parseTraceparent(client.contextSnapshot().traceparent)).toEqual({
      version: '00',
      traceId: TRACE_ID,
      parentSpanId: PARENT_SPAN,
      traceFlags: '01',
    });
  });

  it('carries route and provider on every batch it ships', async () => {
    const { client, batches } = harness();

    client.setRoute('forecasting');
    client.setProviderId('remote');
    await client.flush();

    expect(batches()[0]).toMatchObject({ route: 'forecasting', providerId: 'remote' });
  });
});

describe('product analytics events', () => {
  it('emits route views and provider swaps as event envelopes', async () => {
    setFlagOverride('analytics.enabled', true);
    const { client, envelopes } = harness();

    client.setRoute('forecasting');
    client.setProviderId('remote');
    client.track('notification_sent', { kind: 'registration-approved' });
    await client.flush();

    expect(envelopes().map((envelope) => envelope.data.event)).toEqual([
      'route_view',
      'provider_selected',
      'notification_sent',
    ]);
  });

  it('ships analytics only when both the master switch and analytics are on (VAL-SEC-002)', async () => {
    const cases = [
      { master: false, analytics: false, expectScript: false, expectEvent: false },
      { master: false, analytics: true, expectScript: false, expectEvent: false },
      { master: true, analytics: false, expectScript: false, expectEvent: false },
      { master: true, analytics: true, expectScript: true, expectEvent: true },
    ];

    for (const { master, analytics, expectScript, expectEvent } of cases) {
      setFlagOverride('telemetry.enabled', master);
      setFlagOverride('analytics.enabled', analytics);
      const { client, envelopes } = harness(
        {},
        { ...CONFIG, analyticsMeasurementId: 'G-TEST1234' },
      );

      client.track('provider_selected', { providerId: 'local' });
      await client.flush();

      expect(document.head.querySelector('script[src*="googletagmanager"]') !== null).toBe(
        expectScript,
      );
      expect(envelopes().some((envelope) => envelope.type === 'event')).toBe(expectEvent);

      // Reset window state before the next combination installs fresh.
      client.dispose();
      clients.splice(clients.indexOf(client), 1);
      document.head.querySelectorAll('script[src*="googletagmanager"]').forEach((s) => s.remove());
      delete window.gtag;
      delete window.dataLayer;
    }
  });

  it('drops properties that are not registered for the event', async () => {
    setFlagOverride('analytics.enabled', true);
    const { client, envelopes } = harness();

    client.track('notification_sent', {
      kind: 'registration-approved',
      body: 'Dana Example wrote: call Dana about the renewal',
    });
    await client.flush();

    const event = envelopes().find((envelope) => envelope.type === 'event');
    expect(event?.data.properties).toEqual({ kind: 'registration-approved' });
  });
});

describe('error capture and alerting', () => {
  it('ships captured errors and their alerts even when sampling excludes everything else', async () => {
    const { client, envelopes } = harness({}, { ...CONFIG, sampleRate: 0 });

    client.track('route_view', { route: 'home' });
    client.captureError(new Error('CRM is down'), { category: 'provider' });
    await client.flush();

    expect(envelopes().map((envelope) => envelope.type)).toEqual(['error', 'alert']);
    // The error envelope is the exact technical shape (VAL-SEC-004): class,
    // fingerprint, category, severity — the raw message 'CRM is down'
    // appears nowhere it could leave the browser.
    expect(envelopes()[0]?.data).toEqual({
      name: 'Error',
      fingerprint: expect.any(String),
      category: 'provider',
      severity: 'warning',
    });
    expect(JSON.stringify(envelopes())).not.toContain('CRM is down');
    expect(envelopes()[1]?.data).toMatchObject({
      key: expect.stringMatching(/^error:/),
      severity: 'warning',
    });
    expect(envelopes()[1]?.data).not.toHaveProperty('title');
    expect(envelopes()[1]?.data).not.toHaveProperty('summary');
  });

  it('raises one alert per capture, deduped by fingerprint cooldown', async () => {
    const { client, envelopes } = harness();
    const alerts: string[] = [];
    client.registerAlertHandler((alert) => alerts.push(alert.key));

    client.addBreadcrumb('Route changed', { route: 'data-connections' });
    client.captureError(new Error('CRM is down'));
    client.captureError(new Error('CRM is down'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/^error:/);
    // The alert is a critical envelope: a collector outage cannot hide it.
    await client.flush();
    expect(client.transportStatus().queued).toBe(0);
    expect(client.errorInsights()).toHaveLength(1);
    expect(client.recentErrorCount(60_000)).toBe(2);
    // The breadcrumb the caller left stays local: it feeds error insights
    // in-process but is not a registered envelope field.
    const errorEnvelope = envelopes().find((envelope) => envelope.type === 'error');
    expect(errorEnvelope?.data).not.toHaveProperty('breadcrumbs');
    expect(errorEnvelope?.data).not.toHaveProperty('message');
  });

  it('reports a failing collector as its own alert condition, without raw failure prose', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const client = createTelemetry({ config: CONFIG, fetchImpl });
    clients.push(client);
    const alerts: Array<{ key: string; summary: string }> = [];
    client.registerAlertHandler((alert) => alerts.push({ key: alert.key, summary: alert.summary }));

    client.setRoute('home');
    await client.flush();

    expect(alerts.map((alert) => alert.key)).toContain('telemetry.transport_failed');
    // The failure alert classifies, it does not quote: the raw exception
    // prose stays on the transport status (local) and the log, never in an
    // alert or an envelope.
    expect(alerts.find((alert) => alert.key === 'telemetry.transport_failed')?.summary).toBe(
      'Collector unreachable: network-level failure.',
    );
    expect(client.transportStatus()).toMatchObject({
      enabled: true,
      failedBatches: 1,
      dropped: 1,
      queued: 1,
      lastFailureReason: 'connection refused',
    });
  });

  it('exposes raiseAlert for domain rules that are not error captures', () => {
    const { client } = harness();
    const received: string[] = [];
    client.registerAlertHandler((alert) => received.push(alert.severity));

    const raised = client.raiseAlert({
      key: 'sla.registration.lapsed',
      severity: 'critical',
      title: 'Registration SLA lapsed',
      summary: 'reg-0001 has waited 6 business days',
    });

    expect(raised?.key).toBe('sla.registration.lapsed');
    expect(received).toEqual(['critical']);
  });
});

describe('traces and metrics', () => {
  it('opens provider spans under the session trace and ships their durations', async () => {
    const { client, envelopes } = harness();

    const span = client.startSpan('provider.listPartners', { providerId: 'local' });
    span.setAttribute('operation', 'refresh');
    // Ending without a status means success, the same convention every span
    // library uses.
    span.end();
    await client.flush();

    const traceEnvelope = envelopes().find((envelope) => envelope.type === 'trace');
    expect(traceEnvelope?.data).toMatchObject({
      name: 'provider.listPartners',
      status: 'ok',
      // Only registered attribute keys ship: an arbitrary key would be dropped.
      attributes: { providerId: 'local', operation: 'refresh' },
      parentSpanId: parseTraceparent(client.contextSnapshot().traceparent)?.parentSpanId,
    });
    expect(traceEnvelope?.traceparent).toContain(
      parseTraceparent(client.contextSnapshot().traceparent)?.traceId ?? '',
    );
  });

  it('drains counters and durations as metric envelopes on each flush', async () => {
    const { client, envelopes } = harness();

    client.recordCounter('provider.call', { method: 'getTargets', status: 'ok' });
    client.recordDuration('provider.call.duration', 42, { method: 'getTargets' });
    await client.flush();

    const metricData = envelopes()
      .filter((envelope) => envelope.type === 'metric')
      .map((envelope) => envelope.data);
    expect(metricData).toEqual([
      {
        kind: 'counter',
        name: 'provider.call',
        attributes: { method: 'getTargets', status: 'ok' },
        delta: 1,
      },
      {
        kind: 'duration',
        name: 'provider.call.duration',
        attributes: { method: 'getTargets' },
        count: 1,
        totalMs: 42,
        minMs: 42,
        maxMs: 42,
      },
    ]);
  });

  it('does not call the collector when there is nothing to send', async () => {
    const { client, fetchCalls } = harness();

    await client.flush();

    expect(fetchCalls()).toBe(0);
  });
});

describe('health reporting', () => {
  it('ships a healthy artifact as an envelope, without an alert', async () => {
    const { client, envelopes } = harness();
    const alerts: string[] = [];
    client.registerAlertHandler((alert) => alerts.push(alert.key));

    client.reportHealth(healthyArtifact);
    await client.flush();

    expect(envelopes().map((envelope) => envelope.type)).toEqual(['health']);
    expect(envelopes()[0]?.data.status).toBe('ok');
    expect(alerts).toEqual([]);
  });

  it('alerts — and escalates — when the artifact is short of ok', () => {
    // The alert cooldown is real, so the clock advances past it between the
    // two reports; both alerts are then delivered and compared.
    const { client } = harness({
      now: (() => {
        let at = 0;
        return () => (at += 400_000);
      })(),
    });
    const severities: string[] = [];
    const summaries: string[] = [];
    client.registerAlertHandler((alert) => {
      severities.push(alert.severity);
      summaries.push(alert.summary);
    });
    const degraded = {
      ...healthyArtifact,
      status: 'degraded' as const,
      checks: [
        ...healthyArtifact.checks,
        { name: 'dataSeam', status: 'unavailable' as const, detail: 'CRM is down' },
      ],
    };

    client.reportHealth(degraded);
    client.reportHealth({ ...healthyArtifact, status: 'unavailable' });

    expect(severities).toEqual(['warning', 'critical']);
    // The failing check is named in the alert, not just counted.
    expect(summaries[0]).toContain('dataSeam');
  });
});

describe('log shipping', () => {
  it('ships only the registered record fields when the log shipping flag is on', async () => {
    const { client, envelopes } = harness();
    setFlagOverride('telemetry.logShipping', true);
    const local: unknown[] = [];
    const log = createLogger({ sink: (record) => local.push(record) });

    log.warn('Invite failed', { email: 'dana@corp.example' });
    log.debug('stays local: below the ship level');
    await client.flush();

    const logEnvelope = envelopes().find((envelope) => envelope.type === 'log');
    // `email` is not a registered log field: it is dropped before the record
    // reaches the queue, not merely masked on the wire.
    expect(logEnvelope?.data).toEqual({
      time: expect.any(String),
      level: 'warn',
      msg: 'Invite failed',
    });
    // The console sink still sees the original record: the boundary is for
    // egress, and a developer debugging locally needs the real value.
    expect(local[0]).toMatchObject({ email: 'dana@corp.example' });
  });

  it('keeps every log record local while the flag is off, and after dispose', async () => {
    const log = createLogger({ sink: () => {} });
    const first = harness();
    setFlagOverride('telemetry.logShipping', true);
    log.warn('first session ships this');
    await first.client.flush();
    expect(first.envelopes().some((envelope) => envelope.type === 'log')).toBe(true);

    clearFlagOverrides();
    log.warn('second session keeps this local');
    const second = harness();
    await second.client.flush();
    expect(second.envelopes().some((envelope) => envelope.type === 'log')).toBe(false);

    setFlagOverride('telemetry.logShipping', true);
    second.client.dispose();
    log.warn('after dispose, nothing ships');
    await second.client.flush();
    expect(second.envelopes().some((envelope) => envelope.type === 'log')).toBe(false);
  });
});

describe('no-endpoint mode', () => {
  it('records in-process only: every envelope is dropped, and status says why', async () => {
    const { client, fetchCalls } = harness({}, { ...CONFIG, endpoint: null });
    const alerts: string[] = [];
    client.registerAlertHandler((alert) => alerts.push(alert.key));

    setFlagOverride('analytics.enabled', true);
    client.setRoute('home');
    client.track('route_view', { route: 'home' });
    client.captureError(new Error('still captured in-process'));
    await client.flush();

    expect(fetchCalls()).toBe(0);
    expect(client.transportStatus()).toMatchObject({
      enabled: false,
      endpoint: null,
      // Route event, tracked event, error envelope, alert envelope: all
      // dropped, all counted, nothing sent. Metric deltas are not drained
      // while there is nothing to ship to, so they stay pending.
      dropped: 4,
    });
    expect(client.errorInsights()).toHaveLength(1);
    expect(alerts).toHaveLength(1);
  });
});

describe('master telemetry switch (VAL-SEC-001)', () => {
  it('off means zero network effects from every facade path, with local state intact', async () => {
    setFlagOverride('telemetry.enabled', false);
    setFlagOverride('analytics.enabled', true);
    setFlagOverride('telemetry.logShipping', true);
    const { client, fetchCalls } = harness({}, { ...CONFIG, analyticsMeasurementId: 'G-TEST1234' });
    const alerts: string[] = [];
    client.registerAlertHandler((alert) => alerts.push(alert.key));

    client.setRoute('home');
    client.setProviderId('local');
    client.track('route_view', { route: 'home' });
    client.captureError(new TypeError('still captured locally'), { category: 'render' });
    client.reportHealth(healthyArtifact);
    const span = client.startSpan('provider.listPartners', { providerId: 'local' });
    span.end();
    createLogger({ sink: () => {} }).error('ships nowhere', { email: 'dana@corp.example' });
    await client.flush();

    // Zero requests — and no analytics script install, because the master
    // switch was off before the client was created.
    expect(fetchCalls()).toBe(0);
    expect(document.head.querySelector('script[src*="googletagmanager"]')).toBeNull();
    expect(window.gtag).toBeUndefined();

    // Everything the facade was asked to record was counted as dropped by
    // the egress boundary, not sent.
    expect(client.transportStatus().dropped).toBeGreaterThan(0);

    // Local in-process behavior is untouched by the switch.
    expect(client.errorInsights()).toHaveLength(1);
    expect(client.recentErrorCount(60_000)).toBe(1);
    expect(alerts).toEqual([`error:${client.errorInsights()[0]?.fingerprint}`]);
  });

  it('re-enabling later only affects what happens after the switch', async () => {
    setFlagOverride('telemetry.enabled', false);
    const { client, envelopes, fetchCalls } = harness();

    client.setRoute('home');
    await client.flush();
    expect(fetchCalls()).toBe(0);

    setFlagOverride('telemetry.enabled', true);
    client.setRoute('forecasting');
    await client.flush();

    expect(envelopes().map((envelope) => envelope.data.event)).toEqual(['route_view']);
    expect(envelopes()[0]?.data.properties).toEqual({ route: 'forecasting' });
  });
});

describe('nothing sensitive leaves the browser (VAL-SEC-004)', () => {
  // Representative adversarial values: a personal name, an email address, a
  // domain record name, a live-shaped secret, user prose, raw error prose,
  // and a query-bearing URL. Each is offered to a different telemetry path.
  const SENTINELS = [
    'Dana Example',
    'dana@corp.example',
    'Acme Rocket Partners',
    'sk-live-777',
    'call Dana about the renewal',
    '?token=secret',
  ];

  it('no sentinel survives into any shipped batch from any facade path', async () => {
    setFlagOverride('analytics.enabled', true);
    setFlagOverride('telemetry.logShipping', true);
    const { client, batches, envelopes } = harness();
    const log = createLogger({ sink: () => {} });

    client.setRoute('home');
    client.track('notification_sent', {
      kind: 'registration-approved',
      body: 'Dana Example wrote: call Dana about the renewal',
    });
    client.captureError(new TypeError('Acme Rocket Partners sync failed for dana@corp.example'), {
      category: 'provider',
    });
    client.raiseAlert({
      key: 'sla.registration.lapsed',
      severity: 'critical',
      title: 'Dana Example breached the SLA',
      summary: 'call Dana about the renewal',
      detail: { reason: 'sk-live-777', endpoint: 'https://collector.test/ingest?token=secret' },
    });
    client.reportHealth({
      ...healthyArtifact,
      status: 'degraded',
      checks: [
        { name: 'dataSeam', status: 'unavailable', detail: 'Acme Rocket Partners timed out' },
      ],
    });
    log.error('Sync failed', {
      error: new Error('dana@corp.example'),
      email: 'dana@corp.example',
      note: 'call Dana about the renewal',
    });
    await client.flush();

    // The test is only meaningful if every path actually shipped. Error
    // capture increments the error.captured counter, so the flush also
    // drains a metric envelope.
    const shippedTypes = new Set(envelopes().map((envelope) => envelope.type));
    expect(shippedTypes).toEqual(new Set(['event', 'error', 'alert', 'health', 'log', 'metric']));

    const wire = JSON.stringify(batches());
    for (const sentinel of SENTINELS) {
      expect(wire).not.toContain(sentinel);
    }
    // Not even redacted echoes of the address or the secret may appear.
    expect(wire).not.toContain('corp.example');
    expect(wire).not.toContain('sk-');
  });
});
