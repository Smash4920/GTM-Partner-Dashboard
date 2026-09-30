import type { TraceContext } from '../lib/tracing';

/**
 * The per-call context every `DataProvider` method accepts as its last
 * argument.
 *
 * Two concerns ride together because they share a lifetime — one logical
 * request:
 *
 * - `signal` cancels provider-visible work. Every hook that issues a request
 *   holds an AbortController and aborts it the moment the request becomes
 *   obsolete: the provider, scope, or query key changed, a retry superseded
 *   the attempt, or the component unmounted. A provider that honours the
 *   signal stops waiting and rejects with an abort error; one that ignores
 *   it is still fenced off by the hooks' generation and sequence guards, so
 *   a late answer is dropped either way. An abort is a cancellation, not a
 *   failure — it is never rendered as an error, logged as one, or captured
 *   by telemetry.
 * - `trace` correlates the call across the seam. `TracedDataProvider`
 *   creates it per call and merges it into the context the underlying
 *   provider receives, so a real HTTP implementation can put the headers on
 *   the wire.
 *
 * The context is optional at the type level because tests and one-shot
 * callers (the health ping) legitimately fire-and-forget; every request the
 * React layer issues carries a live signal.
 */
export interface QueryContext {
  signal?: AbortSignal;
  trace?: TraceContext;
}
