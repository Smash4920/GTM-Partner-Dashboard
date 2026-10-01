import type { DemoAccessScope } from './accessScope';
import type { ActionCenterScope, ActionCenterSummary } from './actionCenter';
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
  ActionItem,
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
  TeamUser,
} from './types';

/**
 * The integration seam. The UI only ever talks to this interface. See
 * docs/migration-plan.md.
 *
 * `ScopedQueryProvider` is the whole shape: the caller states a scope, the
 * provider returns an answer. Aggregates come back as kilobytes however
 * large the book is, and rows come back a page at a time. Every route is
 * built on it.
 *
 * The legacy side is gone: the eight list-everything calls and
 * `useDashboardData`, the loader that folded them into one book, were
 * deleted once the last route moved across. `listPipelineSnapshots()` went
 * earlier still — weekly history is ~87% of the payload at production
 * scale, millions of rows to answer a question about fourteen weeks, and it
 * is replaced by `getWeeklyForecastSeries()` below.
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

// ---- the contract ----------------------------------------------------------

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

/**
 * The fixed size of the top-leader answer: Home and the Partner View picker
 * render the leaders, never the roster, so the answer is the leading ten
 * partners however large the book grows. The full ranking stays available
 * through `listPartnerLeaderboard`, a page at a time.
 */
export const TOP_LEADERBOARD_LIMIT = 10;

/**
 * The most alerts the SLA digest ever carries. The panel works the queue
 * from the top and renders its first page, so the answer is the urgent
 * window plus the whole-queue counts — never the queue itself.
 */
export const MAX_SLA_ALERT_DIGEST = 8;

/**
 * The typed rejection an out-of-contract `maxAlerts` gets. Carries no alert
 * data: a clamped window would claim to be the queue window the caller
 * asked for, and quietly answering is how an unbounded read sneaks back in.
 */
export class SlaAlertLimitError extends Error {
  readonly code = 'invalid-max-alerts' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SlaAlertLimitError';
  }
}

/**
 * Validates the requested SLA digest window. Anything that is not a
 * positive integer within the exported maximum — non-finite, non-integer,
 * non-positive, or over the limit — is a typed error, never a clamp.
 */
export function resolveSlaAlertLimit(maxAlerts: number): number {
  if (!Number.isInteger(maxAlerts) || maxAlerts <= 0 || maxAlerts > MAX_SLA_ALERT_DIGEST) {
    throw new SlaAlertLimitError(
      `Invalid maxAlerts: expected a positive integer of at most ${MAX_SLA_ALERT_DIGEST}, received ${String(
        maxAlerts,
      )}`,
    );
  }
  return maxAlerts;
}

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
  /**
   * The leaderboard's combined-motion lens: rank partners on these
   * opportunity types summed together — how the Partner View picker ranks
   * Sell With plus Allocate in one provider-side answer instead of merging
   * two independently truncated boards in the client. Wins over `oppType`
   * when present and non-empty; only the leaderboard methods read it.
   */
  oppTypes?: readonly OpportunityType[];
}

/** The weekly activity and goal queries' scope: the drill-down plus the
 * session's meeting classifications, which the aggregates apply the same way
 * the views used to apply them client-side. A classification that re-points
 * a meeting at another partner — including a session prospect on another
 * manager's roster — reassigns the meeting's ownership BEFORE the
 * drill-down's partner set is applied, so the meeting leaves the old
 * manager's scope and joins the new one exactly once. */
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
 * renders its first page, so `maxAlerts` itself is validated against
 * `MAX_SLA_ALERT_DIGEST` and anything outside it is rejected, not clamped.
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

/**
 * The fixed-cap leaderboard answer: the leading `TOP_LEADERBOARD_LIMIT`
 * partners of the scope's ranking, plus the size of the field they were
 * drawn from. Its size never depends on the roster; the full ranking is
 * `listPartnerLeaderboard`, a page at a time.
 */
export interface TopPartnerLeaders {
  leaders: PartnerLeaderboardEntry[];
  /** Every partner in the scope's selection, ranked or not. */
  totalPartners: number;
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
  /** Fixed-size counts over all filtered scoped action items, not a page. */
  getActionCenterSummary(
    access: DemoAccessScope,
    scope: ActionCenterScope,
    context?: QueryContext,
  ): Promise<QueryResult<ActionCenterSummary>>;
  /** Globally ordered unique entity actions, with every merged reason retained. */
  listActionItems(
    access: DemoAccessScope,
    scope: ActionCenterScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<ActionItem>>>;
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
   * The top of the scope's leaderboard as a fixed-cap answer: the leading
   * `TOP_LEADERBOARD_LIMIT` partners by the phase's closed-won, plus the
   * size of the field. Home and the Partner View picker render leaders,
   * never the roster — and the picker's combined Sell With + Allocate
   * ranking is computed here via `oppTypes`, because a client-side merge of
   * two independently truncated boards can crown the wrong partner. The
   * full ranking is `listPartnerLeaderboard`.
   */
  getTopPartnerLeaders(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<TopPartnerLeaders>>;
  /**
   * The scope's full leaderboard, a page at a time. Pages follow the shared
   * contract in src/data/pagination.ts: bounded limits, a stable total
   * order (closed-won descending, then open pipeline descending, ties in
   * roster order over the epoch-immutable book), and opaque cursors bound
   * to this exact query — phase, type lens, drill-down, and prospect
   * membership — and data epoch. Session edits re-rank rows; the hook
   * restarts its loaded window on an edit rather than reusing a cursor.
   */
  listPartnerLeaderboard(
    access: DemoAccessScope,
    scope: PerformanceScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<PartnerLeaderboardEntry>>>;
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
   * most urgent `maxAlerts` alerts, never the whole queue. `maxAlerts` must
   * be a positive integer no greater than `MAX_SLA_ALERT_DIGEST`; anything
   * else rejects with a typed `SlaAlertLimitError` rather than a clamped
   * window.
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
 * What the app is wired to today: the scoped shape, in full. There is no
 * legacy side any more. An alias rather than a redeclaration so the two names
 * stay interchangeable for callers that import either.
 */
export type DataProvider = ScopedQueryProvider;

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
  // Action Center
  getActionCenterSummary: true,
  listActionItems: true,
  // Forecasting
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
  getTopPartnerLeaders: true,
  listPartnerLeaderboard: true,
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

/**
 * How many arguments each contract method takes before its trailing
 * `QueryContext`, keyed by the interface's own method names so a method
 * added without an entry here is a compile error. The seam wrappers forward
 * calls through a Proxy instead of re-declaring every method (see
 * traceDataProvider.ts and mock/createSimulatedRemoteProvider.ts), and a Proxy
 * needs this table to rebuild the argument list with the context in the
 * correct slot — padding it in when the caller omitted it, exactly as the
 * hand-written forwarding methods did.
 */
export const DATA_PROVIDER_CONTEXT_SLOTS: Record<keyof DataProvider, number> = {
  // Action Center
  getActionCenterSummary: 2,
  listActionItems: 3,
  // Forecasting
  getForecastSummary: 2,
  getWeightedForecast: 2,
  getForecastQuality: 3,
  getManagerForecastGroups: 2,
  getWeeklyForecastSeries: 2,
  listQuarterOpportunities: 3,
  getPartnerDirectory: 1,
  // Home and Partner Performance
  getPerformanceSummary: 2,
  getRegistrationFunnel: 2,
  getStageBreakdown: 2,
  getTypeBreakdown: 2,
  getQuarterlyRevenueTrend: 2,
  getWeeklyActivitySeries: 2,
  getWeeklyGoalProgress: 2,
  getRegistrationOpsSummary: 2,
  getTopPartnerLeaders: 2,
  listPartnerLeaderboard: 3,
  getManagerDirectory: 1,
  getPartnerRoster: 2,
  getPartnerCertification: 2,
  listScopedOpportunities: 3,
  listPendingRegistrations: 3,
  listUnconvertedRegistrations: 3,
  listDuplicateRegistrationGroups: 3,
  listRecentRegistrations: 3,
  // Data Connections
  getTeamRoster: 2,
  getRegistrationSlaAlerts: 3,
  // Activity Tracking
  listWeeklyClassificationMeetings: 3,
};
