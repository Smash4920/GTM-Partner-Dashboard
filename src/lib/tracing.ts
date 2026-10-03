import { isAbortError } from './abort';
import { logger } from './logging';

const TRACE_VERSION = '00';
const SAMPLED_FLAGS = '01';

interface TraceHeaders {
  traceparent: string;
  'x-request-id': string;
}

/**
 * Correlation data carried across the DataProvider boundary.
 *
 * A future HTTP provider can pass `headers` directly to `fetch`; the simulated
 * provider forwards the same context to its inner provider today. The
 * `traceparent` value follows the W3C Trace Context format.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  requestId: string;
  headers: TraceHeaders;
}

function randomHex(byteLength: number): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(byteLength));
  if (bytes.every((value) => value === 0)) bytes[bytes.length - 1] = 1;
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function requestId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Starts a root trace, or a child span that preserves the caller's trace. */
export function createTraceContext(parent?: TraceContext): TraceContext {
  const traceId = parent?.traceId ?? randomHex(16);
  const spanId = randomHex(8);
  const id = parent?.requestId ?? requestId();
  return {
    traceId,
    spanId,
    parentSpanId: parent?.spanId,
    requestId: id,
    headers: {
      traceparent: `${TRACE_VERSION}-${traceId}-${spanId}-${SAMPLED_FLAGS}`,
      'x-request-id': id,
    },
  };
}

/**
 * Runs one provider operation as a traced span and preserves failures.
 *
 * Start, completion, and failure records share identifiers with the context
 * handed to the provider, so browser logs can be joined with downstream logs.
 */
export async function traceProviderRequest<T>(
  operation: string,
  run: (context: TraceContext) => Promise<T>,
  parent?: TraceContext,
): Promise<T> {
  const context = createTraceContext(parent);
  const log = logger.child({
    component: 'DataProvider',
    operation,
    requestId: context.requestId,
    traceId: context.traceId,
    spanId: context.spanId,
    parentSpanId: context.parentSpanId,
  });
  const startedAt = performance.now();
  log.debug('Provider request started');
  try {
    const result = await run(context);
    log.debug('Provider request completed', {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
    return result;
  } catch (error) {
    // A cancellation is the caller walking away, not a failure: it stays out
    // of the error log and out of error telemetry.
    if (isAbortError(error)) {
      log.debug('Provider request aborted', {
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      });
      throw error;
    }
    log.error('Provider request failed', {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error,
    });
    throw error;
  }
}
