import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransport, type TelemetryBatch } from './transport';

const ENDPOINT = 'https://collector.test/ingest';
const META = {
  service: 'gtm-partner-dashboard',
  release: 'test-release',
  environment: 'test',
  sessionId: '0af7651916cd43dd8448eb211c80319c',
  route: 'forecasting',
  providerId: 'local',
};

type RecordedRequest = { body: TelemetryBatch };

function recordingFetch(status = 204): {
  fetchImpl: typeof fetch;
  requests: RecordedRequest[];
  calls: number;
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (_input: string, init: RequestInit) => {
    requests.push({ body: JSON.parse(String(init.body)) as TelemetryBatch });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    requests,
    get calls() {
      return requests.length;
    },
  };
}

function failingFetch(reason: string): typeof fetch {
  return (async () => {
    throw new Error(reason);
  }) as unknown as typeof fetch;
}

describe('createTransport without an endpoint', () => {
  it('drops envelopes without queueing, sending, or scheduling anything', async () => {
    const { fetchImpl, calls } = recordingFetch();
    const transport = createTransport({
      endpoint: null,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
    });

    transport.enqueue({ type: 'event', data: { event: 'route_view' } }, { critical: true });
    await transport.flush();

    expect(transport.status()).toMatchObject({
      enabled: false,
      endpoint: null,
      queued: 0,
      shipped: 0,
      dropped: 1,
    });
    expect(calls).toBe(0);
  });
});

describe('createTransport queueing', () => {
  it('keeps every envelope when the sample rate includes it', () => {
    const { fetchImpl } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 60_000,
    });

    transport.enqueue({ type: 'event', data: { event: 'provider_selected' } });
    transport.enqueue({ type: 'error', data: { name: 'TypeError' } }, { critical: true });

    expect(transport.status().queued).toBe(2);
  });

  it('samples non-critical envelopes and always keeps critical ones', () => {
    const { fetchImpl } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 0,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 60_000,
      // Every non-critical draw lands outside the sample rate.
      random: () => 0.5,
    });

    transport.enqueue({ type: 'event', data: { event: 'route_view' } });
    transport.enqueue({ type: 'error', data: { name: 'Error' } }, { critical: true });
    transport.enqueue({ type: 'alert', data: { key: 'health.degraded' } }, { critical: true });

    const status = transport.status();
    expect(status.queued).toBe(2);
    expect(status.dropped).toBe(1);
  });

  it('evicts the oldest envelope past the queue cap rather than growing without bound', () => {
    const { fetchImpl } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      maxQueued: 2,
      flushIntervalMs: 60_000,
    });

    transport.enqueue({ type: 'event', data: { event: 'first' } });
    transport.enqueue({ type: 'event', data: { event: 'second' } });
    transport.enqueue({ type: 'event', data: { event: 'third' } });

    const status = transport.status();
    expect(status.queued).toBe(2);
    expect(status.dropped).toBe(1);
  });
});

describe('createTransport flushing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sends one batch with session meta, envelope ids, and redacted payloads', async () => {
    const { fetchImpl, requests } = recordingFetch(200);
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      now: () => 1_758_000_000_000,
      flushIntervalMs: 60_000,
    });

    transport.enqueue({
      type: 'event',
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      data: { event: 'team_user_invited', email: 'dana@corp.example', role: 'partner-manager' },
    });
    await transport.flush();

    const batch = requests[0]?.body;
    expect(requests).toHaveLength(1);
    expect(batch).toMatchObject({
      schemaVersion: 1,
      service: META.service,
      release: META.release,
      sessionId: META.sessionId,
      route: META.route,
    });
    expect(batch?.envelopes).toHaveLength(1);
    const envelope = batch?.envelopes[0];
    expect(envelope?.id).toMatch(/^[0-9a-f]{16}$/);
    expect(envelope?.timestamp).toBe(new Date(1_758_000_000_000).toISOString());
    expect(envelope?.traceparent).toContain('0af7651916cd43dd8448eb211c80319c');
    // The address is masked before it is ever queued: the queue must not hold
    // sensitive values even if a batch never ships.
    expect(envelope?.data).toEqual({
      event: 'team_user_invited',
      email: '[redacted]',
      role: 'partner-manager',
    });
    expect(transport.status()).toMatchObject({ shipped: 1, queued: 0 });
  });

  it('runs the beforeFlush hook into the same batch, so metric deltas ride along', async () => {
    const { fetchImpl, requests } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 60_000,
      beforeFlush: () => {
        transport.enqueue({
          type: 'metric',
          data: { kind: 'counter', name: 'provider.call', delta: 3 },
        });
      },
    });

    transport.enqueue({ type: 'event', data: { event: 'notification_sent' } });
    await transport.flush();

    const types = requests[0]?.body.envelopes.map((envelope) => envelope.type);
    expect(types).toEqual(['event', 'metric']);
  });

  it('treats a non-2xx collector response as a failure: dropped, counted, reported', async () => {
    const onDeliveryFailure = vi.fn();
    const { fetchImpl, requests } = recordingFetch(503);
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 60_000,
      onDeliveryFailure,
    });

    transport.enqueue({ type: 'event', data: { event: 'route_view' } });
    await transport.flush();

    expect(transport.status()).toMatchObject({
      shipped: 0,
      dropped: 1,
      failedBatches: 1,
    });
    expect(transport.status().lastFailureReason).toBe('collector responded 503');
    expect(transport.status().lastFailureAt).toBeTypeOf('string');
    expect(onDeliveryFailure).toHaveBeenCalledWith('collector responded 503');
    expect(requests).toHaveLength(1);
  });

  it('reports a rejected fetch through the same failure path', async () => {
    const onDeliveryFailure = vi.fn();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl: failingFetch('collector unreachable'),
      flushIntervalMs: 60_000,
      onDeliveryFailure,
    });

    transport.enqueue({ type: 'error', data: { name: 'Error' } }, { critical: true });
    await transport.flush();

    expect(transport.status()).toMatchObject({ failedBatches: 1, dropped: 1 });
    expect(onDeliveryFailure).toHaveBeenCalledWith('collector unreachable');
  });

  it('flushes on its own cadence once an envelope is queued', async () => {
    const { fetchImpl, requests } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 50,
    });

    transport.enqueue({ type: 'event', data: { event: 'provider_selected' } });
    expect(requests).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(80);

    expect(requests).toHaveLength(1);
    transport.dispose();
  });

  it('ships the queue when the page is being hidden, not on a timer that will not fire', async () => {
    const { fetchImpl, requests } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 60_000,
    });

    transport.enqueue({ type: 'event', data: { event: 'route_view' } });
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);

    expect(requests).toHaveLength(1);
    transport.dispose();
  });

  it('ships the queue when the tab becomes hidden, and ignores it coming back', async () => {
    const { fetchImpl, requests } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 60_000,
    });

    try {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });
      transport.enqueue({ type: 'event', data: { event: 'route_view' } });
      window.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(1);

      // Returning to the tab does nothing: the flush is for leaving, not arriving.
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'visible',
      });
      transport.enqueue({ type: 'event', data: { event: 'notification_sent' } });
      window.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(0);
      expect(requests).toHaveLength(1);
    } finally {
      Reflect.deleteProperty(document, 'visibilityState');
      transport.dispose();
    }
  });

  it('does not double-send when two flushes race', async () => {
    let release: ((response: Response) => void) | undefined;
    const slowFetch = (async () => {
      return await new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as unknown as typeof fetch;
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl: slowFetch,
      flushIntervalMs: 60_000,
    });

    transport.enqueue({ type: 'event', data: { event: 'first' } });
    const firstFlush = transport.flush();
    // A second flush while the first is in flight resolves without sending.
    await transport.flush();
    expect(transport.status().queued).toBe(0);

    release?.(new Response(null, { status: 204 }));
    await firstFlush;

    expect(transport.status().shipped).toBe(1);
    transport.dispose();
  });

  it('dispose clears pending timers and removes page-hide listeners', async () => {
    const { fetchImpl, requests } = recordingFetch();
    const transport = createTransport({
      endpoint: ENDPOINT,
      sampleRate: 1,
      getMeta: () => META,
      fetchImpl,
      flushIntervalMs: 50,
    });

    transport.enqueue({ type: 'event', data: { event: 'route_view' } });
    transport.dispose();
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);

    expect(requests).toHaveLength(0);
  });
});
