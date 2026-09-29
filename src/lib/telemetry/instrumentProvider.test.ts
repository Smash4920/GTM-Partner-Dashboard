import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_PROVIDER_METHODS, type DataProvider } from '../../data/DataProvider';
import { MockDataProvider } from '../../data/mock/MockDataProvider';
import { clearFlagOverrides, setFlagOverride } from './flags';
import type { ErrorCaptureOptions } from './errors';
import type { MetricAttributes } from './metrics';
import { instrumentProvider, type ProviderTelemetry } from './instrumentProvider';
import type { SpanAttributes } from './trace';
import { createTelemetry } from './telemetry';

interface Observed {
  spans: Array<{ name: string; attributes: SpanAttributes }>;
  counters: Array<{ name: string; attributes: MetricAttributes }>;
  durations: Array<{ name: string; durationMs: number }>;
  breadcrumbs: Array<{ message: string; data?: Record<string, unknown> }>;
  captures: Array<{ error: unknown; options: ErrorCaptureOptions | undefined }>;
}

/** A telemetry client that records what the wrapper does, without shipping anything. */
function observingClient(): { client: ProviderTelemetry; seen: Observed } {
  const seen: Observed = {
    spans: [],
    counters: [],
    durations: [],
    breadcrumbs: [],
    captures: [],
  };
  return {
    seen,
    client: {
      startSpan: (name, attributes) => {
        seen.spans.push({ name, attributes: attributes ?? {} });
        return {
          name,
          traceId: '0af7651916cd43dd8448eb211c80319c',
          traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
          setAttribute: () => {},
          end: (status?: 'ok' | 'error') => ({
            name,
            traceId: '0af7651916cd43dd8448eb211c80319c',
            spanId: 'b7ad6b7169203331',
            parentSpanId: '0011223344556677',
            traceFlags: '01',
            status: status ?? 'ok',
            startedAt: 0,
            endedAt: 12,
            durationMs: 12,
            attributes: {},
          }),
        };
      },
      recordCounter: (name, attributes) => {
        seen.counters.push({ name, attributes: attributes ?? {} });
      },
      recordDuration: (name, durationMs) => {
        seen.durations.push({ name, durationMs });
      },
      addBreadcrumb: (message, data) => {
        seen.breadcrumbs.push({ message, data });
      },
      captureError: (error, options) => {
        seen.captures.push({ error, options });
        return { fingerprint: '1c3a5e7f', count: 1 };
      },
    },
  };
}

beforeEach(() => {
  clearFlagOverrides();
});

afterEach(() => {
  clearFlagOverrides();
});

describe('instrumentProvider proxying', () => {
  it('leaves the provider identity and non-contract surface untouched', () => {
    const provider = instrumentProvider(new MockDataProvider(), 'local');

    expect(provider).toBeInstanceOf(MockDataProvider);
    for (const method of DATA_PROVIDER_METHODS) {
      expect(typeof provider[method]).toBe('function');
    }
  });

  it('answers through the underlying provider unchanged', async () => {
    const inner = new MockDataProvider();
    const provider = instrumentProvider(inner, 'local');

    const [wrapped, direct] = await Promise.all([provider.listPartners(), inner.listPartners()]);

    expect(wrapped).toBe(direct);
  });
});

describe('instrumentProvider on a successful call', () => {
  it('spans the call, counts it, and times it from the span clock', async () => {
    const { client, seen } = observingClient();
    const provider = instrumentProvider(new MockDataProvider(), 'remote', client);

    await provider.getPartnerDirectory();

    expect(seen.spans).toEqual([
      {
        name: 'provider.getPartnerDirectory',
        attributes: { providerId: 'remote', method: 'getPartnerDirectory' },
      },
    ]);
    expect(seen.counters).toEqual([
      {
        name: 'provider.call',
        attributes: { method: 'getPartnerDirectory', providerId: 'remote', status: 'ok' },
      },
    ]);
    expect(seen.durations).toEqual([{ name: 'provider.call.duration', durationMs: 12 }]);
    expect(seen.captures).toEqual([]);
  });

  it('instruments scoped queries and their arguments too', async () => {
    const { client, seen } = observingClient();
    const provider = instrumentProvider(new MockDataProvider(), 'scaled', client);

    const summary = await provider.getForecastSummary({ quarter: 'FY27-Q3' });

    expect(summary).toHaveProperty('openPipelineValue');
    expect(summary).toHaveProperty('daysLeftInQuarter');
    expect(seen.spans[0]?.attributes).toMatchObject({ method: 'getForecastSummary' });
  });
});

describe('instrumentProvider on a failing call', () => {
  it('captures the error with trace context, leaves a breadcrumb, and rethrows', async () => {
    const { client, seen } = observingClient();
    const failing = new MockDataProvider();
    failing.getTargets = async () => {
      throw new Error('targets wire is down');
    };
    const provider = instrumentProvider(failing, 'remote', client);

    await expect(provider.getTargets()).rejects.toThrow('targets wire is down');

    expect(seen.counters).toEqual([
      {
        name: 'provider.call',
        attributes: { method: 'getTargets', providerId: 'remote', status: 'error' },
      },
    ]);
    expect(seen.durations[0]).toMatchObject({ name: 'provider.call.duration' });
    expect(seen.breadcrumbs).toEqual([
      {
        message: 'provider.getTargets failed',
        data: { method: 'getTargets', providerId: 'remote' },
      },
    ]);
    expect(seen.captures).toHaveLength(1);
    expect(seen.captures[0]?.options).toMatchObject({
      category: 'provider',
      severity: 'warning',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
    });
  });

  it('stays quiet when the telemetry master flag is switched off mid-session', async () => {
    const { client, seen } = observingClient();
    const provider = instrumentProvider(new MockDataProvider(), 'local', client);
    setFlagOverride('telemetry.enabled', false);

    const partners = await provider.listPartners();

    expect(partners.length).toBeGreaterThan(0);
    expect(seen.spans).toEqual([]);
    expect(seen.counters).toEqual([]);
  });
});

describe('instrumentProvider against the real facade', () => {
  it('ships a trace envelope and metric deltas for one seam call, end to end', async () => {
    const collected: Record<string, unknown>[] = [];
    const fetchImpl = (async (_input: string, init: RequestInit) => {
      collected.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const real = createTelemetry({
      config: {
        endpoint: 'https://collector.test/ingest',
        alertEndpoint: null,
        dashboardUrl: null,
        analyticsMeasurementId: null,
        logShipLevel: 'warn',
        sampleRate: 1,
        release: 'test-release',
        environment: 'test',
        issues: [],
      },
      fetchImpl,
    });
    try {
      const provider: DataProvider = instrumentProvider(new MockDataProvider(), 'local', real);

      await provider.listCertifications();
      await real.flush();

      const batch = collected[0] as {
        envelopes: Array<{ type: string; data: Record<string, unknown> }>;
      };
      const traceEnvelope = batch.envelopes.find((envelope) => envelope.type === 'trace');
      const counterEnvelope = batch.envelopes.find(
        (envelope) =>
          envelope.type === 'metric' && (envelope.data as { kind?: string }).kind === 'counter',
      );
      const durationEnvelope = batch.envelopes.find(
        (envelope) =>
          envelope.type === 'metric' && (envelope.data as { kind?: string }).kind === 'duration',
      );

      expect(traceEnvelope?.data).toMatchObject({
        name: 'provider.listCertifications',
        status: 'ok',
      });
      expect(counterEnvelope?.data).toMatchObject({
        name: 'provider.call',
        attributes: { method: 'listCertifications', providerId: 'local', status: 'ok' },
      });
      expect(durationEnvelope?.data).toMatchObject({
        name: 'provider.call.duration',
        count: 1,
      });
    } finally {
      real.dispose();
    }
  });
});
