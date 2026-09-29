import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataProvider } from './DataProvider';

/**
 * The independent state of one logical query — one widget's worth of data.
 *
 * This is the primitive behind the Forecasting view's per-widget resilience:
 * each aggregate runs through its own `useScopedQuery`, so a rejected call
 * fails exactly one region of the page, its retry repeats only that call, and
 * its siblings are never asked to re-render, let alone to refetch.
 *
 * Semantics, per query:
 *
 * - `loading`: no successful answer yet and no error — the initial fetch is
 *   in flight. Distinct from `refreshing`, which only exists over data.
 * - `refreshing`: a later answer is in flight while the previous one stays on
 *   screen. Stale beats blank: an edit must not flash the figures it changed.
 * - `error`: the last attempt failed. When data exists it stays visible and
 *   the error rides alongside it; when none does, the widget is unavailable
 *   and exposes `retry`, which repeats only this query.
 * - Race safety: every settled value is tagged with the provider that
 *   produced it and is gated at read time, and each request carries an
 *   abort-tagged sequence guard, so a late answer from a superseded provider
 *   or an abandoned render cycle is dropped — never rendered, not even for
 *   one frame. An aborted request writes nothing, so aborts are silent.
 */
export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  retry: () => void;
}

/** The message the UI shows for a rejected query. */
export function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A stable, content-based serialization of an edit map, for building query
 * keys. Two maps with the same entries serialize identically no matter how
 * the objects were rebuilt, which is what makes "a re-render that changed
 * nothing issues no request" testable: the key changes exactly when the
 * edits the query depends on change.
 */
export function editMapKey(map: Record<string, string | number>): string {
  return Object.keys(map)
    .sort()
    .map((key) => `${key}=${String(map[key])}`)
    .join('&');
}

/** A settled answer, tagged with the provider that produced it. */
interface QueryEntry<T> {
  provider: DataProvider;
  data: T | null;
  error: string | null;
}

/**
 * One logical query with its own loading/error/retry state.
 *
 * `queryKey` must be built from the primitive values the query depends on —
 * the quarter, the manager, the relevant edit maps — never from an object
 * rebuilt every render. The effect keys on it directly, which is both the
 * refetch loop guard and the invalidation mechanism: a change to a value in
 * the key refetches, and a change to anything else does not. `run` is read
 * through a ref so it always sees the latest render's inputs without becoming
 * a dependency itself.
 */
export function useScopedQuery<T>(args: {
  provider: DataProvider;
  queryKey: string;
  run: () => Promise<T>;
  /** Fallback message when the rejection carries none. */
  errorFallback: string;
}): QueryState<T> {
  const { provider, queryKey, errorFallback } = args;
  const [entry, setEntry] = useState<QueryEntry<T> | null>(null);
  const [inFlight, setInFlight] = useState(true);
  const [attempt, setAttempt] = useState(0);
  // Answers can arrive out of order when edits land faster than the provider
  // replies. Only the newest request is allowed to write.
  const latest = useRef(0);
  const runRef = useRef(args.run);
  runRef.current = args.run;
  const fallbackRef = useRef(errorFallback);
  fallbackRef.current = errorFallback;

  useEffect(() => {
    const request = ++latest.current;
    const controller = new AbortController();
    setInFlight(true);
    runRef.current().then(
      (data) => {
        if (controller.signal.aborted || request !== latest.current) return;
        setEntry({ provider, data, error: null });
        setInFlight(false);
      },
      (error: unknown) => {
        if (controller.signal.aborted || request !== latest.current) return;
        // Stale beats blank: a failed refresh keeps the same-provider figures
        // already on screen and reports the error alongside them. Only an
        // initial failure leaves the widget with no data at all.
        setEntry((prev) => ({
          provider,
          data: prev !== null && prev.provider === provider ? prev.data : null,
          error: messageOf(error, fallbackRef.current),
        }));
        setInFlight(false);
      },
    );
    return () => controller.abort();
  }, [provider, queryKey, attempt]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  // Read-time gating: a value only exists for the provider that produced it.
  // Anything else is this provider's loading state, never stale data.
  const current = entry !== null && entry.provider === provider ? entry : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  return {
    data,
    loading: inFlight && data === null,
    refreshing: inFlight && data !== null,
    error,
    retry,
  };
}
