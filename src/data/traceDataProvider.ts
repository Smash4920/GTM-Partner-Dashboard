import { traceProviderRequest } from '../lib/tracing';
import type { DataProvider } from './DataProvider';
import { wrapDataProvider } from './wrapDataProvider';

/**
 * Adds one observable span to every call across the application's integration
 * seam. Context reaches the underlying provider instead of stopping at the
 * browser log: the abort signal passes through untouched, and the created
 * trace context is merged in, which lets an HTTP implementation inject the
 * included `traceparent` and `x-request-id` headers into its request.
 *
 * The wrapper is a Proxy over the real provider, not a re-implementation of
 * its methods, so it cannot drift from the contract: any method added to
 * `DATA_PROVIDER_METHODS` is traced automatically, and everything else
 * (identity, `then`-ables, future surface) passes through untouched. Every
 * contract method takes its `QueryContext` in the same trailing slot
 * (`DATA_PROVIDER_CONTEXT_SLOTS`), so the wrapper rebuilds the argument list
 * with the traced context in that slot — padded in when the caller omitted
 * it, exactly as explicit forwarding methods would.
 */
export function traceDataProvider(inner: DataProvider): DataProvider {
  return wrapDataProvider(inner, (method, context, run) =>
    traceProviderRequest(method, (trace) => run({ ...context, trace }), context?.trace),
  );
}
