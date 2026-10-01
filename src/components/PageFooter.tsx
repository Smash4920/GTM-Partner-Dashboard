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
}: {
  state: PaginationState<T>;
  noun: string;
  pageSize: number;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
        Showing {state.rows.length} of {state.totalCount} {noun}
        {state.refreshing && ' · updating'}
      </p>
      {state.hasMore && (
        <button
          type="button"
          onClick={state.loadMore}
          disabled={state.loadingMore}
          className="rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20 disabled:opacity-50"
        >
          {state.loadingMore ? 'Loading…' : `Load ${pageSize} more`}
        </button>
      )}
    </div>
  );
}
