import type { PaginationState } from '../data/paginationState';
import type { ActionItem } from '../data/types';

export default function ActionPagination({ state }: { state: PaginationState<ActionItem> }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p role="status" aria-live="polite" className="font-mono text-xs text-granite">
        <span>
          Showing {state.rows.length} of {state.totalCount} action items
        </span>
        {state.loadingMore
          ? ' · loading more'
          : state.refreshing
            ? ' · updating'
            : !state.hasMore
              ? ' · end of results'
              : ''}
      </p>
      <button
        type="button"
        onClick={() => {
          if (state.hasMore && !state.loadingMore && !state.refreshing) state.loadMore();
        }}
        aria-label="Load 25 more"
        aria-disabled={state.loadingMore || state.refreshing || !state.hasMore}
        className="rounded border border-ash px-3 py-2 text-xs text-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone aria-disabled:opacity-40"
      >
        {state.loadingMore ? 'Loading…' : 'Load 25 more'}
      </button>
    </div>
  );
}
