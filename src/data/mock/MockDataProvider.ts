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
import { applySessionEdits, NO_SESSION_EDITS } from '../sessionEdits';
import type { Opportunity, ProviderBook } from '../types';
import { SNAPSHOT_DATE } from '../constants';
import {
  avgOpenDealSize,
  categoryStageMismatches,
  closedWonForPhase,
  coverageRatio,
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
 */
export class MockDataProvider implements DataProvider {
  protected readonly data: ProviderBook;

  constructor(data: ProviderBook = generateDashboardData()) {
    this.data = data;
  }

  // ---- the shape being retired --------------------------------------------

  async listPartnerManagers() {
    return this.data.partnerManagers;
  }

  async listPartners() {
    return this.data.partners;
  }

  async listRegistrations() {
    return this.data.registrations;
  }

  async listOpportunities() {
    return this.data.opportunities;
  }

  async getTargets() {
    return this.data.targets;
  }

  async listActivities() {
    return this.data.activities;
  }

  async listCertifications() {
    return this.data.certifications;
  }

  async listTeamUsers() {
    return this.data.teamUsers;
  }

  // ---- the target shape ----------------------------------------------------

  /**
   * The book the scope describes, with the session's edits folded in first.
   * Applying them here rather than in the view is what keeps every aggregate
   * consistent with every other one.
   */
  private scopedBook(scope: ForecastScope): {
    inQuarter: Opportunity[];
    edited: Opportunity[];
  } {
    const edited = applySessionEdits(this.data.opportunities, scope.edits ?? NO_SESSION_EDITS);
    const phase = phaseForQuarter(scope.quarter);
    let inQuarter = filterByPhase(edited, phase);
    if (scope.partnerManagerId) {
      const managerByPartner = new Map(
        this.data.partners.map((partner) => [partner.id, partner.partnerManagerId]),
      );
      inQuarter = inQuarter.filter(
        (opp) => managerByPartner.get(opp.partnerId) === scope.partnerManagerId,
      );
    }
    return { inQuarter, edited };
  }

  async getForecastSummary(scope: ForecastScope): Promise<ForecastSummary> {
    const { inQuarter } = this.scopedBook(scope);
    const phase = phaseForQuarter(scope.quarter);
    const open = openPipeline(inQuarter);
    const closedWon = closedWonForPhase(inQuarter, phase);
    const target = targetsForPhase(this.data.targets, phase).reduce(
      (sum, item) => sum + item.revenueTarget,
      0,
    );
    return {
      openPipelineValue: open.value,
      openCount: open.count,
      closedWon,
      target,
      coverage: coverageRatio(inQuarter, this.data.targets, phase),
      remainingQuota: remainingQuota(inQuarter, this.data.targets, phase),
      avgOpenDealSize: avgOpenDealSize(inQuarter),
      attainment: target > 0 ? closedWon / target : 0,
      daysLeftInQuarter: daysLeftInQuarter(scope.quarter),
    };
  }

  async getWeightedForecast(scope: ForecastScope): Promise<WeightedForecastSummary> {
    const { inQuarter } = this.scopedBook(scope);
    return weightedForecast(openOpportunities(inQuarter));
  }

  async getForecastQuality(
    scope: ForecastScope,
    sampleSize: number,
  ): Promise<ForecastQualitySummary> {
    const { inQuarter } = this.scopedBook(scope);
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

    return {
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
    };
  }

  async getManagerForecastGroups(scope: ForecastScope): Promise<ManagerForecastGroup[]> {
    const { inQuarter } = this.scopedBook(scope);
    const phase = phaseForQuarter(scope.quarter);
    const managerByPartner = new Map(
      this.data.partners.map((partner) => [partner.id, partner.partnerManagerId]),
    );

    // One pass to bucket, rather than a filter of the whole book per manager.
    const byManager = new Map<string, Opportunity[]>();
    for (const opp of inQuarter) {
      const managerId = managerByPartner.get(opp.partnerId);
      if (managerId === undefined) continue;
      const bucket = byManager.get(managerId);
      if (bucket) bucket.push(opp);
      else byManager.set(managerId, [opp]);
    }

    return this.data.partnerManagers
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
  }

  async getWeeklyForecastSeries(scope: ForecastScope): Promise<WeeklySeriesRow[]> {
    const { edited } = this.scopedBook(scope);
    // Deliberately the whole book, not the scoped slice. A snapshot row records
    // an amount, a call, and an expected close, but not whose book the deal was
    // in, so filtering the live weeks by manager would leave the recorded weeks
    // unfiltered and draw a cliff into the chart that never happened. The
    // contract states this as the one documented exception to the scope.
    return weeklyForecastRows(edited, scope.quarter, SNAPSHOT_DATE, this.data.snapshots);
  }

  async listQuarterOpportunities(
    scope: ForecastScope,
    page: PageRequest,
  ): Promise<Page<Opportunity>> {
    const { inQuarter } = this.scopedBook(scope);
    // Stable order, so a cursor means the same thing between calls.
    const ordered = [...inQuarter].sort((a, b) =>
      a.expectedCloseDate === b.expectedCloseDate
        ? a.id.localeCompare(b.id)
        : a.expectedCloseDate.localeCompare(b.expectedCloseDate),
    );
    const offset = decodeCursor(page.cursor);
    const rows = ordered.slice(offset, offset + page.limit);
    const next = offset + rows.length;
    return {
      rows,
      totalCount: ordered.length,
      ...(next < ordered.length ? { nextCursor: encodeCursor(next) } : {}),
    };
  }

  async getPartnerDirectory(): Promise<PartnerRef[]> {
    return this.data.partners.map((partner) => ({ id: partner.id, name: partner.name }));
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
