import { DATA_PROVIDER_CONTEXT_SLOTS, type DataProvider } from './DataProvider';
import type { QueryContext } from './queryContext';
import type { QueryResult } from './queryMetadata';

type ProviderInvocation = (context: QueryContext | undefined) => Promise<QueryResult<unknown>>;

/**
 * Shares the seam's reflection and call shape, not its interception policy.
 * The interceptor controls when delegation happens and which trailing context
 * it receives; preparing a call never invokes the target or adds an async hop.
 */
export function wrapDataProvider(
  inner: DataProvider,
  intercept: (
    method: keyof DataProvider,
    context: QueryContext | undefined,
    run: ProviderInvocation,
  ) => Promise<QueryResult<unknown>>,
): DataProvider {
  return new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (
        typeof property !== 'string' ||
        typeof value !== 'function' ||
        !Object.hasOwn(DATA_PROVIDER_CONTEXT_SLOTS, property)
      ) {
        return value;
      }
      const method = property as keyof DataProvider;
      const contextSlot = DATA_PROVIDER_CONTEXT_SLOTS[method];
      return (...args: unknown[]) => {
        const context = args[contextSlot] as QueryContext | undefined;
        // Drop anything beyond the declared context and explicitly pad omitted
        // business arguments, exactly as the original forwarding wrappers did.
        const forwarded = args.slice(0, contextSlot);
        // Spreading below materializes every missing slot as undefined.
        forwarded.length = contextSlot;
        return intercept(method, context, (nextContext) =>
          (value as (...rest: unknown[]) => Promise<QueryResult<unknown>>).apply(target, [
            ...forwarded,
            nextContext,
          ]),
        );
      };
    },
  });
}
