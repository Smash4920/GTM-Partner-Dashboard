import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTION_POLICY } from '../../lib/actionRules';
import { ACTION_CATEGORIES } from '../actionCenter';
import { CURRENT_FISCAL_QUARTER } from '../constants';
import { filterByPhase, phaseForQuarter } from '../../lib/metrics';
import { MockDataProvider } from './MockDataProvider';
import { DEFAULT_SCALE, ScaleDataProvider } from './ScaleDataProvider';
import { generateDashboardData } from './generate';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';

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

  get partners() {
    return this.data.partners;
  }

  get opportunities() {
    return this.data.opportunities;
  }
}

const scaled = new Inspectable(SCALE, base);
const flat = new MockDataProvider(base);

describe('ScaleDataProvider', () => {
  it('serves bounded scoped Action Center results at 100× (VAL-ACT-011)', async () => {
    const hundred = new ScaleDataProvider(100, base);
    const scope = { policy: DEFAULT_ACTION_POLICY };
    const localSummary = await flat.getActionCenterSummary(INTERNAL_DEMO_SCOPE, scope);
    const summary = await hundred.getActionCenterSummary(INTERNAL_DEMO_SCOPE, scope);
    const localPage = await flat.listActionItems(INTERNAL_DEMO_SCOPE, scope, {});
    const page = await hundred.listActionItems(INTERNAL_DEMO_SCOPE, scope, {});
    expect(summary.data.totalCount).toBe(localSummary.data.totalCount * 100);
    for (const category of ACTION_CATEGORIES) {
      expect(summary.data.categoryCounts[category]).toBe(
        localSummary.data.categoryCounts[category] * 100,
      );
    }
    expect(Object.keys(summary.data)).toEqual(Object.keys(localSummary.data));
    expect(page.data.rows).toHaveLength(25);
    expect(page.data.totalCount).toBe(summary.data.totalCount);
    expect(new Set(page.data.rows.map((row) => row.id)).size).toBe(25);
    expect(summary.meta).toEqual({ ...localSummary.meta, providerId: 'scaled' });
    expect(page.meta).toEqual(summary.meta);
    const bytes = {
      localSummary: new TextEncoder().encode(JSON.stringify(localSummary)).length,
      scaledSummary: new TextEncoder().encode(JSON.stringify(summary)).length,
      localPage: new TextEncoder().encode(JSON.stringify(localPage)).length,
      scaledPage: new TextEncoder().encode(JSON.stringify(page)).length,
    };
    expect(bytes.localSummary).toBe(486);
    expect(bytes.scaledSummary).toBe(499);
    expect(bytes.scaledSummary).toBeLessThan(1024);
    expect(bytes.scaledPage).toBeLessThan(30_000);
    expect(bytes.scaledPage).toBeLessThan(bytes.localPage * 2);
    expect(JSON.stringify([summary, page])).not.toMatch(/takenAt|"snapshots":|forecastCategory/);
    const partner = { audience: 'partner' as const, partnerId: base.partners[0]!.id };
    const own = await hundred.listActionItems(partner, scope, {});
    const localOwn = await flat.listActionItems(partner, scope, {});
    expect(own.data).toEqual(localOwn.data);
    expect(own.data.rows.every((row) => row.owner === undefined)).toBe(true);
  });

  it('multiplies the book and leaves the roster alone', () => {
    expect(scaled.size.partners).toBe(base.partners.length * SCALE);
    expect(scaled.size.opportunities).toBe(base.opportunities.length * SCALE);
    expect(scaled.size.snapshots).toBe(base.snapshots.length * SCALE);
    expect(scaled.size.approxBytes).toBeGreaterThan(1_000_000);
    // The roster is not the book: scaling people would change nothing the seam
    // ships, and would make a manager's group a slice of a crowd.
    expect(base.partnerManagers).toHaveLength(5);
  });

  it('keeps every copy internally consistent', () => {
    const partners = scaled.partners;
    const opportunities = scaled.opportunities;
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

  it('answers the scoped contract at the same shape, with 5× the values', async () => {
    const { data: weeks, meta } = await scaled.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    const { data: flatWeeks } = await flat.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    expect(weeks.length).toBe(flatWeeks.length);

    const { data: page } = await scaled.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 25 },
    );
    expect(page.rows).toHaveLength(25);
    expect(page.totalCount).toBe(
      filterByPhase(base.opportunities, phaseForQuarter(quarter)).length * SCALE,
    );

    const { data: summary } = await scaled.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    const { data: flatSummary } = await flat.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    expect(summary.openCount).toBe(flatSummary.openCount * SCALE);
    expect(summary.openPipelineValue).toBe(flatSummary.openPipelineValue * SCALE);
    // The 5× book is a different answer, and the envelope says so.
    expect(meta.providerId).toBe('scaled');
  });

  it('defaults to the multiple the demo advertises', () => {
    expect(DEFAULT_SCALE).toBe(100);
  });

  it('is the same provider at scale 1', async () => {
    const one = new ScaleDataProvider(1, base);
    expect(one.size.opportunities).toBe(base.opportunities.length);
    expect(one.size.snapshots).toBe(base.snapshots.length);
    const { data: summary } = await one.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    const { data: flatSummary } = await flat.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    expect(summary).toEqual(flatSummary);
  });
});
