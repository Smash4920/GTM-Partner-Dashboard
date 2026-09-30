import type { QueryContext } from './queryContext';
import type { QueryResult } from './queryMetadata';
import type { SessionEdits } from './sessionEdits';
import type { CoverageState } from '../lib/metrics';
import type {
  ActivityMeeting,
  DealRegistration,
  ForecastCategory,
  Opportunity,
  OpportunityStage,
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
 *   large the book is, and rows come back a page at a time. Forecasting is
 *   built on it.
 * - `LegacyBookProvider` is the shape being retired: eight calls that each
 *   return an entire collection, which the browser then aggregates itself.
 *   Seven views still depend on it.
 *
 * The split is the backlog. A view moves across when its queries exist on the
 * scoped side, and `LegacyBookProvider` is deleted when the last one has.
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
 * and small dimensions, and it goes the same way view by view.
 */
interface LegacyBookProvider {
  listPartnerManagers(context?: QueryContext): Promise<PartnerManager[]>;
  listPartners(context?: QueryContext): Promise<Partner[]>;
  listRegistrations(context?: QueryContext): Promise<DealRegistration[]>;
  listOpportunities(context?: QueryContext): Promise<Opportunity[]>;
  getTargets(context?: QueryContext): Promise<Target[]>;
  listActivities(context?: QueryContext): Promise<ActivityMeeting[]>;
  listCertifications(context?: QueryContext): Promise<PartnerCertification[]>;
  /**
   * The internal partner-team roster, projected from the identity provider.
   * This is what decides who a deal-registration alert belongs to; a provider
   * with no roster yet may return an empty array, and the alerts simply carry
   * no owner.
   */
  listTeamUsers(context?: QueryContext): Promise<TeamUser[]>;
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

export interface PageRequest {
  /** Opaque cursor from a previous `Page`; omitted starts at the first page. */
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  rows: T[];
  /** Absent once the last page has been served. */
  nextCursor?: string;
  /** Total matching the scope, for "showing 25 of 213". */
  totalCount: number;
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

/**
 * Every scoped answer is an envelope: the data plus the metadata that makes
 * it honest — the committed provider's id, the deterministic as-of instant,
 * typed lineage, and a completeness state with typed warnings. A partial or
 * stale answer can never look like a complete, current one, because the
 * envelope says so. See src/data/queryMetadata.ts.
 */
interface ScopedQueryProvider {
  getForecastSummary(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastSummary>>;
  getWeightedForecast(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeightedForecastSummary>>;
  getForecastQuality(
    scope: ForecastScope,
    sampleSize: number,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastQualitySummary>>;
  getManagerForecastGroups(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ManagerForecastGroup[]>>;
  /**
   * Week-over-week state of the quarter's pipeline: one row per week, about
   * fourteen of them, in place of every snapshot row ever written.
   */
  getWeeklyForecastSeries(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklySeriesRow[]>>;
  /**
   * One manager's in-quarter book, a page at a time. Requested when a group is
   * expanded, rather than loaded for every manager up front.
   */
  listQuarterOpportunities(
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
   * concern. Unpaginated on purpose, and scoped by the caller's authorization
   * rather than by a scope argument: a partner signed into the portal receives
   * one entry, their own.
   */
  getPartnerDirectory(context?: QueryContext): Promise<QueryResult<PartnerRef[]>>;
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
};

export const DATA_PROVIDER_METHODS = Object.keys(METHOD_INDEX) as (keyof DataProvider)[];
