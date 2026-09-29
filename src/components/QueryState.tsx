import type { ReactNode } from 'react';
import type { QueryMeta } from '../data/queryMetadata';
import type { QueryState } from '../data/queryState';
import { formatDate } from '../lib/format';

/**
 * The four states every scoped query can be in, rendered one way everywhere:
 *
 * - **loading**: no answer yet, no error either.
 * - **stale**: a previous answer stays on screen while its replacement is in
 *   flight, and the caption says so — with the as-of of the data actually
 *   rendering, never of the answer still in flight.
 * - **partial**: the provider returned usable data with typed warnings; the
 *   data renders and each warning is listed next to it.
 * - **unavailable**: the query failed before any answer existed; the widget
 *   names itself and offers a retry that repeats only that query.
 *
 * One component set owns these states so a new query surface cannot invent a
 * fifth way to be broken (a silent blank, a spinner forever, an error with no
 * way back).
 */

const RETRY_BUTTON_CLASS =
  'rounded border border-ash px-3 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20';

/** One query's initial load: nothing to show yet, no error either. */
export function QueryLoading({ label }: { label: string }) {
  return (
    <p
      role="status"
      className="flex items-center gap-2 py-6 font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
    >
      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
      Loading {label}
    </p>
  );
}

/** A named failure with a retry that repeats only the failed query. */
export function QueryFailure({
  text,
  retryLabel,
  error,
  onRetry,
}: {
  text: string;
  retryLabel: string;
  error: string;
  onRetry: () => void;
}) {
  return (
    <p className="flex flex-wrap items-center gap-3 py-2 text-sm text-bone">
      <span className="text-signal">{text}:</span>
      {error}
      <button
        type="button"
        onClick={onRetry}
        aria-label={`Retry ${retryLabel}`}
        className={RETRY_BUTTON_CLASS}
      >
        Retry
      </button>
    </p>
  );
}

/**
 * The metadata caption under a settled answer: who produced it, as of when,
 * and whether it is complete. While a refresh is in flight the visible data
 * is the previous answer, so the caption says "updating" against the as-of of
 * what is actually on screen. Partial answers list their warnings here, next
 * to the data they describe.
 */
export function QueryMetaCaption({ meta, refreshing }: { meta: QueryMeta; refreshing: boolean }) {
  return (
    <div className="mb-3 space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
        As of {formatDate(meta.asOf)} · provider {meta.providerId} · {meta.completeness}
        {refreshing && ' · updating — showing the last good answer'}
      </p>
      {meta.warnings.map((warning) => (
        <p key={warning.code} className="flex items-center gap-1.5 text-xs text-signal">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-signal" />
          {warning.message}
        </p>
      ))}
    </div>
  );
}

/**
 * One widget, one query: the region shows its own initial loading, its own
 * unavailable state with a focused retry, or its data — with a refresh
 * failure reported alongside figures that stay on screen (stale beats blank),
 * and the answer's metadata caption above them. A sibling widget's state
 * never enters into any of those branches.
 */
export function renderQueryState<T>(
  label: string,
  state: QueryState<T>,
  render: (data: T) => ReactNode,
): ReactNode {
  if (state.data === null) {
    if (state.error !== null) {
      return (
        <QueryFailure
          text={`${label.charAt(0).toUpperCase()}${label.slice(1)} unavailable`}
          retryLabel={label}
          error={state.error}
          onRetry={state.retry}
        />
      );
    }
    return <QueryLoading label={label} />;
  }
  return (
    <>
      {state.error !== null && (
        <QueryFailure
          text={`Latest ${label} refresh failed`}
          retryLabel={label}
          error={state.error}
          onRetry={state.retry}
        />
      )}
      {state.meta !== null && <QueryMetaCaption meta={state.meta} refreshing={state.refreshing} />}
      {render(state.data)}
    </>
  );
}
