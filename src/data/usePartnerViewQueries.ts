import type {
  DataProvider,
  PartnerCertificationProfile,
  PartnerLeaderboardEntry,
  PerformanceSummary,
  RegistrationOpsSummary,
  StageBreakdown,
} from './DataProvider';
import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import type { QuarterRevenueRow, TypeRow } from '../lib/metrics';
import { usePaginatedRows } from './paginationState';
import type { PaginationState } from './paginationState';
import { prospectsKey, useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import type { DealRegistration, FiscalPhase, Opportunity, OpportunityType, Partner } from './types';

/**
 * The Partner View route's data, fetched the way the partner portal will
 * fetch it in production: the picker chooses a partner, and every card's
 * answer is computed by the provider from that partner's audience scope —
 * their visible deals (Sell To never crosses), their conflict-free
 * registrations, their targets. Nothing about another partner reaches the
 * route.
 *
 * Two halves, because the picker is a demo-only control (see the note next
 * to it: client filtering is not authorization):
 *
 * - `usePartnerPickerQueries` feeds the picker itself. Its options are every
 *   partner on the internal roster — that is the frozen demo behavior — and
 *   its default is the top of the leaderboard over the revenue a portal can
 *   actually show, the same rule the folded book applied: Sell With and
 *   Allocate summed, Sell To excluded.
 * - `usePartnerViewQueries` fetches the selected partner's projection under
 *   a partner-audience scope. It runs only once a selection exists, so the
 *   view mounts it in a child that renders after the picker has resolved.
 *
 * One rejected call fails exactly one card; its retry repeats only that
 * call. The pipeline table and the registration cards paginate a cursor at
 * a time; a failed page keeps the pages already loaded.
 */

/** The revenue motions the partner portal can show — Sell To is internal-only. */
export type PartnerSlice = Extract<OpportunityType, 'sell-with' | 'allocate'> | 'all';

/** Rows per page of the partner's pipeline table and registration cards. */
const PIPELINE_PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 8;
const EXCLUSIVITY_PAGE_SIZE = 6;

export interface PartnerPickerQueryInput {
  provider: DataProvider;
  prospects: Partner[];
}

export interface PartnerPickerQueries {
  /** Every partner, for the picker's options — the frozen demo behavior. */
  roster: QueryState<Partner[]>;
  /**
   * The partner the portal opens on: the top of the leaderboard over
   * portal-visible revenue (Sell With + Allocate; Sell To cannot drive the
   * pick because the portal cannot show it). Null when no partner exists.
   */
  defaultPick: QueryState<string | null>;
}

/**
 * Merges the two portal-visible leaderboards into the legacy default-pick
 * ranking: one row per roster partner, closed-won then open-pipeline
 * descending. The two boards cover the same roster (they differ only in
 * their type lens), so every partner appears in both.
 */
function mergedVisibleLeaderboard(
  sellWith: PartnerLeaderboardEntry[],
  allocate: PartnerLeaderboardEntry[],
): PartnerLeaderboardEntry[] {
  const allocateByPartner = new Map(allocate.map((row) => [row.partner.id, row]));
  const merged = sellWith.map((row) => {
    const other = allocateByPartner.get(row.partner.id);
    return {
      ...row,
      closedWonValue: row.closedWonValue + (other?.closedWonValue ?? 0),
      openPipelineValue: row.openPipelineValue + (other?.openPipelineValue ?? 0),
    };
  });
  // The leaderboard's own comparator; the sort is stable, so ties keep the
  // roster order exactly as the folded-book ranking did.
  merged.sort(
    (a, b) => b.closedWonValue - a.closedWonValue || b.openPipelineValue - a.openPipelineValue,
  );
  return merged;
}

export function usePartnerPickerQueries({
  provider,
  prospects,
}: PartnerPickerQueryInput): PartnerPickerQueries {
  // The picker is internal-facing demo furniture: its options are the whole
  // roster, and its default ranks partners on portal-visible revenue.
  const pickerAccess: DemoAccessScope = { audience: 'internal' };
  const accessKey = demoScopeKey(pickerAccess);
  const rosterKey = prospectsKey(prospects);

  const roster = useScopedQuery({
    provider,
    queryKey: `partner-view-picker-roster|access:${accessKey}|prospects:${rosterKey}`,
    run: (context) => provider.getPartnerRoster(pickerAccess, { prospects }, context),
    errorFallback: 'Failed to load the partner list',
  });

  const defaultPick = useScopedQuery<string | null>({
    provider,
    queryKey: `partner-view-default|access:${accessKey}|prospects:${rosterKey}`,
    run: async (context) => {
      const [sellWith, allocate] = await Promise.all([
        provider.getPartnerLeaderboard(
          pickerAccess,
          { phase: 'fy', oppType: 'sell-with', prospects },
          context,
        ),
        provider.getPartnerLeaderboard(
          pickerAccess,
          { phase: 'fy', oppType: 'allocate', prospects },
          context,
        ),
      ]);
      const top = mergedVisibleLeaderboard(sellWith.data, allocate.data)[0];
      return { data: top?.partner.id ?? null, meta: sellWith.meta };
    },
    errorFallback: 'Failed to rank the partners',
  });

  return { roster, defaultPick };
}

export interface PartnerViewQueryInput {
  provider: DataProvider;
  /** The picker's selection; the hook runs under this partner's audience scope. */
  partnerId: string;
  phase: FiscalPhase;
  /** The revenue-motion lens: 'all' or one motion. */
  slice: PartnerSlice;
  prospects: Partner[];
}

export interface PartnerViewQueries {
  /** Pipeline, closed-won, attainment, coverage, and win rate behind the KPI tiles. */
  summary: QueryState<PerformanceSummary>;
  /** Open pipeline by stage, for the stage bars. */
  stages: QueryState<StageBreakdown>;
  /** The phase's open pipeline split across motions — always the full visible book. */
  motions: QueryState<TypeRow[]>;
  /** Closed-won by quarter against target, under the motion lens. */
  trend: QueryState<QuarterRevenueRow[]>;
  /** The partner's certification record, or its explicit absence. */
  certification: QueryState<PartnerCertificationProfile | null>;
  /** Conversion times and the pending/leakage counts behind the registration cards. */
  ops: QueryState<RegistrationOpsSummary>;
  /** Registration history, newest first, a page at a time. */
  history: PaginationState<DealRegistration>;
  /** Approved registrations without an opportunity, a page at a time. */
  exclusivity: PaginationState<DealRegistration>;
  /** The phase's pipeline rows under the motion lens, a page at a time. */
  pipeline: PaginationState<Opportunity>;
}

export function usePartnerViewQueries({
  provider,
  partnerId,
  phase,
  slice,
  prospects,
}: PartnerViewQueryInput): PartnerViewQueries {
  // The audience scope is the whole isolation story: every query below is
  // answered from this partner's conflict-free, Sell-To-free projection.
  const access: DemoAccessScope = { audience: 'partner', partnerId };
  const accessKey = demoScopeKey(access);
  const rosterKey = prospectsKey(prospects);
  const oppType = slice === 'all' ? undefined : slice;

  const summary = useScopedQuery({
    provider,
    queryKey: `partner-view-summary|access:${accessKey}|${phase}|slice:${slice}`,
    run: (context) =>
      provider.getPerformanceSummary(access, { phase, partnerId, oppType }, context),
    errorFallback: 'Failed to load the performance summary',
  });

  const stages = useScopedQuery({
    provider,
    queryKey: `partner-view-stages|access:${accessKey}|${phase}|slice:${slice}`,
    run: (context) => provider.getStageBreakdown(access, { phase, partnerId, oppType }, context),
    errorFallback: 'Failed to load the pipeline by stage',
  });

  const motions = useScopedQuery({
    provider,
    // Deliberately no slice in the key: the split always shows the full
    // visible book, whichever motion lens the pipeline cards are under.
    queryKey: `partner-view-motions|access:${accessKey}|${phase}`,
    run: (context) => provider.getTypeBreakdown(access, { phase, partnerId }, context),
    errorFallback: 'Failed to load the revenue-motion split',
  });

  const trend = useScopedQuery({
    provider,
    queryKey: `partner-view-trend|access:${accessKey}|slice:${slice}`,
    run: (context) => provider.getQuarterlyRevenueTrend(access, { partnerId, oppType }, context),
    errorFallback: 'Failed to load the revenue trend',
  });

  const certification = useScopedQuery({
    provider,
    queryKey: `partner-view-cert|access:${accessKey}|prospects:${rosterKey}`,
    run: (context) => provider.getPartnerCertification(access, { partnerId, prospects }, context),
    errorFallback: 'Failed to load the certification record',
  });

  const ops = useScopedQuery({
    provider,
    // No phase: exclusivity lapsing and conversion times span quarters.
    queryKey: `partner-view-ops|access:${accessKey}`,
    run: (context) => provider.getRegistrationOpsSummary(access, { partnerId }, context),
    errorFallback: 'Failed to load the registration timeline',
  });

  const history = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `partner-view-history|access:${accessKey}|${HISTORY_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: HISTORY_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listRecentRegistrations(access, { partnerId }, page, context),
    errorFallback: 'Failed to load the registration history',
    loadMoreErrorFallback: 'Failed to load more registrations',
  });

  const exclusivity = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `partner-view-exclusivity|access:${accessKey}|${EXCLUSIVITY_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: EXCLUSIVITY_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listUnconvertedRegistrations(access, { partnerId }, page, context),
    errorFallback: 'Failed to load the exclusivity window',
    loadMoreErrorFallback: 'Failed to load more unconverted registrations',
  });

  const pipeline = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `partner-view-pipeline|access:${accessKey}|${phase}|slice:${slice}|${PIPELINE_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: PIPELINE_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listScopedOpportunities(access, { phase, partnerId, oppType }, page, context),
    errorFallback: 'Failed to load the pipeline opportunities',
    loadMoreErrorFallback: 'Failed to load more opportunities',
  });

  return { summary, stages, motions, trend, certification, ops, history, exclusivity, pipeline };
}
