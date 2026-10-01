import type {
  DataProvider,
  PerformanceSummary,
  StageBreakdown,
  TopPartnerLeaders,
} from './DataProvider';
import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import type {
  QuarterRevenueRow,
  RegistrationFunnel,
  TypeRow,
  WeeklyActivityRow,
} from '../lib/metrics';
import { usePaginatedRows } from './paginationState';
import type { PaginationState } from './paginationState';
import { classificationsKey, editMapKey, prospectsKey, useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import { usePartnerRoster } from './useScopedDirectories';
import type { SessionEdits } from './sessionEdits';
import type {
  DealRegistration,
  FiscalPhase,
  MeetingClassification,
  OpportunityType,
  Partner,
} from './types';

/**
 * The Home route's data, fetched the way it will be fetched in production:
 * nine independent scoped queries — one per card — in place of the folded
 * whole book. The phase and the opportunity-type lens are provider inputs
 * here, not browser reductions: a request names them, and the provider
 * computes from the scoped rows alone.
 *
 * Invalidation is narrow, and it lives in the query keys:
 *
 * - the phase refetches everything except the revenue trend (which spans
 *   every quarter by definition) and the review queue (which spans all
 *   history);
 * - the type lens refetches the summary, stages, trend, and leaderboard —
 *   the type chart itself is the mix the lens selects from, so it does not
 *   move, and registrations are untyped, so the funnel does not either;
 * - a revenue edit refetches the aggregates that read revenue and refreshes
 *   nothing else; note, next-step, and forecast-call edits move no figure
 *   on this route and refetch nothing;
 * - a reclassification refetches only the weekly activity series;
 * - an added prospect refetches the roster and the leaderboard, whose rows
 *   are roster entries;
 * - a re-render that changed nothing refetches nothing, because the keys
 *   are built from primitive values.
 *
 * Race safety and failure semantics come from the shared primitives: every
 * query carries its own loading, error, and retry state, and a rejected
 * call fails exactly one card.
 *
 * Every aggregate also carries a `scopeKey`: the identity of the question it
 * answers, built from the membership primitives (access, phase, type lens)
 * and nothing session-side. A phase or lens change is a different question —
 * the previous scope's answer is dropped at read time, so its figures can
 * never render under the new label, not even while the replacement is in
 * flight or after the replacement fails. Edit, classification, and prospect
 * keys stay in `queryKey` only: those are the same question with new
 * session input, so their refreshes keep the last good answer on screen.
 */

/** Rows of the review queue fetched at once: the card shows one page. */
const HOME_PENDING_PAGE_SIZE = 7;

export interface HomeQueryInput {
  provider: DataProvider;
  access: DemoAccessScope;
  phase: FiscalPhase;
  oppType: OpportunityType | 'all';
  edits: SessionEdits;
  classifications: Record<string, MeetingClassification>;
  prospects: Partner[];
}

export interface HomeQueries {
  summary: QueryState<PerformanceSummary>;
  funnel: QueryState<RegistrationFunnel>;
  stages: QueryState<StageBreakdown>;
  types: QueryState<TypeRow[]>;
  trend: QueryState<QuarterRevenueRow[]>;
  activity: QueryState<WeeklyActivityRow[]>;
  pending: PaginationState<DealRegistration>;
  /** The fixed-cap top board: the leading partners plus the field's size. */
  leaderboard: QueryState<TopPartnerLeaders>;
  roster: QueryState<Partner[]>;
}

export function useHomeQueries({
  provider,
  access,
  phase,
  oppType,
  edits,
  classifications,
  prospects,
}: HomeQueryInput): HomeQueries {
  const accessKey = demoScopeKey(access);
  const revKey = editMapKey(edits.revenueOverrides);
  const clsKey = classificationsKey(classifications);
  const rosterKey = prospectsKey(prospects);

  const summary = useScopedQuery({
    provider,
    queryKey: `perf-summary|access:${accessKey}|${phase}|type:${oppType}|rev:${revKey}|prospects:${rosterKey}`,
    scopeKey: `perf-summary|access:${accessKey}|${phase}|type:${oppType}`,
    run: (context) =>
      provider.getPerformanceSummary(access, { phase, oppType, edits, prospects }, context),
    errorFallback: 'Failed to load the performance summary',
  });

  const funnel = useScopedQuery({
    provider,
    queryKey: `reg-funnel|access:${accessKey}|${phase}`,
    scopeKey: `reg-funnel|access:${accessKey}|${phase}`,
    run: (context) => provider.getRegistrationFunnel(access, { phase }, context),
    errorFallback: 'Failed to load the registration funnel',
  });

  const stages = useScopedQuery({
    provider,
    queryKey: `stage-breakdown|access:${accessKey}|${phase}|type:${oppType}|rev:${revKey}`,
    scopeKey: `stage-breakdown|access:${accessKey}|${phase}|type:${oppType}`,
    run: (context) => provider.getStageBreakdown(access, { phase, oppType, edits }, context),
    errorFallback: 'Failed to load the pipeline by stage',
  });

  const types = useScopedQuery({
    provider,
    queryKey: `type-breakdown|access:${accessKey}|${phase}|rev:${revKey}`,
    scopeKey: `type-breakdown|access:${accessKey}|${phase}`,
    run: (context) => provider.getTypeBreakdown(access, { phase, edits }, context),
    errorFallback: 'Failed to load the pipeline by type',
  });

  const trend = useScopedQuery({
    provider,
    queryKey: `quarterly-revenue|access:${accessKey}|type:${oppType}|rev:${revKey}`,
    scopeKey: `quarterly-revenue|access:${accessKey}|type:${oppType}`,
    run: (context) => provider.getQuarterlyRevenueTrend(access, { oppType, edits }, context),
    errorFallback: 'Failed to load the revenue trend',
  });

  const activity = useScopedQuery({
    provider,
    queryKey: `weekly-activity|access:${accessKey}|cls:${clsKey}`,
    scopeKey: `weekly-activity|access:${accessKey}`,
    run: (context) => provider.getWeeklyActivitySeries(access, { classifications }, context),
    errorFallback: 'Failed to load the weekly activity',
  });

  const pending = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `pending-regs|access:${accessKey}|phase:all|manager:all|partner:all|${HOME_PENDING_PAGE_SIZE}`,
    // Registrations carry no session edits; nothing refreshes this queue.
    refreshKey: '',
    pageSize: HOME_PENDING_PAGE_SIZE,
    fetchPage: (page, context) => provider.listPendingRegistrations(access, {}, page, context),
    errorFallback: 'Failed to load the review queue',
    loadMoreErrorFallback: 'Failed to load more of the review queue',
  });

  const leaderboard = useScopedQuery({
    provider,
    queryKey: `top-partner-leaders|access:${accessKey}|${phase}|type:${oppType}|rev:${revKey}|prospects:${rosterKey}`,
    scopeKey: `top-partner-leaders|access:${accessKey}|${phase}|type:${oppType}`,
    run: (context) =>
      provider.getTopPartnerLeaders(access, { phase, oppType, edits, prospects }, context),
    errorFallback: 'Failed to load the partner leaderboard',
  });

  const roster = usePartnerRoster(provider, access, prospects);

  return {
    summary,
    funnel,
    stages,
    types,
    trend,
    activity,
    pending,
    leaderboard,
    roster,
  };
}
