import type {
  DataProvider,
  ForecastQualitySummary,
  ForecastScope,
  ForecastSummary,
  ManagerForecastGroup,
  MismatchRow,
  Page,
  PageRequest,
  PartnerRef,
  WeeklySeriesRow,
  WeightedForecastSummary,
} from '../DataProvider';
import { throwIfAborted } from '../../lib/abort';
import {
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
import type { Opportunity, ProviderBook, Target } from '../types';
import { SNAPSHOT_DATE } from '../constants';
import {
  avgOpenDealSize,
  categoryStageMismatches,
  closedWonForPhase,
  coverageState,
  daysLeftInQuarter,
  filterByPhase,
  openOpportunities,
  openPipeline,
  phaseForQuarter,
  remainingQuota,
  targetsForPhase,
  weightedForecast,
  weeklyForecastRows,
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
    const offset = decodeCursor(page.cursor);
    const rows = ordered.slice(offset, offset + page.limit);
    const next = offset + rows.length;
    return queryResult(
      {
        rows,
        totalCount: ordered.length,
        ...(next < ordered.length ? { nextCursor: encodeCursor(next) } : {}),
      },
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
}

/**
 * Offsets, wrapped so callers cannot do arithmetic on them. A real provider
 * would encode a sort key here; treating the cursor as opaque from the start
 * means swapping to one changes nothing above this line.
 */
function encodeCursor(offset: number): string {
  return `offset:${offset}`;
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const offset = Number(cursor.slice('offset:'.length));
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}
