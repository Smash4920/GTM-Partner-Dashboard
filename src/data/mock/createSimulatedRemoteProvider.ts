import type { DataProvider } from '../DataProvider';
import type { QueryResult } from '../queryMetadata';
import { wrapDataProvider } from '../wrapDataProvider';
import { abortableDelay, throwIfAborted } from '../../lib/abort';
import { fnv1a } from '../../lib/fnv1a';
import { MockDataProvider } from './MockDataProvider';
import { mulberry32 } from './rng';

export interface RemoteOptions {
  /** Base round-trip latency per call, in milliseconds. */
  latencyMs?: number;
  /** Share of calls that fail, from 0 to 1. */
  failureRate?: number;
  /** Seeds the jitter and the failure draws, so a demo run is repeatable. */
  seed?: number;
  /**
   * A positional failure plan: exactly the first N calls on this instance
   * fail, everything after succeeds. While a plan is set, the seeded failure
   * draw is off and the latency holds at the base value.
   *
   * Positional plans count every call, so what they do to a *named* call
   * depends on how the calls around it are ordered. They exist for flows
   * whose very first call is the one under test (the provider-switch
   * readiness probe behind `?remoteFailFirst=`); anything else should use
   * `failMethods`, which is order-independent.
   */
  failFirstCalls?: number;
  /**
   * A named failure plan: for each listed method, exactly its next N calls on
   * this instance fail, then it succeeds. Calls to other methods neither
   * consume nor shift the plan, so a test can fail "the summary query"
   * without caring what else the page happens to fetch, and replaying the
   * plan on a fresh instance reproduces the same outcomes regardless of
   * unrelated call order.
   *
   * An entry may instead be `{ skip, fail }`: the method's first `skip`
   * calls succeed, then exactly `fail` fail, then it succeeds — so a plan
   * can fail "the second page" of a paginated query without touching the
   * first, the failure a retained list has to survive.
   */
  failMethods?: Partial<Record<keyof DataProvider, number | FailurePlanEntry>>;
  /**
   * The identity stamped into the metadata of every scoped answer that
   * crosses this wire. The inner provider computed the answer, but the
   * committed provider the session is talking to is this one — an answer
   * labelled with the inner identity would read as local data arriving over
   * a remote wire. Defaults to 'remote', the identity this simulation
   * stands for; pass an explicit id only to rehearse another label.
   */
  providerId?: string;
}

const DEFAULT_LATENCY_MS = 250;
const DEFAULT_FAILURE_RATE = 0.15;
const DEFAULT_SEED = 20260918;

/**
 * One entry of a named failure plan: `fail` calls fail after the first
 * `skip` (default 0) succeed. The plain-number form is `{ fail: n }`.
 */
export interface FailurePlanEntry {
  skip?: number;
  fail: number;
}

/**
 * FNV-1a: folds a method name into the seed so each public method draws from
 * its own deterministic stream. A shared stream would make one method's
 * failure pattern depend on how many unrelated calls happened to interleave;
 * per-method streams make the pattern a function of the seed and the method's
 * own call history alone.
 */
function methodSeed(seed: number, method: string): number {
  return (seed ^ fnv1a(method)) >>> 0;
}

/**
 * Any provider, behind a simulated network.
 *
 * Delegation rather than inheritance, because this is not a kind of provider —
 * it is a wire in front of one. That also means it can wrap the scaled book as
 * easily as the mock, and that the two demonstration providers compose instead
 * of multiplying into four classes.
 *
 * It exists so the per-widget loading and error states the production design
 * calls for are exercised rather than theoretical. A local mock answers on the
 * next microtask, which hides every one of them: no spinner is ever seen, no
 * retry is ever pressed, and no view is ever asked to render while a figure it
 * has not received yet is missing.
 *
 * Failure semantics are logical, not partial: one public invocation is one
 * logical load, which incurs exactly one delay and exactly one
 * success/failure decision, made *before* any delegation. A failed call never
 * touches the inner provider, so it cannot half-succeed, and a succeeded call
 * runs the inner method exactly once.
 *
 * Cancellation is part of the wire too. A call made with an already-aborted
 * signal does nothing at all, and a call aborted while the delay is running
 * rejects with an abort error without ever invoking the inner provider. The
 * success/failure decision is made only once the wait completes, so a
 * cancelled call consumes no failure-plan slot and no seeded draw, and a
 * replayed run stays deterministic.
 *
 * Deterministic on purpose. A random failure rate that cannot be reproduced is
 * a flaky demo; the same seed means the same calls fail on the same run, and
 * named failure plans replay identically however the calls around them are
 * ordered.
 *
 * The wire is a Proxy over the inner provider, not a re-implementation of its
 * methods, so it cannot drift from the contract: any method added to
 * `DATA_PROVIDER_METHODS` crosses the wire automatically, and everything else
 * (identity, `then`-ables, future surface) passes through untouched. Every
 * contract method takes its `QueryContext` in the same trailing slot
 * (`DATA_PROVIDER_CONTEXT_SLOTS`), which is where the wire reads the abort
 * signal from.
 */
export function createSimulatedRemoteProvider(
  inner: DataProvider = new MockDataProvider(),
  options: RemoteOptions = {},
): DataProvider {
  const latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
  const failureRate = options.failureRate ?? DEFAULT_FAILURE_RATE;
  const failFirstCalls =
    options.failFirstCalls !== undefined
      ? Math.max(0, Math.floor(options.failFirstCalls))
      : undefined;
  const failMethods =
    options.failMethods !== undefined
      ? new Map(
          Object.entries(options.failMethods).map(([method, entry]) => {
            const plan = typeof entry === 'number' ? { fail: entry } : entry;
            return [
              method,
              {
                skip: Math.max(0, Math.floor(plan?.skip ?? 0)),
                fail: Math.max(0, Math.floor(plan?.fail ?? 0)),
              },
            ];
          }),
        )
      : undefined;
  const seed = options.seed ?? DEFAULT_SEED;
  const providerId = options.providerId ?? 'remote';

  /** Public invocations so far; the positional plan counts them. */
  let calls = 0;
  /** One deterministic stream per public method. */
  const streams = new Map<string, () => number>();

  function streamFor(method: string): () => number {
    let stream = streams.get(method);
    if (stream === undefined) {
      stream = mulberry32(methodSeed(seed, method));
      streams.set(method, stream);
    }
    return stream;
  }

  /**
   * The plan's say on this call. While a plan exists it owns every failure
   * decision outright — no draw, no jitter — so a scripted run replays
   * identically no matter what else was called. Consumed only once the wait
   * completes: a call aborted in transit spends no slot.
   */
  function plannedFailure(method: string): boolean {
    calls += 1;
    if (failFirstCalls !== undefined && calls <= failFirstCalls) return true;
    const plan = failMethods?.get(method);
    if (plan !== undefined) {
      // Skips are spent first, so a plan can aim at a call past the first —
      // the load-more failure a retained page has to survive.
      if (plan.skip > 0) {
        plan.skip -= 1;
        return false;
      }
      if (plan.fail > 0) {
        plan.fail -= 1;
        return true;
      }
    }
    return false;
  }

  /** The wire: one wait, one decision, then either the answer or a failure. */
  async function roundTrip<T>(
    method: keyof DataProvider,
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    // A call that arrives already cancelled does no work at all.
    throwIfAborted(signal);
    const planned = failFirstCalls !== undefined || failMethods !== undefined;
    // Jitter, because a fixed delay hides the difference between a fast page
    // and a slow one. The draws come from this method's own stream, so the
    // outcome depends on the seed and this method's call history — never on
    // how unrelated calls happened to interleave. A plan holds the latency at
    // the base value and skips the stream entirely.
    const random = planned ? undefined : streamFor(method);
    const wait = planned ? latencyMs : Math.round(latencyMs * (0.6 + random!() * 0.8));
    // The wait is the cancellable part: an abort here rejects without
    // touching the inner provider, and without spending a plan slot or a
    // failure draw.
    await abortableDelay(wait, signal);
    const failed = planned ? plannedFailure(method) : random!() < failureRate;
    if (failed) {
      throw new Error(`${method} failed in transit (simulated)`);
    }
    return run();
  }

  /**
   * Re-labels a scoped answer with this provider's identity when one is set.
   * Latency and failure are the wire's to add; the answer's origin label is
   * the committed provider's, or the metadata would misattribute the source.
   */
  async function stamp<T>(promise: Promise<QueryResult<T>>): Promise<QueryResult<T>> {
    const result = await promise;
    if (providerId === undefined) return result;
    return { ...result, meta: { ...result.meta, providerId } };
  }

  return wrapDataProvider(inner, (method, context, run) =>
    stamp(roundTrip(method, context?.signal, () => run(context))),
  );
}
