import { randomHex } from './config';

/**
 * W3C Trace Context, client-side: traceparent parsing and generation, plus
 * the span model every envelope is correlated through.
 *
 * A page load is one trace. The telemetry session starts a root span context
 * when it initializes — continuing the trace the page was served under, when
 * a deployment injects one — and every provider call opens a child span of
 * that trace. Spans end as telemetry envelopes carrying the `traceparent`
 * value a server would have received as a header, so a slow or failing
 * `getForecastSummary` in the collector lines up with the browser session it
 * happened in, and with everything else that session did.
 *
 * Reference: https://www.w3.org/TR/trace-context/ (traceparent only; there is
 * no tracestate plumbing here because no vendor keys exist to carry).
 */

const TRACE_VERSION = '00';
const SAMPLED_FLAGS = '01';
const NOT_SAMPLED_FLAGS = '00';

const HEX_2 = /^[0-9a-f]{2}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

export interface TraceContext {
  /** 32 lowercase hex chars. All-zero is not a valid trace id. */
  traceId: string;
  /** The parent span: 16 lowercase hex chars. All-zero is not a valid span id. */
  parentSpanId: string;
  /** Two lowercase hex chars; bit 0 records the sampling decision. */
  traceFlags: string;
  /** Two lowercase hex chars, the trace-context version. */
  version: string;
}

export type SpanStatus = 'ok' | 'error';

export interface SpanAttributes {
  [attribute: string]: string | number | boolean;
}

/** A finished span, in the exact shape that ships as an envelope payload. */
export interface SpanData {
  name: string;
  traceId: string;
  spanId: string;
  /** Parent span id; empty for a root span (the session's own context). */
  parentSpanId: string;
  traceFlags: string;
  status: SpanStatus;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  attributes: SpanAttributes;
}

export interface Span {
  readonly name: string;
  readonly traceparent: string;
  readonly traceId: string;
  setAttribute(attribute: string, value: string | number | boolean): void;
  /** Idempotent: a span ends once, and later `end` calls return the same data. */
  end(status?: SpanStatus): SpanData;
}

function isAllZero(value: string): boolean {
  return /^0+$/.test(value);
}

/**
 * Parses a `traceparent` header value. Returns null for anything malformed —
 * version `ff` is reserved by the spec, all-zero trace or span ids are
 * invalid, and every field must be lowercase hex of the right width. The
 * caller decides what a missing context means (usually: start a new trace).
 */
export function parseTraceparent(value: string | null | undefined): TraceContext | null {
  if (value === null || value === undefined || value.trim() === '') return null;
  const parts = value.trim().split('-');
  if (parts.length !== 4) return null;
  const [version, traceId, parentSpanId, traceFlags] = parts;
  if (!HEX_2.test(version) || version === 'ff') return null;
  if (!TRACE_ID.test(traceId) || isAllZero(traceId)) return null;
  if (!SPAN_ID.test(parentSpanId) || isAllZero(parentSpanId)) return null;
  if (!HEX_2.test(traceFlags)) return null;
  return { version, traceId, parentSpanId, traceFlags };
}

export function formatTraceparent(context: TraceContext): string {
  return `${context.version}-${context.traceId}-${context.parentSpanId}-${context.traceFlags}`;
}

/** A new trace id / span id pair. Collision odds are the spec's problem, not ours. */
export function newTraceIds(): { traceId: string; spanId: string } {
  return { traceId: randomHex(16), spanId: randomHex(8) };
}

export interface StartSpanOptions {
  /**
   * `traceparent` of the span this one nests under. Given one, the child joins
   * the parent's trace with a fresh span id; without one, a new trace starts.
   */
  parentTraceparent?: string | null;
  attributes?: SpanAttributes;
  /** Sampling decision recorded in trace flags: the transport decides what ships. */
  sampled?: boolean;
  now?: () => number;
}

/**
 * Opens a span. The returned object is the only state a caller needs to hold;
 * ending it yields the data record, which the telemetry layer turns into an
 * envelope.
 */
export function startSpan(name: string, options: StartSpanOptions = {}): Span {
  const now = options.now ?? Date.now;
  const parent = parseTraceparent(options.parentTraceparent ?? null);
  const { traceId, spanId } = newTraceIds();
  const resolvedTraceId = parent?.traceId ?? traceId;
  const traceFlags = options.sampled === false ? NOT_SAMPLED_FLAGS : SAMPLED_FLAGS;
  const attributes: SpanAttributes = { ...(options.attributes ?? {}) };
  const startedAt = now();
  let endedData: SpanData | null = null;

  const span: Span = {
    name,
    traceId: resolvedTraceId,
    traceparent: formatTraceparent({
      version: TRACE_VERSION,
      traceId: resolvedTraceId,
      parentSpanId: spanId,
      traceFlags,
    }),
    setAttribute(attribute: string, value: string | number | boolean) {
      attributes[attribute] = value;
    },
    end(status: SpanStatus = 'ok'): SpanData {
      // Ended spans are immutable: the second `end` returns the same record
      // the first one produced, whatever the status argument says.
      if (endedData) return endedData;
      const endedAt = now();
      endedData = {
        name,
        traceId: resolvedTraceId,
        spanId,
        parentSpanId: parent?.parentSpanId ?? '',
        traceFlags,
        status,
        startedAt,
        endedAt,
        durationMs: Math.max(0, endedAt - startedAt),
        attributes,
      };
      return endedData;
    },
  };
  return span;
}

/**
 * The trace context this page was served under, if a deployment provides one.
 *
 * Static hosting cannot inject HTTP headers into a page the browser already
 * has, so the two supported entry points are the ones a static deploy can
 * actually produce: a `traceparent` query parameter (the way a support
 * engineer hands someone a deep link that keeps the incident's trace) or a
 * `<meta name="traceparent">` tag rewritten into the HTML at deploy time.
 * Falls back to null — and therefore a fresh trace — in every other case.
 */
export function readIncomingTraceContext(): TraceContext | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const fromUrl = parseTraceparent(new URLSearchParams(window.location.search).get('traceparent'));
  if (fromUrl) return fromUrl;
  const meta = document.querySelector('meta[name="traceparent"]');
  return parseTraceparent(meta?.getAttribute('content'));
}
