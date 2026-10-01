import type { DemoAccessScope } from './accessScope';
import type { Page, PageRequest } from './pagination';
import type { QueryContext } from './queryContext';
import type { QueryResult } from './queryMetadata';
import type { SessionEdits } from './sessionEdits';
import type {
  CoverageState,
  DuplicateRegistrationGroup,
  LeaderboardRow,
  OutcomeTotals,
  QuarterRevenueRow,
  RegistrationConversionTimes,
  RegistrationFunnel,
  RegistrationSlaAlert,
  StageRow,
  TypeRow,
  WeeklyActivityRow,
  WeeklyGoalProgress,
} from '../lib/metrics';
import type {
  ActivityMeeting,
  DealRegistration,
  FiscalPhase,
  ForecastCategory,
  MeetingClassification,
  Opportunity,
  OpportunityStage,
  OpportunityType,
  Partner,
  PartnerCertification,
  PartnerManager,
  Target,
  TeamUser,
} from './types';

/**
 * The integration seam. The UI only ever talks to this interface.
 *
 * It is mid-migration, and deliberately reads that way. See
 * docs/migration-plan.md.
 *
 * - `ScopedQueryProvider` is the target shape: the caller states a scope, the
 *   provider returns an answer. Aggregates come back as kilobytes however
 *   large the book is, and rows come back a page at a time. Every route is
 *   built on it.
 * - `LegacyBookProvider` is the shape being retired: eight calls that each
 *   return an entire collection, which the browser then aggregates itself.
 *   No route reads it any more; it stays only until `useDashboardData`, the
 *   loader that folds it, is deleted with it.
 *
 * The split was the backlog. Every view has moved across; what remains is
 * deleting the legacy side and its loader together.
 *
 * Every method takes a `DemoAccessScope` (see src/data/accessScope.ts) as its
 * first argument: the demo's required, non-authoritative record visibility
 * scope. Providers apply it before any aggregation, ordering, or pagination,
 * so a partner-audience answer is computed from that partner's rows alone.
 * It is demonstrative filtering, not an authorization boundary: this demo
 * has no identity or enforcement layer, and no caller may treat the scope
 * as one.
 *
 * Every method accepts a `QueryContext` (see src/data/queryContext.ts) as its
 * last argument: an abort signal that cancels provider-visible work when the
 * request becomes obsolete, and the trace context the seam creates per call.
 */

// ---- the shape being retired ----------------------------------------------

/**
 * Load-everything access to the book.
 *
 * This cannot survive real volume, and the collections it returns are the
 * reason. The one that used to be here — `listPipelineSnapshots()` — has
 * already gone: weekly history is ~87% of the payload at production scale,
 * millions of rows to answer a question about fourteen weeks, and it is
 * replaced by `getWeeklyForecastSeries()` below. What remains is bookkeeping
 * and small dimensions, and it goes the same way: deleted with the loader
 * that still folds it.
 */
interface LegacyBookProvider {
  listPartnerManagers(access: DemoAccessScope, context?: QueryContext): Promise<PartnerManager[]>;
  listPartners(access: DemoAccessScope, context?: QueryContext): Promise<Partner[]>;
  listRegistrations(access: DemoAccessScope, context?: QueryContext): Promise<DealRegistration[]>;
  listOpportunities(access: DemoAccessScope, context?: QueryContext): Promise<Opportunity[]>;
  getTargets(access: DemoAccessScope, context?: QueryContext): Promise<Target[]>;
  listActivities(access: DemoAccessScope, context?: QueryContext): Promise<ActivityMeeting[]>;
  listCertifications(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<PartnerCertification[]>;
  /**
   * The internal partner-team roster, projected from the identity provider.
   * This is what decides who a deal-registration alert belongs to; a provider
   * with no roster yet may return an empty array, and the alerts simply carry
   * no owner. The roster is internal, so a partner-audience scope receives
   * an empty roster.
   */
  listTeamUsers(access: DemoAccessScope, context?: QueryContext): Promise<TeamUser[]>;
}

// ---- the target shape ------------------------------------------------------

/** What a caller is asking about. Everything else is the provider's problem. */
export interface ForecastScope {
  /** Fiscal quarter label, e.g. 'FY27-Q3'. */
  quarter: string;
  /**
   * Narrows the answers to one partner manager's book.
   *
   * One documented exception, and it is a correctness limit rather than a
   * preference: `getWeeklyForecastSeries` stays quarter-level, because a
   * snapshot row records an opportunity's amount and call but not whose book
   * it was in. Filtering the live weeks by manager while the recorded weeks
   * kept everyone's deals would draw a cliff into the chart that never
   * happened.
   */
  partnerManagerId?: string;
  /**
   * The session's uncommitted edits.
   *
   * In production these are persisted with their author and read by the
   * server while it aggregates, so a corrected revenue figure or a re-called
   * deal is already reflected in what comes back. There is no write path yet
   * (Phase 5), so the only copy lives in the session and has to ride along
   * with the query. Passing them keeps one source of arithmetic: the numbers
   * cannot drift the way they would if the client re-applied edits on top of
   * an answer the provider had already computed without them.
   */
  edits?: SessionEdits;
}

/** A partner's identity, for rendering the partner column of a row. */
export interface PartnerRef {
  id: string;
  name: string;
}

// The page contract lives with the primitive that enforces it: limits are
// validated (positive, at most MAX_PAGE_LIMIT, default DEFAULT_PAGE_LIMIT)
// and cursors are opaque tokens bound to the query and the data epoch they
// were minted under. See src/data/pagination.ts.
export type { Page, PageRequest } from './pagination';

/** The quarter's headline numbers. Fixed size, whatever the book weighs. */
export interface ForecastSummary {
  openPipelineValue: number;
  openCount: number;
  closedWon: number;
  target: number;
  /**
   * Pipeline coverage of the remaining target, as a three-way state:
   * `no-target` when the scope carries no committed target, `target-met` once
   * closed-won has reached it, otherwise the numeric ratio. A missing target
   * is never "target met", and coverage of a zero remaining gap is never a
   * ratio.
   */
  coverage: CoverageState;
  remainingQuota: number;
  avgOpenDealSize: number;
  attainment: number;
  daysLeftInQuarter: number;
}

interface WeightedForecastRow {
  category: ForecastCategory;
  value: number;
  count: number;
}

export interface WeightedForecastSummary {
  total: number;
  rows: WeightedForecastRow[];
}

/** One deal called off the category its stage implies. */
export interface MismatchRow {
  opportunityId: string;
  accountName: string;
  stage: OpportunityStage;
  called: ForecastCategory;
  fromStage: ForecastCategory;
  forecastedRevenue: number;
  direction: 'above' | 'below';
}

/**
 * Where the forecast stops restating the pipeline report.
 *
 * Counts and exposure are aggregates; `sample` is bounded because the view
 * shows only a handful. Returning every mismatching deal would put an
 * unbounded list back on the wire for a card that renders six rows.
 */
export interface ForecastQualitySummary {
  openCount: number;
  aboveCount: number;
  aboveValue: number;
  belowCount: number;
  belowValue: number;
  sample: MismatchRow[];
}

/** One partner manager's header line, without their rows. */
export interface ManagerForecastGroup {
  managerId: string;
  managerName: string;
  opportunityCount: number;
  openValue: number;
  closedWon: number;
}

/** A week of the quarter, as recorded or as reconstructed. Mirrors
 * `WeeklyForecastRow` in src/lib/metrics.ts field for field, so the metrics
 * type stays checkable against the wire shape by assigning one to the other. */
export interface WeeklySeriesRow {
  weekStart: string;
  weekEnd: string;
  raw: Record<ForecastCategory, number>;
  weighted: Record<ForecastCategory, number>;
  total: number;
  weightedTotal: number;
  hasStarted: boolean;
  /** Set when the week came from a recorded snapshot rather than the live book. */
  recordedAt?: string;
}

// ---- Home and Partner Performance -----------------------------------------

/**
 * The drill-down the Home and Partner Performance routes scope by: one
 * partner manager, one partner, or everyone.
 *
 * This is a provider input, not a browser reduction: the view states the
 * selection, and the provider computes from the selected rows alone — a
 * whole-book fetch narrowed in the browser would move everyone else's data
 * across the seam to answer one manager's question.
 */
export interface PartnerDrilldown {
  /** One manager's roster; absent means every manager. */
  partnerManagerId?: string;
  /** A single partner — the Partner Performance drill-in. Wins over the manager. */
  partnerId?: string;
  /**
   * Restrict membership to the roster: rows whose partner the provider does
   * not know (generated overlap remnants) fall out even with no manager or
   * partner selected. This is the shape Partner Performance has always
   * applied; Home does not set it and keeps the whole book.
   */
  partnerFilter?: 'roster';
  /**
   * Session prospect partners, appended to the roster before scoping. They
   * exist only in the session (there is no write path yet), so they ride
   * along with the query the way the session's edits do.
   */
  prospects?: Partner[];
}

/**
 * The revenue-versus-target trend's scope: the drill-down, an optional
 * opportunity-type lens, and the session edits. No phase — the trend spans
 * every fiscal quarter by definition.
 */
export interface RevenueTrendScope extends PartnerDrilldown {
  /** 'all' or one opportunity type. Absent means 'all'. */
  oppType?: OpportunityType | 'all';
  /** Session edits, applied before aggregation — see `ForecastScope.edits`. */
  edits?: SessionEdits;
}

/** What one scoped Home or Partner Performance query needs. */
export interface PerformanceScope extends RevenueTrendScope {
  /** The fiscal phase the aggregates describe. */
  phase: FiscalPhase;
}

/** The weekly activity and goal queries' scope: the drill-down plus the
 * session's meeting classifications, which the aggregates apply the same way
 * the views used to apply them client-side. */
export interface ActivityScope extends PartnerDrilldown {
  classifications?: Record<string, MeetingClassification>;
}

/** The pending-registration queue's scope: the drill-down, plus the phase
 * when the route's queue is phase-filtered (Partner Performance) — Home's
 * queue spans all history and omits it. */
export interface PendingRegistrationsScope extends PartnerDrilldown {
  phase?: FiscalPhase;
}

/** One partner's enablement lookup: the drill-in target plus the session's prospects. */
export interface PartnerCertificationScope {
  /** The partner to look up; absent (no drill-in) answers null. */
  partnerId?: string;
  prospects?: Partner[];
}

/**
 * The internal notification roster's session overlays, riding the roster and
 * alert queries the way the session's edits ride the forecast queries: there
 * is no write path to an identity provider (Production: Prod Only), so the
 * roster the demo routes simulated notifications to exists only in the
 * session and has to travel with the query. Keeping the arithmetic on the
 * provider's side is what lets the SLA alert rule resolve owners against the
 * same roster the Access panel renders.
 */
export interface TeamRosterScope {
  /** Status/routing patches keyed by provider roster user id. */
  overrides?: Record<string, Partial<TeamUser>>;
  /** Users added during this session, appended after the provider roster. */
  added?: TeamUser[];
}

/**
 * The SLA alert queue as a bounded answer, in the shape getForecastQuality
 * established: the full-set counts, plus the most urgent alerts up to
 * `maxAlerts` — the queue a human works from the top of. Returning every
 * alert would put an unbounded list back on the wire for a panel that
 * renders its first page.
 */
export interface RegistrationSlaAlertDigest {
  /** The most urgent alerts — due-soon warnings first, then most overdue. */
  alerts: RegistrationSlaAlert[];
  /** Every registration flagged against the SLA, not just the window above. */
  totalCount: number;
  /** Of those, still inside the SLA but within the one-business-day warning. */
  approachingCount: number;
  /** Of those, with a resolvable owner on the roster. */
  ownedCount: number;
  /** Alerts per owner user id, across the whole set (the roster chips' counts). */
  alertCountByOwner: Record<string, number>;
}

/**
 * The Log Meetings calendar's scope: exactly one partner manager. The answer
 * is that manager's current-week calendar — the raw "Google Calendar import"
 * the classification modal works from — and it is deliberately NOT the
 * classified aggregate: the modal edits classifications against the raw
 * meetings, and only a submit moves the weekly goal and series.
 */
export interface WeeklyClassificationScope {
  partnerManagerId: string;
}

/**
 * The phase's headline numbers for a scope, fixed in size whatever the book
 * weighs. The two registration-rate counts ride along so the tiles they
 * subtitle never read a different query's answer.
 */
export interface PerformanceSummary {
  openPipelineValue: number;
  openCount: number;
  closedWon: number;
  /** Closed-won in the same span a year earlier; the delta's denominator. */
  priorClosedWon: number;
  target: number;
  attainment: number;
  /** Same three-way state the forecast summary carries; see there. */
  coverage: CoverageState;
  remainingQuota: number;
  avgOpenDealSize: number;
  winRate: number;
  approvalRate: number;
  /** Decided registrations behind the approval rate (approved + rejected). */
  decidedRegistrations: number;
  conversionRate: number;
  /** Approved registrations that became opportunities (the funnel's converted). */
  convertedRegistrations: number;
  /** Partners with fiscal-year opportunity or registration activity. */
  activePartners: number;
  /** Partners in the scope's roster selection. */
  alignedPartners: number;
}

/** Open pipeline by stage plus the phase's closed outcomes. */
export interface StageBreakdown {
  stages: StageRow[];
  outcomes: OutcomeTotals;
}

/**
 * Deal-registration operations for a scope, deliberately NOT phase-filtered:
 * exclusivity lapsing and conversion times span quarters, so a Q3 scope must
 * still see the older registrations that are leaking.
 */
export interface RegistrationOpsSummary {
  times: RegistrationConversionTimes;
  /** Pending registrations awaiting review — the queue's total depth. */
  pending: number;
  /** Approved registrations that never became an opportunity. */
  approvedNotConverted: number;
  /** Of those, past the 60-calendar-day exclusivity window. */
  exclusivityLapsed: number;
  /** Pending registrations at or past the 5-business-day response SLA. */
  pastSla: number;
  /** Clients registered by more than one partner. Internal-only material. */
  duplicateGroups: number;
}

/** One leaderboard row with the partner's certification record attached, so
 * the enablement column never needs the certification collection. */
export interface PartnerLeaderboardEntry extends LeaderboardRow {
  certification?: PartnerCertification;
}

/** A partner and its certification record, or the record's absence made explicit. */
export interface PartnerCertificationProfile {
  partner: Partner;
  certification?: PartnerCertification;
}

/**
 * Every scoped answer is an envelope: the data plus the metadata that makes
 * it honest — the committed provider's id, the deterministic as-of instant,
 * typed lineage, and a completeness state with typed warnings. A partial or
 * stale answer can never look like a complete, current one, because the
 * envelope says so. See src/data/queryMetadata.ts.
 */
interface ScopedQueryProvider {
  getForecastSummary(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastSummary>>;
  getWeightedForecast(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeightedForecastSummary>>;
  getForecastQuality(
    access: DemoAccessScope,
    scope: ForecastScope,
    sampleSize: number,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastQualitySummary>>;
  getManagerForecastGroups(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ManagerForecastGroup[]>>;
  /**
   * Week-over-week state of the quarter's pipeline: one row per week, about
   * fourteen of them, in place of every snapshot row ever written.
   */
  getWeeklyForecastSeries(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklySeriesRow[]>>;
  /**
   * One manager's in-quarter book, a page at a time. Requested when a group is
   * expanded, rather than loaded for every manager up front.
   *
   * Pages follow the shared contract in src/data/pagination.ts: the limit
   * defaults to 25 and may not exceed the maximum, ordering is stable, and
   * cursors are opaque and bound to this exact query and data epoch — an
   * invalid limit or an invalid, foreign, or expired cursor rejects with a
   * typed `PageQueryError` rather than quietly serving page one.
   */
  listQuarterOpportunities(
    access: DemoAccessScope,
    scope: ForecastScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>>;
  /**
   * Partner id to name, for the partner column of a row.
   *
   * A dimension, not a fact: it is a dictionary the client can hold — a few
   * thousand entries at production scale rather than the book itself — and it
   * is what lets a row DTO stay an opportunity instead of absorbing a display
   * concern. Unpaginated on purpose, and scoped by the required demo access
   * scope rather than by an argument: a partner-audience scope receives one
   * entry, its own. In production this would be the caller's authorization;
   * here it is demonstrative filtering only.
   */
  getPartnerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerRef[]>>;

  // ---- Home and Partner Performance ----------------------------------------
  //
  // One method per widget region, so a rejected call fails exactly one card
  // and its retry repeats only that call. Filters are scope inputs here, not
  // browser reductions over a whole book.

  /** The phase's KPI tiles: pipeline, closed-won and the prior-period delta,
   * coverage, win rate, the two registration rates, and the partner counts. */
  getPerformanceSummary(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<PerformanceSummary>>;
  /** The registration funnel for the phase, as counts and registered value. */
  getRegistrationFunnel(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationFunnel>>;
  /** Open pipeline by stage plus the phase's won/lost outcomes. */
  getStageBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<StageBreakdown>>;
  /**
   * The phase's open pipeline split by opportunity type. The type lens does
   * not narrow this answer — the chart exists to show the mix the lens
   * selects from — but the session's edits still apply.
   */
  getTypeBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<TypeRow[]>>;
  /**
   * Closed-won versus target for every fiscal quarter: a bounded row per
   * quarter, never the deals behind them.
   */
  getQuarterlyRevenueTrend(
    access: DemoAccessScope,
    scope: RevenueTrendScope,
    context?: QueryContext,
  ): Promise<QueryResult<QuarterRevenueRow[]>>;
  /** Eight weekly meeting buckets for the scope, classifications applied. */
  getWeeklyActivitySeries(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyActivityRow[]>>;
  /** The current week's meetings against the weekly goal, classifications applied. */
  getWeeklyGoalProgress(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyGoalProgress>>;
  /** Registration operations for the scope: conversion times and leakage
   * counts, spanning all history rather than the selected phase. */
  getRegistrationOpsSummary(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationOpsSummary>>;
  /**
   * Every partner in the scope's selection, ranked on the phase's closed-won:
   * a bounded dimension row per partner, not a page, because the roster is
   * bounded the way the manager directory is.
   */
  getPartnerLeaderboard(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerLeaderboardEntry[]>>;
  /**
   * The partner-manager directory, scoped like every other answer (a partner
   * audience receives none). A small dimension the drill-down selects from.
   */
  getManagerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerManager[]>>;
  /**
   * The partner roster — provider partners plus the session's prospects —
   * under the access scope. A dimension lookup: it lets a registration row
   * stay a registration instead of absorbing a display concern, and it is
   * what the drill-down options render from.
   */
  getPartnerRoster(
    access: DemoAccessScope,
    scope: { prospects?: Partner[] },
    context?: QueryContext,
  ): Promise<QueryResult<Partner[]>>;
  /** One partner's enablement standing; null when no partner is drilled into. */
  getPartnerCertification(
    access: DemoAccessScope,
    scope: PartnerCertificationScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerCertificationProfile | null>>;
  /**
   * The scope's pipeline opportunities, a page at a time. Pages follow the
   * shared contract in src/data/pagination.ts: bounded limits, stable
   * ordering by expected close date then id, and opaque cursors bound to
   * this exact query and data epoch.
   */
  listScopedOpportunities(
    access: DemoAccessScope,
    scope: PerformanceScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>>;
  /** The review queue, oldest first, a page at a time. */
  listPendingRegistrations(
    access: DemoAccessScope,
    scope: PendingRegistrationsScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>>;
  /** Approved registrations with no opportunity yet — the exclusivity watch. */
  listUnconvertedRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>>;
  /**
   * Clients registered by more than one partner, a page of groups at a time.
   * Internal-only material: a partner-audience scope receives no groups,
   * because the conflict rows themselves never enter that scope.
   */
  listDuplicateRegistrationGroups(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DuplicateRegistrationGroup>>>;
  /**
   * The scope's registrations across every status, newest submission first,
   * a page at a time — the partner portal's history card and the notification
   * composer's record picker. Under a partner-audience scope the answer is
   * that partner's submissions minus any under a conflict: the conflict stays
   * an internal matter on both sides of it. Pages follow the shared contract
   * in src/data/pagination.ts.
   */
  listRecentRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>>;

  // ---- Data Connections ----------------------------------------------------
  //
  // The identity-provider roster and the notification rule's answer, scoped
  // like everything else: both are internal-only material, so a partner
  // audience receives an empty roster and an ownerless digest.

  /**
   * The internal partner-team roster, projected from the identity provider,
   * with the session's overlays applied (see `TeamRosterScope`). This is what
   * decides who a deal-registration alert belongs to; a provider with no
   * roster yet may return an empty array, and the alerts simply carry no
   * owner. A partner-audience scope receives an empty roster — the roster is
   * internal, and the session's overlays are internal-roster edits, so they
   * fall with it.
   */
  getTeamRoster(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    context?: QueryContext,
  ): Promise<QueryResult<TeamUser[]>>;
  /**
   * The notification rule's answer: pending registrations at or within one
   * business day of the response SLA, owners resolved against the overlaid
   * roster. Bounded like `getForecastQuality` — the full-set counts plus the
   * most urgent `maxAlerts` alerts, never the whole queue.
   */
  getRegistrationSlaAlerts(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    maxAlerts: number,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationSlaAlertDigest>>;

  // ---- Activity Tracking ---------------------------------------------------

  /**
   * One partner manager's current-week calendar meetings, oldest first, a
   * page at a time — the bounded classification input behind Log Meetings.
   *
   * The week is bounded by definition (a manager's Monday–Friday calendar),
   * so the collection is small next to the book, but it is still fact rows:
   * it paginates through the shared contract in src/data/pagination.ts like
   * every other row collection, because a scaled book turns one manager's
   * week into hundreds of calls. Session classifications are not an input
   * here — they belong to the aggregates (`getWeeklyActivitySeries`,
   * `getWeeklyGoalProgress`), and the modal keeps its own unsubmitted draft.
   */
  listWeeklyClassificationMeetings(
    access: DemoAccessScope,
    scope: WeeklyClassificationScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<ActivityMeeting>>>;
}

/**
 * What the app is wired to today: the target shape, plus what has not moved
 * across yet.
 */
export interface DataProvider extends LegacyBookProvider, ScopedQueryProvider {}

/**
 * Every method on the contract, as strings, because types are erased at
 * runtime and the integration map in connections.ts is checked against a list.
 *
 * Built from a record keyed by the interface's own method names rather than
 * typed as an array: adding a method to `DataProvider` and forgetting it here
 * is a compile error, and `connections.test.ts` then fails until the new
 * method has a wire or a box on the map. That is the check the map's header
 * promises — a method with no wire is a connection nobody planned for — and
 * it should not depend on anyone remembering to update two lists.
 */
const METHOD_INDEX: Record<keyof DataProvider, true> = {
  // the shape being retired
  listPartnerManagers: true,
  listPartners: true,
  listRegistrations: true,
  listOpportunities: true,
  getTargets: true,
  listActivities: true,
  listCertifications: true,
  listTeamUsers: true,
  // the target shape
  getForecastSummary: true,
  getWeightedForecast: true,
  getForecastQuality: true,
  getManagerForecastGroups: true,
  getWeeklyForecastSeries: true,
  listQuarterOpportunities: true,
  getPartnerDirectory: true,
  // Home and Partner Performance
  getPerformanceSummary: true,
  getRegistrationFunnel: true,
  getStageBreakdown: true,
  getTypeBreakdown: true,
  getQuarterlyRevenueTrend: true,
  getWeeklyActivitySeries: true,
  getWeeklyGoalProgress: true,
  getRegistrationOpsSummary: true,
  getPartnerLeaderboard: true,
  getManagerDirectory: true,
  getPartnerRoster: true,
  getPartnerCertification: true,
  listScopedOpportunities: true,
  listPendingRegistrations: true,
  listUnconvertedRegistrations: true,
  listDuplicateRegistrationGroups: true,
  listRecentRegistrations: true,
  // Data Connections
  getTeamRoster: true,
  getRegistrationSlaAlerts: true,
  // Activity Tracking
  listWeeklyClassificationMeetings: true,
};

export const DATA_PROVIDER_METHODS = Object.keys(METHOD_INDEX) as (keyof DataProvider)[];
