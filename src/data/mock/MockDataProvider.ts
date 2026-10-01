import type {
  ActivityScope,
  DataProvider,
  ForecastQualitySummary,
  ForecastScope,
  ForecastSummary,
  ManagerForecastGroup,
  MismatchRow,
  Page,
  PageRequest,
  PartnerCertificationProfile,
  PartnerCertificationScope,
  PartnerDrilldown,
  PartnerLeaderboardEntry,
  PartnerRef,
  PendingRegistrationsScope,
  PerformanceScope,
  PerformanceSummary,
  RegistrationOpsSummary,
  RegistrationSlaAlertDigest,
  RevenueTrendScope,
  StageBreakdown,
  TeamRosterScope,
  WeeklyClassificationScope,
  WeeklySeriesRow,
  WeightedForecastSummary,
} from '../DataProvider';
import { throwIfAborted } from '../../lib/abort';
import {
  demoScopeKey,
  scopeActivities,
  scopeCertifications,
  scopeOpportunities,
  scopePartnerManagers,
  scopePartners,
  scopeRegistrations,
  scopeTargets,
  scopeTeamUsers,
} from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import { paginateRows } from '../pagination';
import type { QueryContext } from '../queryContext';
import {
  buildQueryMeta,
  queryResult,
  unattributedOpportunitiesWarning,
  weeklyHistoryReconstructedWarning,
} from '../queryMetadata';
import type { DataLineage, DataWarning, QueryMeta, QueryResult } from '../queryMetadata';
import { applySessionEdits, NO_SESSION_EDITS } from '../sessionEdits';
import type { SessionEdits } from '../sessionEdits';
import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerManager,
  ProviderBook,
  Target,
  TeamUser,
} from '../types';
import { SNAPSHOT_DATE } from '../constants';
import {
  activePartnerCount,
  applyTeamRosterOverlays,
  approvalRate,
  approvedNotConverted,
  avgOpenDealSize,
  categoryStageMismatches,
  closedWonForPhase,
  closedWonPriorYearForPhase,
  coverageState,
  currentWeekMeetings,
  daysLeftInQuarter,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  filterByPhase,
  filterByType,
  filterRegistrationsByPhase,
  openOpportunities,
  openPipeline,
  outcomeTotals,
  pendingRegistrations,
  phaseForQuarter,
  quarterlyClosedWonAndTarget,
  registrationConversionRate,
  registrationConversionTimes,
  registrationFunnel,
  registrationSlaAlerts,
  registrationsNewestFirst,
  registrationsPastSla,
  remainingQuota,
  stageBreakdown,
  targetsForPhase,
  typeBreakdown,
  weeklyActivity,
  weeklyForecastRows,
  weeklyGoalProgress,
  weightedForecast,
  winRateForPhase,
} from '../../lib/metrics';
import type {
  DuplicateRegistrationGroup,
  QuarterRevenueRow,
  RegistrationFunnel,
  TypeRow,
  WeeklyActivityRow,
  WeeklyGoalProgress,
} from '../../lib/metrics';
import { generateDashboardData } from './generate';

/**
 * Mock implementation of the DataProvider seam: deterministic, seeded data
 * (see generate.ts).
 *
 * The scoped queries are the point of this file. Every aggregate is computed
 * *here*, behind the seam, using the same `src/lib/metrics` functions the
 * views used to call themselves — which is exactly where that arithmetic
 * lives once a server owns it. What crosses the seam is an answer whose size
 * does not depend on the size of the book.
 *
 * That also means `src/lib/metrics` is now the specification a server
 * implementation has to match, and its test suite is the conformance check.
 * See docs/migration-plan.md.
 *
 * Every method takes the required `DemoAccessScope` first and applies it
 * (via src/data/accessScope.ts) before any aggregation, ordering, or
 * pagination: the scoped collections are the input the metrics see, so a
 * partner-audience answer is computed from that partner's rows alone. The
 * scope is demonstrative filtering, never an authorization claim.
 */
export class MockDataProvider implements DataProvider {
  protected readonly data: ProviderBook;
  /** Partner → owning partner manager, built once for scoping filters. */
  private readonly managerByPartner: Map<string, string>;
  /**
   * The identity stamped into every answer's metadata. `createProvider`
   * assigns the app-level id; a bare instance is the local mock.
   */
  private readonly providerId: string;

  constructor(data: ProviderBook = generateDashboardData(), options?: { providerId?: string }) {
    this.data = data;
    this.managerByPartner = new Map(
      data.partners.map((partner) => [partner.id, partner.partnerManagerId]),
    );
    this.providerId = options?.providerId ?? 'local';
  }

  // ---- the shape being retired --------------------------------------------

  async listPartnerManagers(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopePartnerManagers(this.data.partnerManagers, access);
  }

  async listPartners(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopePartners(this.data.partners, access);
  }

  async listRegistrations(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopeRegistrations(this.data.registrations, this.data.partners, access);
  }

  async listOpportunities(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopeOpportunities(this.data.opportunities, this.data.partners, access);
  }

  async getTargets(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopeTargets(this.data.targets, this.data.partners, access);
  }

  async listActivities(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopeActivities(this.data.activities, this.data.partners, access);
  }

  async listCertifications(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopeCertifications(this.data.certifications, this.data.partners, access);
  }

  async listTeamUsers(access: DemoAccessScope, context?: QueryContext) {
    throwIfAborted(context?.signal);
    return scopeTeamUsers(this.data.teamUsers, access);
  }

  // ---- the target shape ----------------------------------------------------

  /**
   * The book the query describes: the demo access scope first (the rows the
   * audience may see at all), then the session's edits folded in, then the
   * quarter and the optional manager selection. Applying the edits here
   * rather than in the view is what keeps every aggregate consistent with
   * every other one; applying the access scope first is what keeps every
   * aggregate computed from visible rows alone.
   */
  private scopedBook(
    access: DemoAccessScope,
    scope: ForecastScope,
  ): {
    inQuarter: Opportunity[];
    edited: Opportunity[];
  } {
    const visible = scopeOpportunities(this.data.opportunities, this.data.partners, access);
    const edited = applySessionEdits(visible, scope.edits ?? NO_SESSION_EDITS);
    const phase = phaseForQuarter(scope.quarter);
    let inQuarter = filterByPhase(edited, phase);
    if (scope.partnerManagerId) {
      inQuarter = inQuarter.filter(
        (opp) => this.managerByPartner.get(opp.partnerId) === scope.partnerManagerId,
      );
    }
    return { inQuarter, edited };
  }

  /**
   * The query's target rows, access-scoped first. A manager's quota,
   * attainment, and coverage are measured against the targets committed to
   * *their* partners only — folding the whole org's targets into a manager's
   * summary would read a manager who hit their number as a fraction of
   * everyone else's.
   */
  private scopedTargets(access: DemoAccessScope, scope: ForecastScope): Target[] {
    const visible = scopeTargets(this.data.targets, this.data.partners, access);
    if (!scope.partnerManagerId) return visible;
    return visible.filter(
      (item) => this.managerByPartner.get(item.partnerId) === scope.partnerManagerId,
    );
  }

  /**
   * The envelope metadata for one scoped answer. The as-of is the fixed
   * snapshot date — the mock never reads the wall clock for business data, so
   * the same question always carries the same as-of — and the lineage names
   * what the answer was computed from, including the session's edits when the
   * caller passed any. Completeness derives from the warnings: an answer with
   * a warning is partial by construction.
   */
  private meta(
    edits: SessionEdits | undefined,
    extra: { lineage?: DataLineage[]; warnings?: DataWarning[] } = {},
  ): QueryMeta {
    const applied = edits ?? NO_SESSION_EDITS;
    const editCount =
      Object.keys(applied.revenueOverrides).length +
      Object.keys(applied.notes).length +
      Object.keys(applied.nextSteps).length +
      Object.keys(applied.forecastCalls).length;
    const lineage: DataLineage[] = [
      { source: 'mock-book', description: 'Deterministic seeded book at the snapshot date' },
    ];
    if (editCount > 0) {
      lineage.push({
        source: 'session-edits',
        description: `${editCount} session edits applied before aggregation`,
      });
    }
    lineage.push(...(extra.lineage ?? []));
    return buildQueryMeta({
      providerId: this.providerId,
      asOf: SNAPSHOT_DATE.toISOString(),
      lineage,
      warnings: extra.warnings ?? [],
    });
  }

  /**
   * In-quarter opportunities whose partner is missing from the partner
   * dimension. They still count toward the quarter totals, but no manager
   * group can claim them — the group view warns rather than summing to less
   * than the headline numbers in silence.
   */
  private unattributedInQuarter(inQuarter: Opportunity[]): Opportunity[] {
    return inQuarter.filter((opp) => !this.managerByPartner.has(opp.partnerId));
  }

  async getForecastSummary(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastSummary>> {
    throwIfAborted(context?.signal);
    const { inQuarter } = this.scopedBook(access, scope);
    const phase = phaseForQuarter(scope.quarter);
    const targets = this.scopedTargets(access, scope);
    const open = openPipeline(inQuarter);
    const closedWon = closedWonForPhase(inQuarter, phase);
    const target = targetsForPhase(targets, phase).reduce(
      (sum, item) => sum + item.revenueTarget,
      0,
    );
    return queryResult(
      {
        openPipelineValue: open.value,
        openCount: open.count,
        closedWon,
        target,
        coverage: coverageState(inQuarter, targets, phase),
        remainingQuota: remainingQuota(inQuarter, targets, phase),
        avgOpenDealSize: avgOpenDealSize(inQuarter),
        attainment: target > 0 ? closedWon / target : 0,
        daysLeftInQuarter: daysLeftInQuarter(scope.quarter),
      },
      this.meta(scope.edits),
    );
  }

  async getWeightedForecast(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeightedForecastSummary>> {
    throwIfAborted(context?.signal);
    const { inQuarter } = this.scopedBook(access, scope);
    return queryResult(weightedForecast(openOpportunities(inQuarter)), this.meta(scope.edits));
  }

  async getForecastQuality(
    access: DemoAccessScope,
    scope: ForecastScope,
    sampleSize: number,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastQualitySummary>> {
    throwIfAborted(context?.signal);
    const { inQuarter } = this.scopedBook(access, scope);
    const open = openOpportunities(inQuarter);
    const mismatches = categoryStageMismatches(open);

    const toRow = (row: (typeof mismatches.above)[number]): MismatchRow => ({
      opportunityId: row.opportunity.id,
      accountName: row.opportunity.accountName,
      stage: row.opportunity.stage,
      called: row.called,
      fromStage: row.fromStage,
      forecastedRevenue: row.opportunity.forecastedRevenue,
      direction: row.direction,
    });

    return queryResult(
      {
        openCount: open.length,
        aboveCount: mismatches.above.length,
        aboveValue: mismatches.aboveValue,
        belowCount: mismatches.below.length,
        belowValue: mismatches.belowValue,
        // Both sides are sampled, so a long list of optimistic calls never
        // crowds out the downgraded late-stage deals.
        sample: [
          ...mismatches.above.slice(0, sampleSize).map(toRow),
          ...mismatches.below.slice(0, sampleSize).map(toRow),
        ],
      },
      this.meta(scope.edits),
    );
  }

  async getManagerForecastGroups(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ManagerForecastGroup[]>> {
    throwIfAborted(context?.signal);
    const { inQuarter } = this.scopedBook(access, scope);
    const phase = phaseForQuarter(scope.quarter);

    // One pass to bucket, rather than a filter of the whole book per manager.
    const byManager = new Map<string, Opportunity[]>();
    for (const opp of inQuarter) {
      const managerId = this.managerByPartner.get(opp.partnerId);
      if (managerId === undefined) continue;
      const bucket = byManager.get(managerId);
      if (bucket) bucket.push(opp);
      else byManager.set(managerId, [opp]);
    }

    const groups = scopePartnerManagers(this.data.partnerManagers, access)
      .filter((manager) => !scope.partnerManagerId || manager.id === scope.partnerManagerId)
      .map((manager) => {
        const opportunities = byManager.get(manager.id) ?? [];
        const open = openPipeline(opportunities);
        return {
          managerId: manager.id,
          managerName: manager.name,
          opportunityCount: opportunities.length,
          openValue: open.value,
          closedWon: closedWonForPhase(opportunities, phase),
        };
      });
    const unattributed = this.unattributedInQuarter(inQuarter);
    return queryResult(
      groups,
      this.meta(scope.edits, {
        warnings:
          unattributed.length > 0 ? [unattributedOpportunitiesWarning(unattributed.length)] : [],
      }),
    );
  }

  async getWeeklyForecastSeries(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklySeriesRow[]>> {
    throwIfAborted(context?.signal);
    const { edited } = this.scopedBook(access, scope);
    // The manager *selection* stays quarter-level, deliberately: a snapshot
    // row records an amount, a call, and an expected close, but not whose
    // book the deal was in, so filtering the live weeks by manager would
    // leave the recorded weeks unfiltered and draw a cliff into the chart
    // that never happened. The contract states that as the one documented
    // exception to the query scope. The *access* scope is not an exception:
    // a partner audience's series is computed from its own opportunities and
    // their snapshot rows alone, and a snapshot row always names its
    // opportunity, so the recorded weeks filter by the same visibility as
    // the live ones.
    const snapshots =
      access.audience === 'partner'
        ? this.data.snapshots.filter((row) => {
            const opportunity = this.data.opportunities.find((opp) => opp.id === row.opportunityId);
            return (
              opportunity !== undefined &&
              opportunity.partnerId === access.partnerId &&
              opportunity.oppType !== 'sell-to'
            );
          })
        : this.data.snapshots;
    const weeks = weeklyForecastRows(edited, scope.quarter, SNAPSHOT_DATE, snapshots);
    // A closed week with no recording is reconstructed from today's book,
    // which backdates every later change into it. That is usable but partial
    // history, and the envelope says so rather than drawing it as recorded
    // fact.
    const asOfTs = SNAPSHOT_DATE.getTime();
    const closedWeeks = weeks.filter(
      (week) => week.hasStarted && Date.parse(week.weekEnd) <= asOfTs,
    );
    const reconstructed = closedWeeks.filter((week) => week.recordedAt === undefined);
    const recordedCount = weeks.filter((week) => week.recordedAt !== undefined).length;
    return queryResult(
      weeks,
      this.meta(scope.edits, {
        lineage: [
          {
            source: 'weekly-snapshots',
            description: `${recordedCount} of ${weeks.length} weeks read from recorded snapshots`,
          },
        ],
        warnings:
          reconstructed.length > 0
            ? [weeklyHistoryReconstructedWarning(reconstructed.length, closedWeeks.length)]
            : [],
      }),
    );
  }

  /**
   * The data epoch cursors are minted against. The mock's book is fixed at
   * the snapshot date, so the epoch is the snapshot date; a provider whose
   * data has moved on (a re-sync, a new recording) answers with a newer
   * epoch, and every cursor minted against the older book expires as a
   * typed error rather than silently marking a position in moved rows.
   */
  protected dataEpoch(): string {
    return SNAPSHOT_DATE.toISOString();
  }

  async listQuarterOpportunities(
    access: DemoAccessScope,
    scope: ForecastScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    throwIfAborted(context?.signal);
    const { inQuarter } = this.scopedBook(access, scope);
    // Stable order, so a cursor means the same thing between calls.
    const ordered = [...inQuarter].sort((a, b) =>
      a.expectedCloseDate === b.expectedCloseDate
        ? a.id.localeCompare(b.id)
        : a.expectedCloseDate.localeCompare(b.expectedCloseDate),
    );
    return queryResult(
      paginateRows({
        rows: ordered,
        // The cursor is bound to the query's membership: the access scope,
        // the quarter, and the manager decide WHICH rows belong, so a
        // cursor minted under any other combination is foreign here. Edits
        // are deliberately absent — they change what a row says, never
        // which rows the book holds or how they are ordered, so a cursor
        // survives the edit-driven window refresh.
        queryKey: `listQuarterOpportunities|access:${demoScopeKey(access)}|quarter:${scope.quarter}|manager:${scope.partnerManagerId ?? 'all'}`,
        asOf: this.dataEpoch(),
        cursor: page.cursor,
        limit: page.limit,
      }),
      this.meta(scope.edits),
    );
  }

  async getPartnerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerRef[]>> {
    throwIfAborted(context?.signal);
    // Scoped like every other answer: a partner audience receives its own
    // entry alone, never the directory.
    return queryResult(
      scopePartners(this.data.partners, access).map((partner) => ({
        id: partner.id,
        name: partner.name,
      })),
      this.meta(undefined),
    );
  }

  // ---- Home and Partner Performance ----------------------------------------
  //
  // Same discipline as the forecast queries above: the demo access scope
  // first, the drill-down selection next, the session's edits and
  // classifications folded in, and then the same src/lib/metrics functions
  // the views used to call themselves. What crosses the seam per method is
  // one card's answer, so one rejection fails one card and nothing else.

  /**
   * The roster the drill-down selects from: the provider's partners plus the
   * session's prospects, under the access scope.
   */
  private performanceRoster(access: DemoAccessScope, prospects?: Partner[]): Partner[] {
    return scopePartners([...this.data.partners, ...(prospects ?? [])], access);
  }

  /**
   * The partner set the drill-down selects, or undefined when the query is
   * not drill-down restricted at all (Home's whole-book view). With
   * `partnerFilter: 'roster'` — the shape Partner Performance has always
   * applied — rows whose partner is not on the roster fall out even when no
   * manager or partner is selected.
   */
  private selectedPartnerIds(scope: PartnerDrilldown, roster: Partner[]): Set<string> | undefined {
    if (scope.partnerId !== undefined) return new Set([scope.partnerId]);
    if (scope.partnerManagerId !== undefined) {
      return new Set(
        roster
          .filter((partner) => partner.partnerManagerId === scope.partnerManagerId)
          .map((partner) => partner.id),
      );
    }
    if (scope.partnerFilter === 'roster') {
      return new Set(roster.map((partner) => partner.id));
    }
    return undefined;
  }

  /** Every collection a performance query reads, access-scoped and then
   * drill-down scoped — the rows the metrics below are allowed to see. */
  private performanceBook(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
  ): {
    roster: Partner[];
    selected: Set<string> | undefined;
    opportunities: Opportunity[];
    registrations: DealRegistration[];
    targets: Target[];
  } {
    const roster = this.performanceRoster(access, scope.prospects);
    const selected = this.selectedPartnerIds(scope, roster);
    const inScope = <T extends { partnerId: string }>(rows: T[]): T[] =>
      selected === undefined ? rows : rows.filter((row) => selected.has(row.partnerId));
    return {
      roster,
      selected,
      opportunities: inScope(
        scopeOpportunities(this.data.opportunities, this.data.partners, access),
      ),
      registrations: inScope(
        scopeRegistrations(this.data.registrations, this.data.partners, access),
      ),
      targets: inScope(scopeTargets(this.data.targets, this.data.partners, access)),
    };
  }

  /** The membership identity of a drill-down-scoped page query: everything
   * that decides WHICH rows belong, and nothing that only changes what a
   * row says — so a cursor survives an edit-driven window refresh. */
  private drilldownKey(scope: PartnerDrilldown): string {
    return [
      `manager:${scope.partnerManagerId ?? 'all'}`,
      `partner:${scope.partnerId ?? 'all'}`,
      `filter:${scope.partnerFilter ?? 'none'}`,
    ].join('|');
  }

  async getPerformanceSummary(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<PerformanceSummary>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const { selected } = book;
    const edited = applySessionEdits(book.opportunities, scope.edits ?? NO_SESSION_EDITS);
    const typed = filterByType(edited, scope.oppType ?? 'all');
    const phaseOpps = filterByPhase(typed, scope.phase);
    const phaseRegistrations = filterRegistrationsByPhase(book.registrations, scope.phase);
    const funnel = registrationFunnel(phaseRegistrations);
    const open = openPipeline(phaseOpps);
    const closedWon = closedWonForPhase(phaseOpps, scope.phase);
    const target = targetsForPhase(book.targets, scope.phase).reduce(
      (sum, item) => sum + item.revenueTarget,
      0,
    );
    return queryResult(
      {
        openPipelineValue: open.value,
        openCount: open.count,
        closedWon,
        priorClosedWon: closedWonPriorYearForPhase(typed, scope.phase),
        target,
        attainment: target > 0 ? closedWon / target : 0,
        coverage: coverageState(phaseOpps, book.targets, scope.phase),
        remainingQuota: remainingQuota(phaseOpps, book.targets, scope.phase),
        avgOpenDealSize: avgOpenDealSize(phaseOpps),
        winRate: winRateForPhase(phaseOpps, scope.phase),
        approvalRate: approvalRate(phaseRegistrations),
        decidedRegistrations: funnel.approved + funnel.rejected,
        conversionRate: registrationConversionRate(phaseRegistrations),
        convertedRegistrations: funnel.converted,
        // FY activity is deliberately not phase- or type-filtered, matching
        // the tile's own subtitle.
        activePartners: activePartnerCount(book.opportunities, book.registrations),
        alignedPartners:
          selected === undefined
            ? book.roster.length
            : book.roster.filter((partner) => selected.has(partner.id)).length,
      },
      this.meta(scope.edits),
    );
  }

  async getRegistrationFunnel(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationFunnel>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    return queryResult(
      registrationFunnel(filterRegistrationsByPhase(book.registrations, scope.phase)),
      this.meta(undefined),
    );
  }

  async getStageBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<StageBreakdown>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const edited = applySessionEdits(book.opportunities, scope.edits ?? NO_SESSION_EDITS);
    const phaseOpps = filterByPhase(filterByType(edited, scope.oppType ?? 'all'), scope.phase);
    return queryResult(
      { stages: stageBreakdown(phaseOpps), outcomes: outcomeTotals(phaseOpps) },
      this.meta(scope.edits),
    );
  }

  async getTypeBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<TypeRow[]>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const edited = applySessionEdits(book.opportunities, scope.edits ?? NO_SESSION_EDITS);
    // The type mix of the phase: the type lens selects from this chart, so
    // the chart itself is computed across every type.
    return queryResult(typeBreakdown(filterByPhase(edited, scope.phase)), this.meta(scope.edits));
  }

  async getQuarterlyRevenueTrend(
    access: DemoAccessScope,
    scope: RevenueTrendScope,
    context?: QueryContext,
  ): Promise<QueryResult<QuarterRevenueRow[]>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const edited = applySessionEdits(book.opportunities, scope.edits ?? NO_SESSION_EDITS);
    return queryResult(
      quarterlyClosedWonAndTarget(filterByType(edited, scope.oppType ?? 'all'), book.targets),
      this.meta(scope.edits),
    );
  }

  async getWeeklyActivitySeries(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyActivityRow[]>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const activities = scopeActivities(this.data.activities, this.data.partners, access);
    return queryResult(
      weeklyActivity(activities, scope.partnerManagerId, book.selected, scope.classifications),
      this.meta(undefined),
    );
  }

  async getWeeklyGoalProgress(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyGoalProgress>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const activities = scopeActivities(this.data.activities, this.data.partners, access);
    return queryResult(
      weeklyGoalProgress(
        activities,
        scope.classifications ?? {},
        scope.partnerManagerId,
        book.selected,
      ),
      this.meta(undefined),
    );
  }

  async getRegistrationOpsSummary(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationOpsSummary>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    // Deliberately not phase-filtered: exclusivity lapsing and conversion
    // times span quarters, so a Q3 scope must still see the older
    // registrations that are leaking.
    const leaking = approvedNotConverted(book.registrations);
    return queryResult(
      {
        times: registrationConversionTimes(book.registrations, book.opportunities),
        pending: pendingRegistrations(book.registrations).length,
        approvedNotConverted: leaking.length,
        exclusivityLapsed: leaking.filter(exclusivityLapsed).length,
        pastSla: registrationsPastSla(book.registrations).length,
        duplicateGroups: duplicateRegistrationGroups(book.registrations, book.roster).length,
      },
      this.meta(undefined),
    );
  }

  async getPartnerLeaderboard(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerLeaderboardEntry[]>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const edited = applySessionEdits(book.opportunities, scope.edits ?? NO_SESSION_EDITS);
    const phaseOpps = filterByType(filterByPhase(edited, scope.phase), scope.oppType ?? 'all');
    const certifications = scopeCertifications(
      this.data.certifications,
      this.data.partners,
      access,
    );
    const rows = book.roster
      .filter((partner) => book.selected === undefined || book.selected.has(partner.id))
      .map((partner): PartnerLeaderboardEntry => {
        const own = phaseOpps.filter((opp) => opp.partnerId === partner.id);
        const open = openPipeline(own);
        return {
          partner,
          openPipelineValue: open.value,
          openCount: open.count,
          closedWonValue: closedWonForPhase(own, scope.phase),
          winRate: winRateForPhase(own, scope.phase),
          // undefined, not an empty record: no certification data is a fact
          // about the partner, and the view renders it as such.
          certification: certifications.find((cert) => cert.partnerId === partner.id),
        };
      });
    rows.sort(
      (a, b) => b.closedWonValue - a.closedWonValue || b.openPipelineValue - a.openPipelineValue,
    );
    return queryResult(rows, this.meta(scope.edits));
  }

  async getManagerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerManager[]>> {
    throwIfAborted(context?.signal);
    return queryResult(
      scopePartnerManagers(this.data.partnerManagers, access),
      this.meta(undefined),
    );
  }

  async getPartnerRoster(
    access: DemoAccessScope,
    scope: { prospects?: Partner[] },
    context?: QueryContext,
  ): Promise<QueryResult<Partner[]>> {
    throwIfAborted(context?.signal);
    return queryResult(this.performanceRoster(access, scope.prospects), this.meta(undefined));
  }

  async getPartnerCertification(
    access: DemoAccessScope,
    scope: PartnerCertificationScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerCertificationProfile | null>> {
    throwIfAborted(context?.signal);
    // The roster lookup comes first: it applies the access scope, so a
    // scope-less call fails closed here rather than answering.
    const roster = this.performanceRoster(access, scope.prospects);
    if (scope.partnerId === undefined) return queryResult(null, this.meta(undefined));
    const partner = roster.find((candidate) => candidate.id === scope.partnerId);
    if (partner === undefined) return queryResult(null, this.meta(undefined));
    const certification = scopeCertifications(
      this.data.certifications,
      this.data.partners,
      access,
    ).find((cert) => cert.partnerId === partner.id);
    return queryResult(
      { partner, ...(certification !== undefined ? { certification } : {}) },
      this.meta(undefined),
    );
  }

  async listScopedOpportunities(
    access: DemoAccessScope,
    scope: PerformanceScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const edited = applySessionEdits(book.opportunities, scope.edits ?? NO_SESSION_EDITS);
    const phaseOpps = filterByPhase(filterByType(edited, scope.oppType ?? 'all'), scope.phase);
    // Stable order, so a cursor means the same thing between calls.
    const ordered = [...phaseOpps].sort((a, b) =>
      a.expectedCloseDate === b.expectedCloseDate
        ? a.id.localeCompare(b.id)
        : a.expectedCloseDate.localeCompare(b.expectedCloseDate),
    );
    return queryResult(
      paginateRows({
        rows: ordered,
        queryKey: `listScopedOpportunities|access:${demoScopeKey(access)}|phase:${scope.phase}|type:${scope.oppType ?? 'all'}|${this.drilldownKey(scope)}`,
        asOf: this.dataEpoch(),
        cursor: page.cursor,
        limit: page.limit,
      }),
      this.meta(scope.edits),
    );
  }

  async listPendingRegistrations(
    access: DemoAccessScope,
    scope: PendingRegistrationsScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    const registrations =
      scope.phase === undefined
        ? book.registrations
        : filterRegistrationsByPhase(book.registrations, scope.phase);
    // Oldest first — the metric's stable order over an immutable book, so a
    // cursor walk over unchanged data visits every row exactly once.
    const ordered = pendingRegistrations(registrations);
    return queryResult(
      paginateRows({
        rows: ordered,
        queryKey: `listPendingRegistrations|access:${demoScopeKey(access)}|phase:${scope.phase ?? 'all'}|${this.drilldownKey(scope)}`,
        asOf: this.dataEpoch(),
        cursor: page.cursor,
        limit: page.limit,
      }),
      this.meta(undefined),
    );
  }

  async listUnconvertedRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    // Oldest decision first, exactly the order the exclusivity watch has
    // always rendered.
    const ordered = approvedNotConverted(book.registrations);
    return queryResult(
      paginateRows({
        rows: ordered,
        queryKey: `listUnconvertedRegistrations|access:${demoScopeKey(access)}|${this.drilldownKey(scope)}`,
        asOf: this.dataEpoch(),
        cursor: page.cursor,
        limit: page.limit,
      }),
      this.meta(undefined),
    );
  }

  async listDuplicateRegistrationGroups(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DuplicateRegistrationGroup>>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    // Sorted by earliest submission — the metric's own stable order.
    const ordered = duplicateRegistrationGroups(book.registrations, book.roster);
    return queryResult(
      paginateRows({
        rows: ordered,
        queryKey: `listDuplicateRegistrationGroups|access:${demoScopeKey(access)}|${this.drilldownKey(scope)}`,
        asOf: this.dataEpoch(),
        cursor: page.cursor,
        limit: page.limit,
      }),
      this.meta(undefined),
    );
  }

  async listRecentRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    throwIfAborted(context?.signal);
    const book = this.performanceBook(access, scope);
    // Newest submission first — the metric's stable total order, so a cursor
    // walk over an unchanged book visits every row exactly once.
    const ordered = registrationsNewestFirst(book.registrations);
    return queryResult(
      paginateRows({
        rows: ordered,
        queryKey: `listRecentRegistrations|access:${demoScopeKey(access)}|${this.drilldownKey(scope)}`,
        asOf: this.dataEpoch(),
        cursor: page.cursor,
        limit: page.limit,
      }),
      this.meta(undefined),
    );
  }

  // ---- Data Connections ----------------------------------------------------

  /**
   * The roster the session routes simulated notifications to: the access
   * scope first (a partner audience has no roster at all — the session's
   * overlays are internal-roster edits, so they fall with it), then the
   * overlays, so the alert rule below resolves owners against exactly the
   * roster the Access panel renders.
   */
  private teamRoster(access: DemoAccessScope, scope: TeamRosterScope): TeamUser[] {
    const scoped = scopeTeamUsers(this.data.teamUsers, access);
    if (access.audience === 'partner') return scoped;
    return applyTeamRosterOverlays(scoped, scope.overrides ?? {}, scope.added ?? []);
  }

  async getTeamRoster(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    context?: QueryContext,
  ): Promise<QueryResult<TeamUser[]>> {
    throwIfAborted(context?.signal);
    return queryResult(this.teamRoster(access, scope), this.meta(undefined));
  }

  async getRegistrationSlaAlerts(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    maxAlerts: number,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationSlaAlertDigest>> {
    throwIfAborted(context?.signal);
    // The rule reads the access-scoped registrations and partners — a partner
    // audience's queue is computed from its own conflict-free submissions —
    // and the overlaid roster, so a routing change this session is already
    // reflected in who an alert belongs to.
    const alerts = registrationSlaAlerts(
      scopeRegistrations(this.data.registrations, this.data.partners, access),
      scopePartners(this.data.partners, access),
      this.teamRoster(access, scope),
    );
    const alertCountByOwner: Record<string, number> = {};
    for (const alert of alerts) {
      if (alert.owner === undefined) continue;
      alertCountByOwner[alert.owner.id] = (alertCountByOwner[alert.owner.id] ?? 0) + 1;
    }
    return queryResult(
      {
        // The metric's order is the queue's order: due-soon warnings lead,
        // then most overdue. The window is the top of that queue.
        alerts: alerts.slice(0, Math.max(0, maxAlerts)),
        totalCount: alerts.length,
        approachingCount: alerts.filter((alert) => alert.state === 'approaching').length,
        ownedCount: alerts.filter((alert) => alert.owner !== undefined).length,
        alertCountByOwner,
      },
      this.meta(undefined),
    );
  }

  // ---- Activity Tracking ----------------------------------------------------

  async listWeeklyClassificationMeetings(
    access: DemoAccessScope,
    scope: WeeklyClassificationScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<ActivityMeeting>>> {
    throwIfAborted(context?.signal);
    // Access scope first, manager second: a partner-audience calendar is
    // computed from the meetings that audience may see at all.
    const activities = scopeActivities(this.data.activities, this.data.partners, access);
    // Oldest first — the metric's stable order, so a cursor walk over an
    // unchanged week visits every meeting exactly once.
    const ordered = currentWeekMeetings(activities, scope.partnerManagerId);
    return queryResult(
      paginateRows({
        rows: ordered,
        queryKey: `listWeeklyClassificationMeetings|access:${demoScopeKey(access)}|manager:${scope.partnerManagerId}`,
        asOf: this.dataEpoch(),
        cursor: page.cursor,
        limit: page.limit,
      }),
      this.meta(undefined),
    );
  }
}
