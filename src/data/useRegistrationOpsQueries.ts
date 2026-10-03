import type { DataProvider, RegistrationOpsSummary } from './DataProvider';
import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import type { DuplicateRegistrationGroup } from '../lib/metrics';
import { usePaginatedRows } from './paginationState';
import type { PaginationState } from './paginationState';
import { useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import { usePartnerRoster } from './useScopedDirectories';
import type { DealRegistration, Partner } from './types';

/**
 * The Deal Reg Ops route's data, fetched the way it will be fetched in
 * production: five scoped queries in place of the folded registration book.
 * The route is whole-org and time-agnostic by design — exclusivity lapsing
 * and conversion times span quarters — so every scope is the empty
 * drill-down, and the provider computes each answer from the access-scoped
 * rows alone.
 *
 * - `ops`: the conversion-time, SLA, leakage, and conflict counts behind the
 *   KPI tiles and card subtitles.
 * - `pending`, `unconverted`, `duplicates`: the three row collections, one
 *   cursor page at a time; a `loadMore` appends, and a failed page keeps the
 *   pages already loaded.
 * - `roster`: the partner dimension the row tables render names from, with
 *   the session's prospects appended — the only query a new prospect can
 *   change, so it is the only one whose key carries the prospect roster.
 *
 * One rejected call fails exactly one card; its retry repeats only that call.
 */

/** First page of the review queue, matching the card's historical limit. */
const QUEUE_PAGE_SIZE = 10;
const UNCONVERTED_PAGE_SIZE = 8;
const DUPLICATE_PAGE_SIZE = 8;

export interface RegistrationOpsQueryInput {
  provider: DataProvider;
  access: DemoAccessScope;
  prospects: Partner[];
}

export interface RegistrationOpsQueries {
  ops: QueryState<RegistrationOpsSummary>;
  pending: PaginationState<DealRegistration>;
  unconverted: PaginationState<DealRegistration>;
  duplicates: PaginationState<DuplicateRegistrationGroup>;
  roster: QueryState<Partner[]>;
}

export function useRegistrationOpsQueries({
  provider,
  access,
  prospects,
}: RegistrationOpsQueryInput): RegistrationOpsQueries {
  const accessKey = demoScopeKey(access);

  const ops = useScopedQuery({
    provider,
    queryKey: `reg-ops-summary|access:${accessKey}`,
    run: (context) => provider.getRegistrationOpsSummary(access, {}, context),
    errorFallback: 'Failed to load the registration ops summary',
  });

  const pending = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `reg-ops-pending|access:${accessKey}|${QUEUE_PAGE_SIZE}`,
    // Registrations carry no session edits; nothing refreshes this queue.
    refreshKey: '',
    pageSize: QUEUE_PAGE_SIZE,
    fetchPage: (page, context) => provider.listPendingRegistrations(access, {}, page, context),
    errorFallback: 'Failed to load the review queue',
    loadMoreErrorFallback: 'Failed to load more of the review queue',
  });

  const unconverted = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `reg-ops-unconverted|access:${accessKey}|${UNCONVERTED_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: UNCONVERTED_PAGE_SIZE,
    fetchPage: (page, context) => provider.listUnconvertedRegistrations(access, {}, page, context),
    errorFallback: 'Failed to load the unconverted registrations',
    loadMoreErrorFallback: 'Failed to load more unconverted registrations',
  });

  const duplicates = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `reg-ops-duplicates|access:${accessKey}|${DUPLICATE_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: DUPLICATE_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listDuplicateRegistrationGroups(access, {}, page, context),
    errorFallback: 'Failed to load the duplicate registrations',
    loadMoreErrorFallback: 'Failed to load more duplicate registrations',
  });

  const roster = usePartnerRoster(provider, access, prospects);

  return { ops, pending, unconverted, duplicates, roster };
}
