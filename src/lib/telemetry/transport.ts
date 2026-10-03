import { logger, type Logger } from '../logging';
import { redactRecord } from '../redact';
import { allowlistEnvelope, type TelemetryEnvelopeType } from './allowlist';
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
 * The master telemetry switch is enforced here, at the boundary: when
 * `isEgressAllowed()` is false the transport neither queues nor schedules nor
 * sends, and the pagehide/visibility flush handlers reach the same dead end,
 * so a disabled session produces zero requests, beacons, or lifecycle
 * flushes. The flag is read per operation, so a runtime override takes effect
 * without a rebuild.
 *
 * Every payload is allowlisted to its envelope's registered technical fields
 * (`src/lib/telemetry/allowlist.ts`) as it is queued, then redacted
 * (`src/lib/redact.ts`) as defense in depth: nothing sensitive sits in the
 * queue even if a batch never ships. Delivery is fire-and-forget: a failed
 * batch is counted, reported through the failure hook as a technical
 * classification (never the raw error prose), and dropped rather than
 * retried forever — client telemetry must never wedge a session over its own
 * delivery.
 */

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

/**
 * Why a batch failed, as a technical classification: the raw error message
 * stays in the local status for debugging, but an alert or log line built
 * from this can never carry exception prose out of the browser.
 */
type DeliveryFailure = { kind: 'http'; status: number } | { kind: 'network' };

export interface TransportOptions {
  endpoint: string | null;
  sampleRate: number;
  /** Context stamped on each batch as it is sent, read at send time. */
  getMeta: () => BatchMeta;
  /**
   * The master egress switch, read at every queue/flush decision. When it
   * returns false the transport queues nothing, schedules nothing, and sends
   * nothing. Defaults to allowed; the facade wires it to `telemetry.enabled`.
   */
  isEgressAllowed?: () => boolean;
  /** Cap on queued envelopes; the oldest are dropped past it. */
  maxQueued?: number;
  /** How long an envelope can sit queued before a flush is scheduled. */
  flushIntervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
  onDeliveryFailure?: (failure: DeliveryFailure) => void;
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

/** Internal marker so a non-2xx collector response classifies as http, with its status code. */
class CollectorResponseError extends Error {
  constructor(readonly status: number) {
    super(`collector responded ${status}`);
  }
}

export function createTransport(options: TransportOptions): TelemetryTransport {
  const {
    endpoint,
    sampleRate,
    getMeta,
    isEgressAllowed = () => true,
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
    if (flushTimer !== null || !endpoint || !isEgressAllowed()) return;
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
    if (flushing || !endpoint || !isEgressAllowed()) return;
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
        throw new CollectorResponseError(response.status);
      }
      shipped += envelopes.length;
      lastDeliveryAt = new Date(now()).toISOString();
    } catch (error) {
      failedBatches += 1;
      dropped += envelopes.length;
      lastFailureAt = new Date(now()).toISOString();
      // The raw message stays in the local status for debugging; everything
      // that leaves this function is the technical classification.
      lastFailureReason = error instanceof Error ? error.message : String(error);
      const failure: DeliveryFailure =
        error instanceof CollectorResponseError
          ? { kind: 'http', status: error.status }
          : { kind: 'network' };
      // One warn, not one per envelope: a collector that is down does not need
      // to be re-announced every five seconds, and the alert layer dedupes.
      log.warn('Telemetry batch delivery failed', {
        failureKind: failure.kind,
        ...(failure.kind === 'http' ? { status: failure.status } : {}),
        envelopes: envelopes.length,
      });
      onDeliveryFailure?.(failure);
    } finally {
      flushing = false;
      if (queue.length > 0) scheduleFlush();
    }
  }

  return {
    enqueue(input, enqueueOptions) {
      // The master switch, enforced at the boundary: disabled telemetry never
      // queues, so a later flush, pagehide, or timer has nothing to send.
      if (!endpoint || !isEgressAllowed()) {
        dropped += 1;
        return;
      }
      const critical = enqueueOptions?.critical === true;
      if (!critical && random() >= sampleRate) {
        dropped += 1;
        return;
      }
      // Allowlisting happens here, at the boundary, before redaction and
      // before the queue: an unregistered event is rejected, and unregistered
      // fields never sit in the queue even if a batch never ships.
      const data = allowlistEnvelope(input.type, input.data);
      if (data === null) {
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
        data: redactRecord(data),
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
