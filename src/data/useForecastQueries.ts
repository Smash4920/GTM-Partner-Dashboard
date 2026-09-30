import type {
  DataProvider,
  ForecastQualitySummary,
  ForecastScope,
  ForecastSummary,
  ManagerForecastGroup,
  WeeklySeriesRow,
  WeightedForecastSummary,
} from './DataProvider';
import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { usePaginatedRows } from './paginationState';
import type { PaginationState } from './paginationState';
import type { QueryMeta } from './queryMetadata';
import { editMapKey, useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { Opportunity } from './types';

/**
 * The Forecasting view's data, fetched the way it will be fetched in
 * production: a handful of independent aggregates plus one page of rows per
 * expanded manager, each with its own loading, error, and retry state. One
 * rejected call fails exactly one widget; the others are not asked to
 * re-render, let alone to refetch.
 *
 * Invalidation is narrow, and it lives in the query keys. Each key is built
 * from the primitive values its query depends on — the quarter and the edit
 * maps that can change its answer — so:
 *
 * - a revenue edit refetches the summary, weighted forecast, quality, groups,
 *   weekly series, and each loaded book window whose rows it touches;
 * - a forecast-call edit refetches the weighted forecast, quality, weekly
 *   series, and the touched book windows, but not the summary or the groups,
 *   whose figures a re-call does not move;
 * - a book window the edit does not touch refetches nothing: the pagination
 *   primitive tracks which edit values each loaded row was fetched with, and
 *   an edit to another manager's deals changes none of them;
 * - a note or next-step edit refetches nothing here: the rows render the
 *   session's value over the provider's, and no aggregate reads either field;
 * - a re-render that changed nothing — a rebuilt-but-equal edits object, a
 *   filter toggle, a collapsed group reopening — refetches nothing either,
 *   because the keys are unchanged.
 *
 * The manager filter scopes the summary: target, remaining quota,
 * attainment, and coverage are only honest against the targets committed to
 * the selected manager's own partners, so the manager is part of the
 * summary's query key and provider scope. The weighted forecast, quality,
 * and groups stay quarter-level — the filter narrows which groups and books
 * render, not the quarter's forecast. `getWeeklyForecastSeries` is the
 * documented exception to manager scoping altogether — a snapshot row does
 * not record whose book a deal was in, so a manager-filtered chart would
 * draw a cliff that never happened.
 *
 * Race safety comes from the two shared primitives: results are tagged with
 * the provider that produced them and gated at read time, and every request
 * passes its AbortSignal to the provider through the query context, so
 * obsolete work is cancelled at the seam — and a provider that ignores the
 * signal still has its late answers dropped by the sequence guard, never
 * rendered, not even for one frame.
 */

/** How many mismatching deals the forecast-quality card shows per side. */
const MISMATCH_SAMPLE_SIZE = 3;

/** Rows per page of one manager's book. */
const MANAGER_BOOK_PAGE_SIZE = 25;

function editsOf(scope: ForecastScope) {
  return scope.edits ?? NO_SESSION_EDITS;
}

/** The quarter's headline numbers: moved by revenue edits and the manager scope. */
export function useForecastSummary(
  provider: DataProvider,
  access: DemoAccessScope,
  scope: ForecastScope,
): QueryState<ForecastSummary> {
  const edits = editsOf(scope);
  const managerId = scope.partnerManagerId ?? 'all';
  return useScopedQuery({
    provider,
    queryKey: `access:${demoScopeKey(access)}|${scope.quarter}|manager:${managerId}|rev:${editMapKey(edits.revenueOverrides)}`,
    run: (context) =>
      provider.getForecastSummary(
        access,
        {
          quarter: scope.quarter,
          partnerManagerId: scope.partnerManagerId,
          edits,
        },
        context,
      ),
    errorFallback: 'Failed to load the forecast summary',
  });
}

/** The probability-weighted forecast: moved by revenue and re-calls. */
export function useWeightedForecast(
  provider: DataProvider,
  access: DemoAccessScope,
  scope: ForecastScope,
): QueryState<WeightedForecastSummary> {
  const edits = editsOf(scope);
  return useScopedQuery({
    provider,
    queryKey: `access:${demoScopeKey(access)}|${scope.quarter}|rev:${editMapKey(edits.revenueOverrides)}|call:${editMapKey(edits.forecastCalls)}`,
    run: (context) =>
      provider.getWeightedForecast(access, { quarter: scope.quarter, edits }, context),
    errorFallback: 'Failed to load the weighted forecast',
  });
}

/** Stage-versus-call disagreements: moved by revenue and re-calls. */
export function useForecastQuality(
  provider: DataProvider,
  access: DemoAccessScope,
  scope: ForecastScope,
): QueryState<ForecastQualitySummary> {
  const edits = editsOf(scope);
  return useScopedQuery({
    provider,
    queryKey: `access:${demoScopeKey(access)}|${scope.quarter}|rev:${editMapKey(edits.revenueOverrides)}|call:${editMapKey(edits.forecastCalls)}`,
    run: (context) =>
      provider.getForecastQuality(
        access,
        { quarter: scope.quarter, edits },
        MISMATCH_SAMPLE_SIZE,
        context,
      ),
    errorFallback: 'Failed to load the forecast quality',
  });
}

/** The per-manager header lines: moved by revenue edits only. */
export function useManagerGroups(
  provider: DataProvider,
  access: DemoAccessScope,
  scope: ForecastScope,
): QueryState<ManagerForecastGroup[]> {
  const edits = editsOf(scope);
  return useScopedQuery({
    provider,
    queryKey: `access:${demoScopeKey(access)}|${scope.quarter}|rev:${editMapKey(edits.revenueOverrides)}`,
    run: (context) =>
      provider.getManagerForecastGroups(access, { quarter: scope.quarter, edits }, context),
    errorFallback: 'Failed to load the manager groups',
  });
}

/** The week-over-week series: moved by revenue and re-calls. */
export function useWeeklySeries(
  provider: DataProvider,
  access: DemoAccessScope,
  scope: ForecastScope,
): QueryState<WeeklySeriesRow[]> {
  const edits = editsOf(scope);
  return useScopedQuery({
    provider,
    queryKey: `access:${demoScopeKey(access)}|${scope.quarter}|rev:${editMapKey(edits.revenueOverrides)}|call:${editMapKey(edits.forecastCalls)}`,
    run: (context) =>
      provider.getWeeklyForecastSeries(access, { quarter: scope.quarter, edits }, context),
    errorFallback: 'Failed to load the weekly series',
  });
}

export interface PartnerNamesState {
  names: Record<string, string>;
  /**
   * The directory answer's envelope — committed provider, as-of, lineage,
   * completeness, and warnings — preserved rather than dropped, so a partial
   * directory can say so where its names are rendered.
   */
  meta: QueryMeta | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * Partner id to name, for rendering a row's partner column.
 *
 * A dimension lookup rather than data: it does not move when the forecast
 * does, so it is fetched once per provider and never invalidated by edits. A
 * failure degrades the table to opaque partner ids — legible, and clearly
 * not a name — with a retry offered alongside, instead of taking the table
 * down. On a provider switch the previous provider's names are dropped
 * immediately: a name from another directory is a cross-source label.
 */
export function usePartnerNames(
  provider: DataProvider,
  access: DemoAccessScope,
): PartnerNamesState {
  const directory = useScopedQuery({
    provider,
    queryKey: `partner-directory|access:${demoScopeKey(access)}`,
    run: async (context) => {
      const result = await provider.getPartnerDirectory(access, context);
      return {
        data: Object.fromEntries(result.data.map((partner) => [partner.id, partner.name])),
        meta: result.meta,
      };
    },
    errorFallback: 'Failed to load the partner directory',
  });
  return {
    names: directory.data ?? {},
    meta: directory.meta,
    loading: directory.loading,
    refreshing: directory.refreshing,
    error: directory.error,
    retry: directory.retry,
  };
}

export type ManagerBookState = PaginationState<Opportunity>;

/**
 * One manager's in-quarter book, a page at a time. Pass `null` for a manager
 * who has no group open: nothing is fetched until a group is expanded.
 *
 * Revenue and forecast-call edits refresh the loaded window in place (they
 * cannot change which deals belong to the book, only what the rows say), and
 * only when the edit touches a loaded row — another opened manager's book
 * does not refetch because this one's deal was edited. Note and next-step
 * edits do not refetch at all, because the table renders the session's value
 * over the provider's. A different manager, quarter, or provider is a
 * different collection and starts from the first page.
 */
export function useManagerBook(
  provider: DataProvider,
  access: DemoAccessScope,
  scope: ForecastScope,
  managerId: string | null,
  pageSize: number = MANAGER_BOOK_PAGE_SIZE,
): ManagerBookState {
  const { quarter } = scope;
  const edits = editsOf(scope);
  return usePaginatedRows({
    provider,
    enabled: managerId !== null,
    resetKey: `access:${demoScopeKey(access)}|${quarter}|${managerId ?? 'none'}|${pageSize}`,
    refreshKey: `rev:${editMapKey(edits.revenueOverrides)}|call:${editMapKey(edits.forecastCalls)}`,
    pageSize,
    fetchPage: (page, context) =>
      provider.listQuarterOpportunities(
        access,
        { quarter, partnerManagerId: managerId ?? undefined, edits },
        page,
        context,
      ),
    rowEdits: {
      maps: { rev: edits.revenueOverrides, call: edits.forecastCalls },
      idOf: (row) => row.id,
    },
    errorFallback: 'Failed to load this manager’s book',
    loadMoreErrorFallback: 'Failed to load more of this book',
  });
}
