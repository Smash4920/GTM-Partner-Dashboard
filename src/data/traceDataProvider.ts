import { traceProviderRequest } from '../lib/tracing';
import {
  DATA_PROVIDER_CONTEXT_SLOTS,
  DATA_PROVIDER_METHODS,
  type DataProvider,
} from './DataProvider';
import type { QueryContext } from './queryContext';

const PROVIDER_METHODS = new Set<string>(DATA_PROVIDER_METHODS);

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
      const method = property as keyof DataProvider;
      const contextSlot = DATA_PROVIDER_CONTEXT_SLOTS[method];
      return (...args: unknown[]) => {
        const context = args[contextSlot] as QueryContext | undefined;
        // Rebuild the full argument list with the traced context in the
        // contract's trailing slot, padding arguments the caller omitted.
        const forwarded = args.slice(0, contextSlot);
        while (forwarded.length < contextSlot) {
          forwarded.push(undefined);
        }
        return traceProviderRequest(
          method,
          (trace) =>
            (value as (...rest: unknown[]) => Promise<unknown>).apply(target, [
              ...forwarded,
              { ...context, trace },
            ]),
          context?.trace,
        );
      };
    },
  });
}
