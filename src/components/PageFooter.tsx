import type { PaginationState } from '../data/paginationState';

/**
 * The footer count line under a paginated table, with a Load more control.
 * One component for every cursor-paginated card, so "Showing N of M" and the
 * page-fetch button cannot drift between routes.
 */
export default function PageFooter<T>({
  state,
  noun,
  pageSize,
  buttonLabel = `Load ${pageSize} more`,
  countNoun = true,
}: {
  state: PaginationState<T>;
  noun: string;
  pageSize: number;
  buttonLabel?: string;
  countNoun?: boolean;
}) {
  const busy = state.loading || state.loadingMore || state.refreshing;
  const unavailable = busy || (!state.hasMore && !state.error);
  return (
    <div
      className="mt-3 flex flex-wrap items-center justify-between gap-3"
      role="group"
      aria-label={`${noun} pagination`}
    >
      <p
        role="status"
        aria-atomic="true"
        className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
      >
        <span>
          Showing {state.rows.length} of {state.totalCount}
          {countNoun ? ` ${noun}` : ''}
        </span>
        {state.loadingMore ? (
          ` · Loading more ${noun}`
        ) : state.refreshing ? (
          ` · Updating ${noun}`
        ) : state.error ? (
          <>
            {' '}
            · {noun} failed: <span>{state.error}</span>
          </>
        ) : !state.hasMore ? (
          ' · end of results'
        ) : (
          ''
        )}
      </p>
      <button
        type="button"
        onClick={() => {
          if (!unavailable) (state.error ? state.retry : state.loadMore)();
        }}
        aria-label={state.error ? `Retry ${noun}` : buttonLabel}
        aria-disabled={unavailable}
        className="rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20 aria-disabled:opacity-50"
      >
        {busy ? 'Loading…' : state.error ? 'Retry' : buttonLabel}
      </button>
    </div>
  );
}
