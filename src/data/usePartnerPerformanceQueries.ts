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
import type {
  DuplicateRegistrationGroup,
  QuarterRevenueRow,
  RegistrationFunnel,
  WeeklyActivityRow,
  WeeklyGoalProgress,
} from '../lib/metrics';
import { usePaginatedRows } from './paginationState';
import type { PaginationState } from './paginationState';
import { classificationsKey, editMapKey, prospectsKey, useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import { useManagerDirectory, usePartnerRoster } from './useScopedDirectories';
import type { SessionEdits } from './sessionEdits';
import type {
  DealRegistration,
  FiscalPhase,
  MeetingClassification,
  Opportunity,
  Partner,
  PartnerManager,
} from './types';

/**
 * The Partner Performance route's data, fetched the way it will be fetched
 * in production: the manager/partner drill-down and the phase are inputs to
 * every query, and the provider computes each card's answer from the
 * selected rows alone. One rejected call fails exactly one card; its retry
 * repeats only that call.
 *
 * Every query carries `partnerFilter: 'roster'`: the drill-down has always
 * excluded rows whose partner is not on the roster, and that is a
 * membership rule of the scope, not a browser reduction.
 *
 * Invalidation mirrors Home's, plus the drill-down: the manager or partner
 * selection is part of every key, so a selection change refetches exactly
 * the answers it re-scopes. The registration-ops card is the documented
 * exception to the phase: exclusivity lapsing and conversion times span
 * quarters, so its keys omit the phase. The pipeline table is the one
 * collection that paginates; a revenue edit refreshes its loaded window in
 * place, and only when the edit touches a loaded row.
 */

/** Rows per page of the scoped pipeline table. */
const PIPELINE_PAGE_SIZE = 25;
/** The queue, exclusivity, and duplicate cards render a single page each. */
const QUEUE_PAGE_SIZE = 7;
const UNCONVERTED_PAGE_SIZE = 8;
const DUPLICATE_PAGE_SIZE = 6;

export interface PartnerPerformanceQueryInput {
  provider: DataProvider;
  access: DemoAccessScope;
  phase: FiscalPhase;
  /** 'all' or one partner manager id. */
  managerId: string;
  /** 'all' or one partner id. */
  partnerId: string;
  edits: SessionEdits;
  classifications: Record<string, MeetingClassification>;
  prospects: Partner[];
}

export interface PartnerPerformanceQueries {
  summary: QueryState<PerformanceSummary>;
  funnel: QueryState<RegistrationFunnel>;
  stages: QueryState<StageBreakdown>;
  trend: QueryState<QuarterRevenueRow[]>;
  activity: QueryState<WeeklyActivityRow[]>;
  goal: QueryState<WeeklyGoalProgress>;
  ops: QueryState<RegistrationOpsSummary>;
  leaderboard: QueryState<PartnerLeaderboardEntry[]>;
  managers: QueryState<PartnerManager[]>;
  roster: QueryState<Partner[]>;
  certification: QueryState<PartnerCertificationProfile | null>;
  opportunities: PaginationState<Opportunity>;
  pending: PaginationState<DealRegistration>;
  unconverted: PaginationState<DealRegistration>;
  duplicates: PaginationState<DuplicateRegistrationGroup>;
}

export function usePartnerPerformanceQueries({
  provider,
  access,
  phase,
  managerId,
  partnerId,
  edits,
  classifications,
  prospects,
}: PartnerPerformanceQueryInput): PartnerPerformanceQueries {
  const accessKey = demoScopeKey(access);
  const revKey = editMapKey(edits.revenueOverrides);
  const clsKey = classificationsKey(classifications);
  const rosterKey = prospectsKey(prospects);
  const partnerManagerId = managerId === 'all' ? undefined : managerId;
  const selectedPartnerId = partnerId === 'all' ? undefined : partnerId;
  const drilldown = {
    partnerManagerId,
    partnerId: selectedPartnerId,
    partnerFilter: 'roster' as const,
    prospects,
  };

  const summary = useScopedQuery({
    provider,
    queryKey: `perf-summary|access:${accessKey}|${phase}|manager:${managerId}|partner:${partnerId}|rev:${revKey}|prospects:${rosterKey}`,
    run: (context) =>
      provider.getPerformanceSummary(access, { ...drilldown, phase, edits }, context),
    errorFallback: 'Failed to load the performance summary',
  });

  const funnel = useScopedQuery({
    provider,
    queryKey: `reg-funnel|access:${accessKey}|${phase}|manager:${managerId}|partner:${partnerId}`,
    run: (context) => provider.getRegistrationFunnel(access, { ...drilldown, phase }, context),
    errorFallback: 'Failed to load the registration funnel',
  });

  const stages = useScopedQuery({
    provider,
    queryKey: `stage-breakdown|access:${accessKey}|${phase}|manager:${managerId}|partner:${partnerId}|rev:${revKey}`,
    run: (context) => provider.getStageBreakdown(access, { ...drilldown, phase, edits }, context),
    errorFallback: 'Failed to load the pipeline by stage',
  });

  const trend = useScopedQuery({
    provider,
    queryKey: `quarterly-revenue|access:${accessKey}|manager:${managerId}|partner:${partnerId}|rev:${revKey}`,
    run: (context) => provider.getQuarterlyRevenueTrend(access, { ...drilldown, edits }, context),
    errorFallback: 'Failed to load the revenue trend',
  });

  const activity = useScopedQuery({
    provider,
    queryKey: `weekly-activity|access:${accessKey}|manager:${managerId}|partner:${partnerId}|cls:${clsKey}`,
    run: (context) =>
      provider.getWeeklyActivitySeries(
        access,
        {
          partnerManagerId,
          partnerId: selectedPartnerId,
          partnerFilter: 'roster',
          classifications,
        },
        context,
      ),
    errorFallback: 'Failed to load the weekly activity',
  });

  const goal = useScopedQuery({
    provider,
    queryKey: `weekly-goal|access:${accessKey}|manager:${managerId}|partner:${partnerId}|cls:${clsKey}`,
    run: (context) =>
      provider.getWeeklyGoalProgress(
        access,
        {
          partnerManagerId,
          partnerId: selectedPartnerId,
          partnerFilter: 'roster',
          classifications,
        },
        context,
      ),
    errorFallback: 'Failed to load the weekly goal',
  });

  const ops = useScopedQuery({
    provider,
    queryKey: `reg-ops|access:${accessKey}|manager:${managerId}|partner:${partnerId}`,
    run: (context) => provider.getRegistrationOpsSummary(access, drilldown, context),
    errorFallback: 'Failed to load the registration ops',
  });

  const leaderboard = useScopedQuery({
    provider,
    queryKey: `partner-leaderboard|access:${accessKey}|${phase}|manager:${managerId}|partner:${partnerId}|rev:${revKey}|prospects:${rosterKey}`,
    run: (context) =>
      provider.getPartnerLeaderboard(access, { ...drilldown, phase, edits }, context),
    errorFallback: 'Failed to load the partner leaderboard',
  });

  const managers = useManagerDirectory(provider, access);
  const roster = usePartnerRoster(provider, access, prospects);

  const certification = useScopedQuery({
    provider,
    queryKey: `partner-cert|access:${accessKey}|partner:${partnerId}|prospects:${rosterKey}`,
    run: (context) =>
      provider.getPartnerCertification(
        access,
        { partnerId: selectedPartnerId, prospects },
        context,
      ),
    errorFallback: 'Failed to load the certification profile',
  });

  const opportunities = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `scoped-opps|access:${accessKey}|${phase}|manager:${managerId}|partner:${partnerId}|${PIPELINE_PAGE_SIZE}`,
    refreshKey: `rev:${revKey}`,
    pageSize: PIPELINE_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listScopedOpportunities(access, { ...drilldown, phase, edits }, page, context),
    rowEdits: {
      maps: { rev: edits.revenueOverrides },
      idOf: (row) => row.id,
    },
    errorFallback: 'Failed to load the pipeline opportunities',
    loadMoreErrorFallback: 'Failed to load more opportunities',
  });

  const pending = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `pending-regs|access:${accessKey}|${phase}|manager:${managerId}|partner:${partnerId}|${QUEUE_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: QUEUE_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listPendingRegistrations(access, { ...drilldown, phase }, page, context),
    errorFallback: 'Failed to load the review queue',
    loadMoreErrorFallback: 'Failed to load more of the review queue',
  });

  const unconverted = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `unconverted-regs|access:${accessKey}|manager:${managerId}|partner:${partnerId}|${UNCONVERTED_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: UNCONVERTED_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listUnconvertedRegistrations(access, drilldown, page, context),
    errorFallback: 'Failed to load the unconverted registrations',
    loadMoreErrorFallback: 'Failed to load more unconverted registrations',
  });

  const duplicates = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `dup-groups|access:${accessKey}|manager:${managerId}|partner:${partnerId}|${DUPLICATE_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: DUPLICATE_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listDuplicateRegistrationGroups(access, drilldown, page, context),
    errorFallback: 'Failed to load the duplicate registrations',
    loadMoreErrorFallback: 'Failed to load more duplicate registrations',
  });

  return {
    summary,
    funnel,
    stages,
    trend,
    activity,
    goal,
    ops,
    leaderboard,
    managers,
    roster,
    certification,
    opportunities,
    pending,
    unconverted,
    duplicates,
  };
}
