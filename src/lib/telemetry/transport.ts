import { logger, type Logger } from '../logging';
import { redactRecord } from '../redact';
import { randomHex } from './config';

/**
 * The one place telemetry leaves the browser.
 *
 * Envelopes are queued in memory and flushed as a single JSON batch to the
 * configured collector endpoint. With no endpoint — the default, and the
 * behavior a plain `npm run dev` has always had — nothing is queued and
 * nothing is sent: the queue drops each envelope, keeps a count, and every
 * in-process consumer (metrics, error insights, health, alert handlers) still
 * works.
 *
 * Every envelope's payload is redacted (`src/lib/redact.ts`) as it is queued,
 * so nothing sensitive sits in the queue even if a batch never ships. Delivery
 * is fire-and-forget: a failed batch is counted, reported through the failure
 * hook (the facade raises an alert from it), and dropped rather than retried
 * forever — client telemetry must never wedge a session over its own delivery.
 */

type TelemetryEnvelopeType = 'log' | 'metric' | 'event' | 'trace' | 'error' | 'alert' | 'health';

export interface TelemetryEnvelope {
  id: string;
  type: TelemetryEnvelopeType;
  timestamp: string;
  /** Span context for the envelope, when it was captured inside one. */
  traceparent?: string;
  data: Record<string, unknown>;
}

/** What a caller hands the transport; id and timestamp are assigned at queue time. */
interface TelemetryEnvelopeInput {
  type: TelemetryEnvelopeType;
  traceparent?: string;
  data: Record<string, unknown>;
}

/** The batch shape POSTed to the collector; one request, many envelopes. */
export interface TelemetryBatch {
  schemaVersion: 1;
  service: string;
  release: string;
  environment: string;
  sessionId: string;
  route: string | null;
  providerId: string | null;
  sentAt: string;
  envelopes: TelemetryEnvelope[];
}

export interface TransportStatus {
  enabled: boolean;
  endpoint: string | null;
  queued: number;
  shipped: number;
  dropped: number;
  failedBatches: number;
  lastDeliveryAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

interface BatchMeta {
  service: string;
  release: string;
  environment: string;
  sessionId: string;
  route: string | null;
  providerId: string | null;
}

export interface TransportOptions {
  endpoint: string | null;
  sampleRate: number;
  /** Context stamped on each batch as it is sent, read at send time. */
  getMeta: () => BatchMeta;
  /** Cap on queued envelopes; the oldest are dropped past it. */
  maxQueued?: number;
  /** How long an envelope can sit queued before a flush is scheduled. */
  flushIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
  onDeliveryFailure?: (reason: string) => void;
  /**
   * Runs at the start of every flush cycle, before the queue is taken — the
   * hook the facade uses to enqueue metric deltas so they ride the same batch.
   */
  beforeFlush?: () => void;
}

interface EnqueueOptions {
  /**
   * Errors and alerts are always queued regardless of sample rate. Everything
   * else — logs, metrics, events, traces — is sampled.
   */
  critical?: boolean;
}

export interface TelemetryTransport {
  enqueue(envelope: TelemetryEnvelopeInput, options?: EnqueueOptions): void;
  /** Sends everything queued now; safe to call while idle or already flushing. */
  flush(): Promise<void>;
  status(): TransportStatus;
  /** Stops timers and listeners; for tests and teardown. */
  dispose(): void;
}

const DEFAULT_MAX_QUEUED = 200;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function createTransport(options: TransportOptions): TelemetryTransport {
  const {
    endpoint,
    sampleRate,
    getMeta,
    maxQueued = DEFAULT_MAX_QUEUED,
    flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS,
    now = Date.now,
    random = Math.random,
    onDeliveryFailure,
    beforeFlush,
  } = options;
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const log: Logger = logger.child({ component: 'TelemetryTransport' });

  const queue: TelemetryEnvelope[] = [];
  let shipped = 0;
  let dropped = 0;
  let failedBatches = 0;
  let lastDeliveryAt: string | null = null;
  let lastFailureAt: string | null = null;
  let lastFailureReason: string | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;

  const scheduleFlush = () => {
    if (flushTimer !== null || !endpoint) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, flushIntervalMs);
  };

  // The tab is closing (pagehide) or going away (became hidden): ship what is
  // queued now rather than waiting for a timer that will not fire. Keepalive
  // lets the browser finish the request after the page is gone. pagehide is
  // taken on trust — the document is on its way out whatever it reports.
  const onPageHide = () => {
    void flush();
  };
  const onVisibilityHidden = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      void flush();
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('visibilitychange', onVisibilityHidden);
  }

  async function flush(): Promise<void> {
    if (flushing || !endpoint) return;
    beforeFlush?.();
    if (queue.length === 0) return;
    flushing = true;
    const envelopes = queue.splice(0);
    const meta = getMeta();
    const batch: TelemetryBatch = {
      schemaVersion: 1,
      ...meta,
      sentAt: new Date(now()).toISOString(),
      envelopes,
    };
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        body: JSON.stringify(batch),
      });
      if (!response.ok) {
        throw new Error(`collector responded ${response.status}`);
      }
      shipped += envelopes.length;
      lastDeliveryAt = new Date(now()).toISOString();
    } catch (error) {
      failedBatches += 1;
      dropped += envelopes.length;
      lastFailureAt = new Date(now()).toISOString();
      lastFailureReason = error instanceof Error ? error.message : String(error);
      // One warn, not one per envelope: a collector that is down does not need
      // to be re-announced every five seconds, and the alert layer dedupes.
      log.warn('Telemetry batch delivery failed', {
        endpoint,
        envelopes: envelopes.length,
        reason: lastFailureReason,
      });
      onDeliveryFailure?.(lastFailureReason);
    } finally {
      flushing = false;
      if (queue.length > 0) scheduleFlush();
    }
  }

  return {
    enqueue(input, enqueueOptions) {
      if (!endpoint) {
        dropped += 1;
        return;
      }
      const critical = enqueueOptions?.critical === true;
      if (!critical && random() >= sampleRate) {
        dropped += 1;
        return;
      }
      if (queue.length >= maxQueued) {
        queue.shift();
        dropped += 1;
      }
      queue.push({
        id: randomHex(8),
        type: input.type,
        timestamp: new Date(now()).toISOString(),
        ...(input.traceparent !== undefined ? { traceparent: input.traceparent } : {}),
        // Redaction happens here, at the boundary, not later in some sink:
        // the queue must never hold a sensitive value.
        data: redactRecord(input.data),
      });
      scheduleFlush();
    },

    flush,

    status(): TransportStatus {
      return {
        enabled: endpoint !== null,
        endpoint,
        queued: queue.length,
        shipped,
        dropped,
        failedBatches,
        lastDeliveryAt,
        lastFailureAt,
        lastFailureReason,
      };
    },

    dispose() {
      if (flushTimer !== null) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', onPageHide);
        window.removeEventListener('visibilitychange', onVisibilityHidden);
      }
    },
  };
}
