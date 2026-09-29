import { DATA_PROVIDER_METHODS, type DataProvider } from '../../data/DataProvider';
import type { ErrorCaptureOptions, ErrorRecord } from './errors';
import { isFlagEnabled } from './flags';
import type { MetricAttributes } from './metrics';
import type { Span, SpanAttributes } from './trace';
import { telemetry } from './telemetry';

/**
 * Wraps a DataProvider so the seam — the one place data crosses into the app —
 * is also the one place every data call is measured.
 *
 * Each call opens a child span of the session trace (`provider.<method>`),
 * records a counter and a duration by method and outcome, and captures
 * failures with the span's trace context attached, so a failing
 * `getForecastSummary` arrives at the collector with the exact `traceparent`
 * it failed under. Spans and metrics are sampled by the transport like every
 * other envelope; errors always ship.
 *
 * The wrapper is a Proxy over the real provider, not a re-implementation of
 * its 15 methods, so it cannot drift from the contract: any method added to
 * `DATA_PROVIDER_METHODS` is instrumented automatically, and everything else
 * (identity, `then`-ables, future surface) passes through untouched.
 */

const PROVIDER_METHODS = new Set<string>(DATA_PROVIDER_METHODS);

/**
 * The slice of telemetry the wrapper needs. The facade satisfies it
 * structurally, and naming the slice keeps this module testable without
 * building a whole transport.
 */
export interface ProviderTelemetry {
  startSpan(name: string, attributes?: SpanAttributes): Span;
  recordCounter(name: string, attributes?: MetricAttributes): void;
  recordDuration(name: string, durationMs: number, attributes?: MetricAttributes): void;
  addBreadcrumb(message: string, data?: Record<string, unknown>): void;
  captureError(error: unknown, options?: ErrorCaptureOptions): ErrorRecord;
}

export function instrumentProvider(
  inner: DataProvider,
  providerId: string,
  client: ProviderTelemetry = telemetry,
): DataProvider {
  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property !== 'string' ||
        typeof value !== 'function' ||
        !PROVIDER_METHODS.has(property)
      ) {
        return value;
      }
      return (...args: unknown[]) =>
        instrumentedCall(client, providerId, property, target, value, args);
    },
  });
}

async function instrumentedCall(
  client: ProviderTelemetry,
  providerId: string,
  method: string,
  target: DataProvider,
  call: unknown,
  args: unknown[],
): Promise<unknown> {
  // The master flag is read per call, so a runtime override takes effect
  // without rebuilding the provider the app already holds.
  if (!isFlagEnabled('telemetry.enabled')) {
    return (call as (...rest: unknown[]) => Promise<unknown>).apply(target, args);
  }
  const span = client.startSpan(`provider.${method}`, { providerId, method });
  try {
    const result = await (call as (...rest: unknown[]) => Promise<unknown>).apply(target, args);
    // The span's own clock is the duration source, so the metric and the
    // trace envelope can never disagree about how long a call took.
    const data = span.end('ok');
    client.recordCounter('provider.call', { method, providerId, status: 'ok' });
    client.recordDuration('provider.call.duration', data.durationMs, { method, providerId });
    return result;
  } catch (error) {
    const data = span.end('error');
    client.recordCounter('provider.call', { method, providerId, status: 'error' });
    client.recordDuration('provider.call.duration', data.durationMs, { method, providerId });
    // Failure is the one breadcrumb worth a slot: it says which call the
    // session was on when the error it is about to capture happened.
    client.addBreadcrumb(`provider.${method} failed`, { method, providerId });
    client.captureError(error, {
      category: 'provider',
      severity: 'warning',
      traceparent: span.traceparent,
    });
    throw error;
  }
}
