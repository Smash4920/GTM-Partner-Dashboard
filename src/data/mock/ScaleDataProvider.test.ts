import { describe, expect, it } from 'vitest';
import { CURRENT_FISCAL_QUARTER } from '../constants';
import { filterByPhase, phaseForQuarter } from '../../lib/metrics';
import { MockDataProvider } from './MockDataProvider';
import { DEFAULT_SCALE, ScaleDataProvider } from './ScaleDataProvider';
import { generateDashboardData } from './generate';

const quarter = CURRENT_FISCAL_QUARTER;
const base = generateDashboardData();
/** Small enough to check by hand; the shape of the claim is scale-independent. */
const SCALE = 5;

/**
 * The provider holds history behind `protected data`, deliberately, so the
 * test reaches it the way the seam does not: by subclassing.
 */
class Inspectable extends ScaleDataProvider {
  get snapshotRows() {
    return this.data.snapshots;
  }
}

const scaled = new Inspectable(SCALE, base);
const flat = new MockDataProvider(base);

describe('ScaleDataProvider', () => {
  it('multiplies the book and leaves the roster alone', () => {
    expect(scaled.size.partners).toBe(base.partners.length * SCALE);
    expect(scaled.size.opportunities).toBe(base.opportunities.length * SCALE);
    expect(scaled.size.snapshots).toBe(base.snapshots.length * SCALE);
    expect(scaled.size.approxBytes).toBeGreaterThan(1_000_000);
    // The roster is not the book: scaling people would change nothing the seam
    // ships, and would make a manager's group a slice of a crowd.
    expect(base.partnerManagers).toHaveLength(5);
  });

  it('keeps every copy internally consistent', async () => {
    const partners = await scaled.listPartners();
    const opportunities = await scaled.listOpportunities();
    const snapshotRows = scaled.snapshotRows;

    expect(new Set(partners.map((partner) => partner.id)).size).toBe(partners.length);
    expect(new Set(opportunities.map((opp) => opp.id)).size).toBe(opportunities.length);

    const partnerIds = new Set(partners.map((partner) => partner.id));
    const opportunityIds = new Set(opportunities.map((opp) => opp.id));
    // A copy whose foreign keys were not rewritten would look fine until a row
    // rendered the wrong partner, which is the sort of bug a scale fixture
    // exists to make impossible.
    expect(opportunities.every((opp) => partnerIds.has(opp.partnerId))).toBe(true);
    expect(snapshotRows.every((row) => opportunityIds.has(row.opportunityId))).toBe(true);
  });

  it('answers the scoped contract at the same size, and the legacy one at 5×', async () => {
    const { data: weeks, meta } = await scaled.getWeeklyForecastSeries({ quarter });
    const { data: flatWeeks } = await flat.getWeeklyForecastSeries({ quarter });
    expect(weeks.length).toBe(flatWeeks.length);

    const { data: page } = await scaled.listQuarterOpportunities({ quarter }, { limit: 25 });
    expect(page.rows).toHaveLength(25);
    expect(page.totalCount).toBe(
      filterByPhase(base.opportunities, phaseForQuarter(quarter)).length * SCALE,
    );

    const { data: summary } = await scaled.getForecastSummary({ quarter });
    const { data: flatSummary } = await flat.getForecastSummary({ quarter });
    expect(summary.openCount).toBe(flatSummary.openCount * SCALE);
    expect(summary.openPipelineValue).toBe(flatSummary.openPipelineValue * SCALE);
    // The 5× book is a different answer, and the envelope says so.
    expect(meta.providerId).toBe('scaled');

    expect((await scaled.listOpportunities()).length).toBe(base.opportunities.length * SCALE);
    expect((await scaled.listPartners()).length).toBe(base.partners.length * SCALE);
  });

  it('defaults to the multiple the demo advertises', () => {
    expect(DEFAULT_SCALE).toBe(100);
  });

  it('is the same provider at scale 1', async () => {
    const one = new ScaleDataProvider(1, base);
    expect(one.size.opportunities).toBe(base.opportunities.length);
    expect(one.size.snapshots).toBe(base.snapshots.length);
    expect((await one.listOpportunities())[0]?.id).toBe(base.opportunities[0]?.id);
  });
});
