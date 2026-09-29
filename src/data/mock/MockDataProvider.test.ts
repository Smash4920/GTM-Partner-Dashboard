import { describe, expect, it } from 'vitest';
import { CURRENT_FISCAL_QUARTER, SNAPSHOT_DATE } from '../constants';
import {
  categoryStageMismatches,
  coverageState,
  daysLeftInQuarter,
  openOpportunities,
  openPipeline,
  phaseForQuarter,
  filterByPhase,
  remainingQuota,
  weightedForecast,
  weeklyForecastRows,
} from '../../lib/metrics';
import { MockDataProvider } from './MockDataProvider';
import { generateDashboardData } from './generate';
import { NO_SESSION_EDITS } from '../sessionEdits';
import { makeOpportunity, makePartner, makeProviderBook, makeTarget } from '../../test/fixtures';
import type { Opportunity } from '../types';

/**
 * The scoped contract, checked against the metrics layer.
 *
 * This is the conformance suite the migration plan calls for. `src/lib/metrics`
 * is the implementation today and the *specification* once a server owns the
 * arithmetic, so every one of these assertions says the same thing: the answer
 * the seam returns is the answer the metrics layer computes. When the server
 * implementation lands, these are the tests that catch it quietly disagreeing
 * with the warehouse.
 */
const quarter = CURRENT_FISCAL_QUARTER;
const phase = phaseForQuarter(quarter);

const book = generateDashboardData();
const provider = new MockDataProvider(book);
const inQuarter = filterByPhase(book.opportunities, phase);

function openOf(rows: Opportunity[]): Opportunity {
  const found = rows.find((row) => row.outcome === undefined);
  if (!found) throw new Error('fixture has no open opportunity');
  return found;
}

describe('MockDataProvider scoped contract', () => {
  it('answers the quarter summary the metrics layer computes', async () => {
    const summary = await provider.getForecastSummary({ quarter });
    const open = openPipeline(inQuarter);
    const target = book.targets
      .filter((item) => item.quarter === quarter)
      .reduce((sum, item) => sum + item.revenueTarget, 0);
    const closedWon = summary.closedWon;

    expect(summary.openPipelineValue).toBe(open.value);
    expect(summary.openCount).toBe(open.count);
    expect(summary.target).toBe(target);
    expect(summary.attainment).toBeCloseTo(target > 0 ? closedWon / target : 0, 10);
    expect(summary.coverage).toEqual(coverageState(inQuarter, book.targets, phase));
    expect(summary.remainingQuota).toBe(remainingQuota(inQuarter, book.targets, phase));
    expect(summary.daysLeftInQuarter).toBe(daysLeftInQuarter(quarter));
    expect(summary.avgOpenDealSize).toBeGreaterThan(0);
  });

  it('answers the weighted forecast in the shape the metrics layer returns', async () => {
    const weighted = await provider.getWeightedForecast({ quarter });
    expect(weighted).toEqual(weightedForecast(openOpportunities(inQuarter)));
  });

  it('bounds the mismatch sample while sizing both sides in full', async () => {
    const quality = await provider.getForecastQuality({ quarter }, 3);
    const mismatches = categoryStageMismatches(openOpportunities(inQuarter));

    expect(quality.openCount).toBe(openOpportunities(inQuarter).length);
    expect(quality.aboveCount).toBe(mismatches.above.length);
    expect(quality.belowCount).toBe(mismatches.below.length);
    expect(quality.aboveValue).toBe(mismatches.aboveValue);
    expect(quality.belowValue).toBe(mismatches.belowValue);

    // Bounded: three a side however long the real lists are. This is the card
    // that used to receive every mismatching deal.
    expect(quality.sample.length).toBeLessThanOrEqual(6);
    expect(quality.sample.map((row) => row.opportunityId)).toEqual([
      ...mismatches.above.slice(0, 3).map((row) => row.opportunity.id),
      ...mismatches.below.slice(0, 3).map((row) => row.opportunity.id),
    ]);
  });

  it('groups by manager and accounts for every in-quarter opportunity once', async () => {
    const groups = await provider.getManagerForecastGroups({ quarter });
    expect(groups).toHaveLength(book.partnerManagers.length);
    expect(groups.reduce((sum, group) => sum + group.opportunityCount, 0)).toBe(inQuarter.length);

    const managerByPartner = new Map(
      book.partners.map((partner) => [partner.id, partner.partnerManagerId]),
    );
    for (const group of groups) {
      const owned = inQuarter.filter(
        (opp) => managerByPartner.get(opp.partnerId) === group.managerId,
      );
      expect(group.opportunityCount).toBe(owned.length);
      expect(group.openValue).toBe(openPipeline(owned).value);
    }
  });

  it('serves week-over-week history as buckets, not as snapshot rows', async () => {
    const weeks = await provider.getWeeklyForecastSeries({ quarter });
    expect(weeks).toEqual(
      weeklyForecastRows(book.opportunities, quarter, SNAPSHOT_DATE, book.snapshots),
    );
    expect(weeks.length).toBeLessThan(20);
    expect(book.snapshots.length).toBeGreaterThan(1_000);
  });

  it('narrows aggregates and rows to one manager, and leaves history quarter-level', async () => {
    const groups = await provider.getManagerForecastGroups({ quarter });
    const managerId = groups[0]!.managerId;

    const page = await provider.listQuarterOpportunities(
      { quarter, partnerManagerId: managerId },
      { limit: 500 },
    );
    const allRows = await provider.listQuarterOpportunities({ quarter }, { limit: 5_000 });
    expect(page.totalCount).toBeLessThan(allRows.totalCount);

    const managerByPartner = new Map(
      book.partners.map((partner) => [partner.id, partner.partnerManagerId]),
    );
    const owned = inQuarter.filter((opp) => managerByPartner.get(opp.partnerId) === managerId);
    const scoped = await provider.getForecastSummary({ quarter, partnerManagerId: managerId });
    expect(scoped.openCount).toBe(openPipeline(owned).count);
    expect(scoped.openPipelineValue).toBe(openPipeline(owned).value);

    expect(
      await provider.getManagerForecastGroups({ quarter, partnerManagerId: managerId }),
    ).toEqual(groups.filter((group) => group.managerId === managerId));

    // The documented exception, pinned here so nobody "fixes" it by filtering
    // the live weeks: a snapshot row does not record whose book a deal was in,
    // so a manager-filtered series would drop the recorded weeks' history and
    // draw a cliff that never happened.
    expect(
      await provider.getWeeklyForecastSeries({ quarter, partnerManagerId: managerId }),
    ).toEqual(await provider.getWeeklyForecastSeries({ quarter }));
  });

  it('walks a paged book exactly once, in a stable order', async () => {
    const expected = await provider.listQuarterOpportunities({ quarter }, { limit: 10_000 });
    const ids = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;

    do {
      const page = await provider.listQuarterOpportunities(
        { quarter },
        { ...(cursor ? { cursor } : {}), limit: 7 },
      );
      expect(page.totalCount).toBe(expected.totalCount);
      expect(page.rows.length).toBeLessThanOrEqual(7);
      for (const row of page.rows) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
      }
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(50);
    } while (cursor !== undefined);

    expect(ids.size).toBe(expected.totalCount);
    // Sorted by expected close, so the same page means the same thing twice.
    const once = await provider.listQuarterOpportunities({ quarter }, { limit: 7 });
    const again = await provider.listQuarterOpportunities({ quarter }, { limit: 7 });
    expect(once.rows.map((row) => row.id)).toEqual(again.rows.map((row) => row.id));
  });

  it('exposes the partner directory rather than the partner collection', async () => {
    const directory = await provider.getPartnerDirectory();
    expect(directory).toEqual(
      book.partners.map((partner) => ({ id: partner.id, name: partner.name })),
    );
  });
});

describe('manager-scoped targets (VAL-DATA-001)', () => {
  /**
   * Two disjoint managers, one partner each, with arithmetic small enough to
   * verify by hand. pm-1 owns partner-1 (40k won, 120k open, 100k target);
   * pm-2 owns partner-2 (150k won, 90k open, 300k target). All Q3.
   */
  const scopedBook = makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', partnerManagerId: 'pm-2' }),
    ],
    opportunities: [
      makeOpportunity({
        id: 'opp-w1',
        partnerId: 'partner-1',
        outcome: 'won',
        forecastedRevenue: 40_000,
        createdAt: '2026-08-01T00:00:00Z',
        expectedCloseDate: '2026-08-10T00:00:00Z',
        closedAt: '2026-08-10T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-o1',
        partnerId: 'partner-1',
        forecastedRevenue: 120_000,
        createdAt: '2026-08-03T00:00:00Z',
        expectedCloseDate: '2026-10-15T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-w2',
        partnerId: 'partner-2',
        outcome: 'won',
        forecastedRevenue: 150_000,
        createdAt: '2026-08-02T00:00:00Z',
        expectedCloseDate: '2026-08-12T00:00:00Z',
        closedAt: '2026-08-12T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-o2',
        partnerId: 'partner-2',
        forecastedRevenue: 90_000,
        createdAt: '2026-08-04T00:00:00Z',
        expectedCloseDate: '2026-09-30T00:00:00Z',
      }),
    ],
    targets: [
      makeTarget({ partnerId: 'partner-1', quarter, revenueTarget: 100_000 }),
      makeTarget({ partnerId: 'partner-2', quarter, revenueTarget: 300_000 }),
    ],
  });
  const scopedProvider = new MockDataProvider(scopedBook);

  it('measures the whole org against every target row', async () => {
    // The fixture's ownership map, stated so the expected sums below say
    // which partner IDs each manager's target rows belong to.
    expect(scopedBook.partners.map((partner) => [partner.id, partner.partnerManagerId])).toEqual([
      ['partner-1', 'pm-1'],
      ['partner-2', 'pm-2'],
    ]);

    const org = await scopedProvider.getForecastSummary({ quarter });
    expect(org.target).toBe(400_000); // partner-1 100k + partner-2 300k
    expect(org.closedWon).toBe(190_000);
    expect(org.remainingQuota).toBe(210_000);
    expect(org.attainment).toBeCloseTo(0.475, 10);
    expect(org.coverage).toEqual({ kind: 'coverage', value: 1 }); // 210k open / 210k gap
  });

  it('measures each manager only against their own partners’ targets', async () => {
    const pm1 = await scopedProvider.getForecastSummary({ quarter, partnerManagerId: 'pm-1' });
    expect(pm1.target).toBe(100_000); // partner-1 only; partner-2's 300k stays out
    expect(pm1.closedWon).toBe(40_000);
    expect(pm1.remainingQuota).toBe(60_000);
    expect(pm1.attainment).toBeCloseTo(0.4, 10);
    expect(pm1.coverage).toEqual({ kind: 'coverage', value: 2 }); // 120k open / 60k gap

    const pm2 = await scopedProvider.getForecastSummary({ quarter, partnerManagerId: 'pm-2' });
    expect(pm2.target).toBe(300_000); // partner-2 only
    expect(pm2.closedWon).toBe(150_000);
    expect(pm2.remainingQuota).toBe(150_000);
    expect(pm2.attainment).toBeCloseTo(0.5, 10);
    expect(pm2.coverage).toEqual({ kind: 'coverage', value: 0.6 }); // 90k open / 150k gap
  });

  it('lets in-scope target changes move a manager and ignores out-of-scope ones', async () => {
    const changed = new MockDataProvider({
      ...scopedBook,
      targets: scopedBook.targets.map((item) =>
        item.partnerId === 'partner-2' ? { ...item, revenueTarget: 600_000 } : item,
      ),
    });

    const before = await scopedProvider.getForecastSummary({ quarter, partnerManagerId: 'pm-1' });
    // partner-2's target doubled, but pm-1's summary cannot tell.
    expect(await changed.getForecastSummary({ quarter, partnerManagerId: 'pm-1' })).toEqual(before);

    const pm2 = await changed.getForecastSummary({ quarter, partnerManagerId: 'pm-2' });
    expect(pm2.target).toBe(600_000);
    expect(pm2.remainingQuota).toBe(450_000);
    expect(pm2.attainment).toBeCloseTo(0.25, 10);
    expect(pm2.coverage).toEqual({ kind: 'coverage', value: 0.2 }); // 90k open / 450k gap
  });

  it('distinguishes no-target from target-met for a manager scope', async () => {
    const noTarget = new MockDataProvider({
      ...scopedBook,
      targets: scopedBook.targets.filter((item) => item.partnerId !== 'partner-1'),
    });
    const pm1 = await noTarget.getForecastSummary({ quarter, partnerManagerId: 'pm-1' });
    expect(pm1.target).toBe(0);
    expect(pm1.remainingQuota).toBe(0);
    expect(pm1.attainment).toBe(0);
    expect(pm1.coverage).toEqual({ kind: 'no-target' });
    // The org still sees partner-2's target — the state is scoped, not global.
    const org = await noTarget.getForecastSummary({ quarter });
    expect(org.target).toBe(300_000);

    const met = new MockDataProvider({
      ...scopedBook,
      targets: scopedBook.targets.map((item) =>
        item.partnerId === 'partner-1' ? { ...item, revenueTarget: 30_000 } : item,
      ),
    });
    const pm1Met = await met.getForecastSummary({ quarter, partnerManagerId: 'pm-1' });
    expect(pm1Met.target).toBe(30_000);
    expect(pm1Met.closedWon).toBe(40_000);
    expect(pm1Met.remainingQuota).toBe(0);
    // 120k of open pipeline over a zero gap is target-met, not a ratio.
    expect(pm1Met.coverage).toEqual({ kind: 'target-met' });
  });
});

describe('MockDataProvider folds session edits behind the seam', () => {
  const target = openOf(inQuarter);

  it('moves open pipeline by the edited amount', async () => {
    const before = await provider.getForecastSummary({ quarter });
    const raise = 40_000;
    const after = await provider.getForecastSummary({
      quarter,
      edits: {
        ...NO_SESSION_EDITS,
        revenueOverrides: { [target.id]: target.forecastedRevenue + raise },
      },
    });

    expect(after.openPipelineValue).toBe(before.openPipelineValue + raise);
    expect(after.openCount).toBe(before.openCount);
  });

  it('re-weights the forecast when a deal is re-called', async () => {
    const before = await provider.getWeightedForecast({ quarter });
    const after = await provider.getWeightedForecast({
      quarter,
      edits: { ...NO_SESSION_EDITS, forecastCalls: { [target.id]: 'commit' } },
    });

    // The aggregate has to reflect the call, which is only true if the edits
    // were folded in before the arithmetic rather than after it.
    expect(after.total).toBeGreaterThanOrEqual(before.total);
    const commitBefore = before.rows.find((row) => row.category === 'commit')!.count;
    const commitAfter = after.rows.find((row) => row.category === 'commit')!.count;
    expect(commitAfter).toBeGreaterThanOrEqual(commitBefore);
  });

  it('keeps a cleared next step cleared, rather than falling back to the book', async () => {
    const seeded = inQuarter.find((opp) => opp.nextStep !== undefined);
    if (!seeded) throw new Error('fixture has no seeded next step');

    const page = await provider.listQuarterOpportunities(
      { quarter, edits: { ...NO_SESSION_EDITS, nextSteps: { [seeded.id]: '' } } },
      { limit: 10_000 },
    );
    const row = page.rows.find((candidate) => candidate.id === seeded.id);
    // Presence is the edit; '' is the tombstone. A `??` fallback anywhere in
    // this path would restore the CRM's value and the clear would look broken.
    expect(row?.nextStep).toBe('');
  });
});
