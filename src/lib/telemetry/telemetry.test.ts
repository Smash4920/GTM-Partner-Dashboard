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
  alertEndpoint: null,
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

  it('suppresses tracked events while the analytics flag is off', async () => {
    const { client, envelopes } = harness();
    setFlagOverride('analytics.enabled', false);

    client.track('partner_added', { partnerId: 'prospect-1' });
    await client.flush();

    expect(envelopes()).toEqual([]);
  });
});

describe('error capture and alerting', () => {
  it('ships captured errors and their alerts even when sampling excludes everything else', async () => {
    const { client, envelopes } = harness({}, { ...CONFIG, sampleRate: 0 });

    client.track('route_view', { route: 'home' });
    client.captureError(new Error('CRM is down'), { category: 'provider' });
    await client.flush();

    expect(envelopes().map((envelope) => envelope.type)).toEqual(['error', 'alert']);
    expect(envelopes()[0]?.data).toMatchObject({
      name: 'Error',
      message: 'CRM is down',
      category: 'provider',
    });
    expect(envelopes()[1]?.data).toMatchObject({
      key: expect.stringMatching(/^error:/),
      severity: 'warning',
    });
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
    // The breadcrumb the caller left rides along on the error envelope.
    const errorEnvelope = envelopes().find((envelope) => envelope.type === 'error');
    expect(errorEnvelope?.data.breadcrumbs).toEqual([
      { at: expect.any(Number), message: 'Route changed', data: { route: 'data-connections' } },
    ]);
  });

  it('reports a failing collector as its own alert condition', async () => {
    const fetchImpl = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof fetch;
    const client = createTelemetry({ config: CONFIG, fetchImpl });
    clients.push(client);
    const alerts: string[] = [];
    client.registerAlertHandler((alert) => alerts.push(alert.key));

    client.track('route_view', { route: 'home' });
    await client.flush();

    expect(alerts).toContain('telemetry.transport_failed');
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
    span.setAttribute('attempt', 2);
    // Ending without a status means success, the same convention every span
    // library uses.
    span.end();
    await client.flush();

    const traceEnvelope = envelopes().find((envelope) => envelope.type === 'trace');
    expect(traceEnvelope?.data).toMatchObject({
      name: 'provider.listPartners',
      status: 'ok',
      attributes: { providerId: 'local', attempt: 2 },
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
  it('ships warn-and-above records, redacted, when the log shipping flag is on', async () => {
    const { client, envelopes } = harness();
    setFlagOverride('telemetry.logShipping', true);
    const local: unknown[] = [];
    const log = createLogger({ sink: (record) => local.push(record) });

    log.warn('Invite failed', { email: 'dana@corp.example' });
    log.debug('stays local: below the ship level');
    await client.flush();

    const logEnvelope = envelopes().find((envelope) => envelope.type === 'log');
    expect(logEnvelope?.data).toMatchObject({
      level: 'warn',
      msg: 'Invite failed',
      email: '[redacted]',
    });
    // The console sink still sees the original record: redaction is for the
    // boundary, and a developer debugging locally needs the real value.
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
    const { client, fetchCalls } = harness({}, { ...CONFIG, endpoint: null, alertEndpoint: null });
    const alerts: string[] = [];
    client.registerAlertHandler((alert) => alerts.push(alert.key));

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
