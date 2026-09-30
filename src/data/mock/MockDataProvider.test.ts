import { describe, expect, it } from 'vitest';
import { CURRENT_FISCAL_QUARTER, SNAPSHOT_DATE } from '../constants';
import {
  categoryStageMismatches,
  coverageState,
  currentWeekMeetings,
  daysLeftInQuarter,
  openOpportunities,
  openPipeline,
  phaseForQuarter,
  filterByPhase,
  remainingQuota,
  weightedForecast,
  weeklyForecastRows,
} from '../../lib/metrics';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import { isPageQueryError, MAX_PAGE_LIMIT } from '../pagination';
import type { PageQueryError } from '../pagination';
import { MockDataProvider } from './MockDataProvider';
import { generateDashboardData } from './generate';
import { NO_SESSION_EDITS } from '../sessionEdits';
import {
  unattributedOpportunitiesWarning,
  weeklyHistoryReconstructedWarning,
} from '../queryMetadata';
import {
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTarget,
  makeTeamUser,
} from '../../test/fixtures';
import type { ForecastScope } from '../DataProvider';
import type { Opportunity, PartnerManager } from '../types';

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
    const { data: summary } = await provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
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
    const { data: weighted } = await provider.getWeightedForecast(INTERNAL_DEMO_SCOPE, { quarter });
    expect(weighted).toEqual(weightedForecast(openOpportunities(inQuarter)));
  });

  it('bounds the mismatch sample while sizing both sides in full', async () => {
    const { data: quality } = await provider.getForecastQuality(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      3,
    );
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
    const { data: groups } = await provider.getManagerForecastGroups(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
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
    const { data: weeks } = await provider.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    expect(weeks).toEqual(
      weeklyForecastRows(book.opportunities, quarter, SNAPSHOT_DATE, book.snapshots),
    );
    expect(weeks.length).toBeLessThan(20);
    expect(book.snapshots.length).toBeGreaterThan(1_000);
  });

  it('narrows aggregates and rows to one manager, and leaves history quarter-level', async () => {
    const { data: groups } = await provider.getManagerForecastGroups(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    const managerId = groups[0]!.managerId;

    // totalCount is the scoped total however large the page, so a bounded
    // request is enough to prove the manager scope narrowed the collection.
    const { data: page } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter, partnerManagerId: managerId },
      { limit: 25 },
    );
    const { data: allRows } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 25 },
    );
    expect(page.totalCount).toBeLessThan(allRows.totalCount);

    const managerByPartner = new Map(
      book.partners.map((partner) => [partner.id, partner.partnerManagerId]),
    );
    const owned = inQuarter.filter((opp) => managerByPartner.get(opp.partnerId) === managerId);
    const { data: scoped } = await provider.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: managerId,
    });
    expect(scoped.openCount).toBe(openPipeline(owned).count);
    expect(scoped.openPipelineValue).toBe(openPipeline(owned).value);

    expect(
      (
        await provider.getManagerForecastGroups(INTERNAL_DEMO_SCOPE, {
          quarter,
          partnerManagerId: managerId,
        })
      ).data,
    ).toEqual(groups.filter((group) => group.managerId === managerId));

    // The documented exception, pinned here so nobody "fixes" it by filtering
    // the live weeks: a snapshot row does not record whose book a deal was in,
    // so a manager-filtered series would drop the recorded weeks' history and
    // draw a cliff that never happened.
    expect(
      (
        await provider.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
          quarter,
          partnerManagerId: managerId,
        })
      ).data,
    ).toEqual((await provider.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, { quarter })).data);
  });

  it('walks a paged book exactly once, in a stable order', async () => {
    const ids = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    let expectedTotal = -1;

    do {
      const { data: page } = await provider.listQuarterOpportunities(
        INTERNAL_DEMO_SCOPE,
        { quarter },
        { ...(cursor ? { cursor } : {}), limit: 7 },
      );
      if (expectedTotal === -1) expectedTotal = page.totalCount;
      expect(page.totalCount).toBe(expectedTotal);
      expect(page.rows.length).toBeLessThanOrEqual(7);
      for (const row of page.rows) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
      }
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(50);
    } while (cursor !== undefined);

    // Exhaustive against the book itself, not merely self-consistent.
    expect(ids.size).toBe(expectedTotal);
    expect(ids.size).toBe(inQuarter.length);
    // Sorted by expected close, so the same page means the same thing twice.
    const { data: once } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 7 },
    );
    const { data: again } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 7 },
    );
    expect(once.rows.map((row) => row.id)).toEqual(again.rows.map((row) => row.id));
  });

  it('exposes the partner directory rather than the partner collection', async () => {
    const { data: directory } = await provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE);
    expect(directory).toEqual(
      book.partners.map((partner) => ({ id: partner.id, name: partner.name })),
    );
  });
});

describe('cursor pagination contract (VAL-DATA-009)', () => {
  const partnerScope: DemoAccessScope = {
    audience: 'partner',
    partnerId: book.partners[0]!.id,
  };

  /** Walks a scope to exhaustion with the given page size; fails on any repeat. */
  async function walk(access: DemoAccessScope, scope: ForecastScope, limit: number) {
    const ids = new Set<string>();
    let cursor: string | undefined;
    let totalCount = -1;
    let pages = 0;
    do {
      const { data: page } = await provider.listQuarterOpportunities(access, scope, {
        ...(cursor ? { cursor } : {}),
        limit,
      });
      if (totalCount === -1) totalCount = page.totalCount;
      expect(page.totalCount).toBe(totalCount);
      expect(page.rows.length).toBeLessThanOrEqual(limit);
      for (const row of page.rows) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
      }
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(200);
    } while (cursor !== undefined);
    return { ids, totalCount };
  }

  it('walks internal, manager, and partner scopes exhaustively with no duplicates', async () => {
    const org = await walk(INTERNAL_DEMO_SCOPE, { quarter }, 7);
    expect(org.ids.size).toBe(inQuarter.length);

    const { data: groups } = await provider.getManagerForecastGroups(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    const managerId = groups.find((group) => group.opportunityCount > 0)!.managerId;
    const managerByPartner = new Map(
      book.partners.map((partner) => [partner.id, partner.partnerManagerId]),
    );
    const manager = await walk(INTERNAL_DEMO_SCOPE, { quarter, partnerManagerId: managerId }, 9);
    expect(manager.ids.size).toBe(
      inQuarter.filter((opp) => managerByPartner.get(opp.partnerId) === managerId).length,
    );
    // The manager's walk is a strict subset of the org's: no row appears
    // that the wider scope would not have served.
    for (const id of manager.ids) expect(org.ids.has(id)).toBe(true);

    const partner = await walk(partnerScope, { quarter }, 5);
    const expectedPartnerRows = inQuarter.filter(
      (opp) => opp.partnerId === book.partners[0]!.id && opp.oppType !== 'sell-to',
    );
    expect(partner.ids.size).toBe(expectedPartnerRows.length);
    for (const id of partner.ids) expect(org.ids.has(id)).toBe(true);
  });

  it('serves at most 25 rows when the request names no limit', async () => {
    const { data: page } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      {},
    );
    expect(page.rows.length).toBeLessThanOrEqual(25);
    expect(page.rows.length).toBe(Math.min(25, inQuarter.length));
  });

  it.each([0, -1, 1.5, Number.NaN, MAX_PAGE_LIMIT + 1, 5_000])(
    'rejects the invalid or over-limit size %s with a typed error, not a clamp',
    async (limit) => {
      const error = await provider
        .listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { limit })
        .catch((caught: unknown) => caught);
      expect(isPageQueryError(error)).toBe(true);
      expect((error as PageQueryError).code).toBe('invalid-page-limit');
    },
  );

  it('rejects tokens it never issued, including the retired offset format', async () => {
    const tokens = ['garbage', 'offset:2', btoa('{"o":2}'), btoa(JSON.stringify({ v: 9 }))];
    for (const cursor of tokens) {
      const error = await provider
        .listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { cursor, limit: 7 })
        .catch((caught: unknown) => caught);
      expect(isPageQueryError(error), cursor).toBe(true);
      expect((error as PageQueryError).code, cursor).toBe('invalid-cursor');
    }
  });

  it('rejects a cursor minted for another query rather than serving page one', async () => {
    const { data: first } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 7 },
    );
    const cursor = first.nextCursor;
    if (cursor === undefined) throw new Error('expected a continuation');

    const foreignQueries: Array<[DemoAccessScope, ForecastScope]> = [
      // another manager
      [INTERNAL_DEMO_SCOPE, { quarter, partnerManagerId: book.partnerManagers[0]!.id }],
      // another quarter
      [INTERNAL_DEMO_SCOPE, { quarter: 'FY27-Q4' }],
      // another audience
      [partnerScope, { quarter }],
    ];
    for (const [access, scope] of foreignQueries) {
      const error = await provider
        .listQuarterOpportunities(access, scope, { cursor, limit: 7 })
        .catch((caught: unknown) => caught);
      expect(isPageQueryError(error)).toBe(true);
      expect((error as PageQueryError).code).toBe('foreign-cursor');
    }
  });

  it('expires cursors when the data epoch moves on', async () => {
    /** A provider whose book advanced: same rows, newer epoch. */
    class EpochProvider extends MockDataProvider {
      constructor(private readonly epoch: string) {
        super(book);
      }
      protected override dataEpoch(): string {
        return this.epoch;
      }
    }
    const before = new EpochProvider('2026-09-11T00:00:00.000Z');
    const after = new EpochProvider('2026-09-18T00:00:00.000Z');

    const { data: first } = await before.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 7 },
    );
    if (first.nextCursor === undefined) throw new Error('expected a continuation');

    // Same provider instance, same query, but the data has moved on: the
    // cursor's position means nothing anymore.
    const error = await after
      .listQuarterOpportunities(
        INTERNAL_DEMO_SCOPE,
        { quarter },
        {
          cursor: first.nextCursor,
          limit: 7,
        },
      )
      .catch((caught: unknown) => caught);
    expect(isPageQueryError(error)).toBe(true);
    expect((error as PageQueryError).code).toBe('expired-cursor');
  });

  it('keeps typed page errors free of row data', async () => {
    const error = await provider
      .listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { limit: 0 })
      .catch((caught: unknown) => caught);
    const serialized = JSON.stringify({
      name: (error as Error).name,
      code: (error as PageQueryError).code,
      message: (error as Error).message,
    });
    expect(serialized).not.toContain('takenAt');
    expect(serialized).not.toContain(inQuarter[0]!.id);
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

    const { data: org } = await scopedProvider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    expect(org.target).toBe(400_000); // partner-1 100k + partner-2 300k
    expect(org.closedWon).toBe(190_000);
    expect(org.remainingQuota).toBe(210_000);
    expect(org.attainment).toBeCloseTo(0.475, 10);
    expect(org.coverage).toEqual({ kind: 'coverage', value: 1 }); // 210k open / 210k gap
  });

  it('measures each manager only against their own partners’ targets', async () => {
    const { data: pm1 } = await scopedProvider.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: 'pm-1',
    });
    expect(pm1.target).toBe(100_000); // partner-1 only; partner-2's 300k stays out
    expect(pm1.closedWon).toBe(40_000);
    expect(pm1.remainingQuota).toBe(60_000);
    expect(pm1.attainment).toBeCloseTo(0.4, 10);
    expect(pm1.coverage).toEqual({ kind: 'coverage', value: 2 }); // 120k open / 60k gap

    const { data: pm2 } = await scopedProvider.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: 'pm-2',
    });
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

    const { data: before } = await scopedProvider.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: 'pm-1',
    });
    // partner-2's target doubled, but pm-1's summary cannot tell.
    expect(
      (await changed.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter, partnerManagerId: 'pm-1' }))
        .data,
    ).toEqual(before);

    const { data: pm2 } = await changed.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: 'pm-2',
    });
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
    const { data: pm1 } = await noTarget.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: 'pm-1',
    });
    expect(pm1.target).toBe(0);
    expect(pm1.remainingQuota).toBe(0);
    expect(pm1.attainment).toBe(0);
    expect(pm1.coverage).toEqual({ kind: 'no-target' });
    // The org still sees partner-2's target — the state is scoped, not global.
    const { data: org } = await noTarget.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    expect(org.target).toBe(300_000);

    const met = new MockDataProvider({
      ...scopedBook,
      targets: scopedBook.targets.map((item) =>
        item.partnerId === 'partner-1' ? { ...item, revenueTarget: 30_000 } : item,
      ),
    });
    const { data: pm1Met } = await met.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: 'pm-1',
    });
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
    const { data: before } = await provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    const raise = 40_000;
    const { data: after } = await provider.getForecastSummary(INTERNAL_DEMO_SCOPE, {
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
    const { data: before } = await provider.getWeightedForecast(INTERNAL_DEMO_SCOPE, { quarter });
    const { data: after } = await provider.getWeightedForecast(INTERNAL_DEMO_SCOPE, {
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

    // Walk bounded pages until the row turns up; there is no "fetch the
    // whole book" page size to reach for.
    const edits = { ...NO_SESSION_EDITS, nextSteps: { [seeded.id]: '' } };
    let row: Opportunity | undefined;
    let cursor: string | undefined;
    do {
      const { data: page } = await provider.listQuarterOpportunities(
        INTERNAL_DEMO_SCOPE,
        { quarter, edits },
        { ...(cursor ? { cursor } : {}), limit: MAX_PAGE_LIMIT },
      );
      row = page.rows.find((candidate) => candidate.id === seeded.id) ?? row;
      cursor = page.nextCursor;
    } while (cursor !== undefined && row === undefined);
    // Presence is the edit; '' is the tombstone. A `??` fallback anywhere in
    // this path would restore the CRM's value and the clear would look broken.
    expect(row?.nextStep).toBe('');
  });
});

describe('scoped answer metadata (VAL-DATA-006)', () => {
  const AS_OF = '2026-09-18T00:00:00.000Z';

  it('every scoped method reports the provider, the snapshot as-of, and its lineage', async () => {
    const answers = await Promise.all([
      provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }),
      provider.getWeightedForecast(INTERNAL_DEMO_SCOPE, { quarter }),
      provider.getForecastQuality(INTERNAL_DEMO_SCOPE, { quarter }, 10),
      provider.getManagerForecastGroups(INTERNAL_DEMO_SCOPE, { quarter }),
      provider.listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { limit: 25 }),
      provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE),
      provider.getPerformanceSummary(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
      provider.getRegistrationFunnel(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
      provider.getStageBreakdown(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
      provider.getTypeBreakdown(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
      provider.getQuarterlyRevenueTrend(INTERNAL_DEMO_SCOPE, {}),
      provider.getWeeklyActivitySeries(INTERNAL_DEMO_SCOPE, {}),
      provider.getWeeklyGoalProgress(INTERNAL_DEMO_SCOPE, {}),
      provider.getRegistrationOpsSummary(INTERNAL_DEMO_SCOPE, {}),
      provider.getPartnerLeaderboard(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
      provider.getManagerDirectory(INTERNAL_DEMO_SCOPE),
      provider.getPartnerRoster(INTERNAL_DEMO_SCOPE, {}),
      provider.getPartnerCertification(INTERNAL_DEMO_SCOPE, {}),
      provider.listScopedOpportunities(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, { limit: 25 }),
      provider.listPendingRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 25 }),
      provider.listUnconvertedRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 25 }),
      provider.listDuplicateRegistrationGroups(INTERNAL_DEMO_SCOPE, {}, { limit: 25 }),
      provider.listWeeklyClassificationMeetings(
        INTERNAL_DEMO_SCOPE,
        { partnerManagerId: book.partnerManagers[0]!.id },
        { limit: 25 },
      ),
    ]);

    for (const { meta } of answers) {
      expect(meta.providerId).toBe('local');
      expect(meta.asOf).toBe(AS_OF);
      expect(meta.completeness).toBe('complete');
      expect(meta.warnings).toEqual([]);
      expect(meta.lineage.map((entry) => entry.source)).toEqual(['mock-book']);
    }
  });

  it('declares session edits in the lineage once any edit exists', async () => {
    const { meta } = await provider.getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter,
      edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-x': 1 } },
    });
    expect(meta.lineage.map((entry) => entry.source)).toEqual(['mock-book', 'session-edits']);
  });

  it('the weekly series warns for exactly the weeks it reconstructed', async () => {
    const { meta } = await provider.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, { quarter });

    // The seeded book records the weeks it has recorded; the fixture book
    // used elsewhere records none at all. Both answers name their basis.
    expect(meta.lineage.some((entry) => entry.source === 'weekly-snapshots')).toBe(true);
    expect(meta.completeness).toBe('complete');
    expect(meta.warnings).toEqual([]);

    const fixtureProvider = new MockDataProvider(makeProviderBook());
    const { data: fixtureWeeks, meta: fixtureMeta } = await fixtureProvider.getWeeklyForecastSeries(
      INTERNAL_DEMO_SCOPE,
      { quarter },
    );
    expect(fixtureWeeks.length).toBeGreaterThan(0);
    expect(fixtureMeta.completeness).toBe('partial');
    // Every closed week is reconstructed: the fixture book records no
    // snapshots at all. Open weeks are not part of the warning — a week that
    // has not closed is live data, not reconstructed history.
    const closed = fixtureWeeks.filter(
      (week) => week.hasStarted && Date.parse(week.weekEnd) <= SNAPSHOT_DATE.getTime(),
    );
    expect(closed.length).toBeGreaterThan(0);
    expect(fixtureMeta.warnings).toEqual([
      weeklyHistoryReconstructedWarning(closed.length, closed.length),
    ]);
  });

  it('names unattributed in-quarter opportunities as a partial manager grouping', async () => {
    const unattributedBook = makeProviderBook({
      partnerManagers: [] as PartnerManager[],
      partners: [],
      opportunities: [makeOpportunity({ id: 'opp-orphan', partnerId: 'partner-absent' })],
    });
    const unattributedProvider = new MockDataProvider(unattributedBook);
    const { data: groups, meta } = await unattributedProvider.getManagerForecastGroups(
      INTERNAL_DEMO_SCOPE,
      {
        quarter,
      },
    );

    expect(groups).toEqual([]);
    expect(meta.completeness).toBe('partial');
    expect(meta.warnings).toEqual([unattributedOpportunitiesWarning(1)]);
    // The org-wide summary loses nothing: the warning is scoped to the
    // grouping that actually dropped the rows.
    const { meta: summaryMeta } = await unattributedProvider.getForecastSummary(
      INTERNAL_DEMO_SCOPE,
      { quarter },
    );
    expect(summaryMeta.completeness).toBe('complete');
  });

  it('lets implementations stamp their own identity on the answers they serve', async () => {
    const tagged = new MockDataProvider(book, { providerId: 'remote' });
    const { meta } = await tagged.getPartnerDirectory(INTERNAL_DEMO_SCOPE);
    expect(meta.providerId).toBe('remote');
  });
});

describe('listWeeklyClassificationMeetings (VAL-DATA-015)', () => {
  const managerId = book.partnerManagers[0]!.id;

  it('answers the manager’s current-week calendar the metrics layer computes', async () => {
    const { data: page } = await provider.listWeeklyClassificationMeetings(
      INTERNAL_DEMO_SCOPE,
      { partnerManagerId: managerId },
      { limit: MAX_PAGE_LIMIT },
    );
    const expected = currentWeekMeetings(book.activities, managerId);
    // The fixture has to contain a real week, or this test proves nothing.
    expect(expected.length).toBeGreaterThan(0);
    expect(page.rows).toEqual(expected);
    expect(page.totalCount).toBe(expected.length);
    expect(page.nextCursor).toBeUndefined();
  });

  it('pages the week by cursor, oldest first, with no duplicates or gaps', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const { data: page } = await provider.listWeeklyClassificationMeetings(
        INTERNAL_DEMO_SCOPE,
        { partnerManagerId: managerId },
        { ...(cursor !== undefined ? { cursor } : {}), limit: 3 },
      );
      seen.push(...page.rows.map((row) => row.id));
      cursor = page.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(50);
    } while (cursor !== undefined);

    const expected = currentWeekMeetings(book.activities, managerId);
    expect(seen).toEqual(expected.map((row) => row.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('keeps another manager’s week out of the answer', async () => {
    const otherManager = book.partnerManagers[1]!;
    const { data: page } = await provider.listWeeklyClassificationMeetings(
      INTERNAL_DEMO_SCOPE,
      { partnerManagerId: otherManager.id },
      { limit: MAX_PAGE_LIMIT },
    );
    expect(page.rows.every((row) => row.partnerManagerId === otherManager.id)).toBe(true);
    expect(page.rows.map((row) => row.id)).not.toContain(
      currentWeekMeetings(book.activities, managerId)[0]?.id,
    );
  });

  it('scopes a partner audience to its own meetings before the week filter', async () => {
    const partner = book.partners.find((candidate) =>
      currentWeekMeetings(book.activities, candidate.partnerManagerId).some(
        (row) => row.partnerId === candidate.id,
      ),
    );
    if (!partner) throw new Error('fixture has no partner with a current-week meeting');
    const audience: DemoAccessScope = { audience: 'partner', partnerId: partner.id };
    const { data: page } = await provider.listWeeklyClassificationMeetings(
      audience,
      { partnerManagerId: partner.partnerManagerId },
      { limit: MAX_PAGE_LIMIT },
    );
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.rows.every((row) => row.partnerId === partner.id)).toBe(true);
  });
});

describe('cancellation', () => {
  it('rejects every method with an abort error when the signal is already spent', async () => {
    const controller = new AbortController();
    controller.abort();
    const context = { signal: controller.signal };
    const local = new MockDataProvider(makeProviderBook());

    const attempts: Promise<unknown>[] = [
      local.listPartnerManagers(INTERNAL_DEMO_SCOPE, context),
      local.listPartners(INTERNAL_DEMO_SCOPE, context),
      local.listRegistrations(INTERNAL_DEMO_SCOPE, context),
      local.listOpportunities(INTERNAL_DEMO_SCOPE, context),
      local.getTargets(INTERNAL_DEMO_SCOPE, context),
      local.listActivities(INTERNAL_DEMO_SCOPE, context),
      local.listCertifications(INTERNAL_DEMO_SCOPE, context),
      local.listTeamUsers(INTERNAL_DEMO_SCOPE, context),
      local.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }, context),
      local.getWeightedForecast(INTERNAL_DEMO_SCOPE, { quarter }, context),
      local.getForecastQuality(INTERNAL_DEMO_SCOPE, { quarter }, 3, context),
      local.getManagerForecastGroups(INTERNAL_DEMO_SCOPE, { quarter }, context),
      local.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, { quarter }, context),
      local.listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { limit: 5 }, context),
      local.getPartnerDirectory(INTERNAL_DEMO_SCOPE, context),
      local.getPerformanceSummary(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, context),
      local.getRegistrationFunnel(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, context),
      local.getStageBreakdown(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, context),
      local.getTypeBreakdown(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, context),
      local.getQuarterlyRevenueTrend(INTERNAL_DEMO_SCOPE, {}, context),
      local.getWeeklyActivitySeries(INTERNAL_DEMO_SCOPE, {}, context),
      local.getWeeklyGoalProgress(INTERNAL_DEMO_SCOPE, {}, context),
      local.getRegistrationOpsSummary(INTERNAL_DEMO_SCOPE, {}, context),
      local.getPartnerLeaderboard(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, context),
      local.getManagerDirectory(INTERNAL_DEMO_SCOPE, context),
      local.getPartnerRoster(INTERNAL_DEMO_SCOPE, {}, context),
      local.getPartnerCertification(INTERNAL_DEMO_SCOPE, {}, context),
      local.listScopedOpportunities(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, { limit: 5 }, context),
      local.listPendingRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 5 }, context),
      local.listUnconvertedRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 5 }, context),
      local.listDuplicateRegistrationGroups(INTERNAL_DEMO_SCOPE, {}, { limit: 5 }, context),
      local.listWeeklyClassificationMeetings(
        INTERNAL_DEMO_SCOPE,
        { partnerManagerId: 'pm-1' },
        { limit: 5 },
        context,
      ),
    ];
    for (const attempt of attempts) {
      const rejected = await attempt.catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).name).toBe('AbortError');
    }
  });

  it('answers normally while the signal is live', async () => {
    const controller = new AbortController();
    const local = new MockDataProvider(makeProviderBook());
    const { data } = await local.getForecastSummary(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { signal: controller.signal },
    );
    expect(data.openCount).toBeGreaterThan(0);
  });
});

describe('demo access scope isolation (VAL-DATA-003)', () => {
  /**
   * Two partners, one manager each. partner-1 has an open sell-with deal, a
   * Sell To deal (partner-1 is the customer there), and a conflicting
   * registration (partner-2 registered the same account). partner-2 has its
   * own open deal. Every assertion below says the same thing: a
   * partner-audience answer is computed from partner-1's visible rows alone.
   */
  const scopedBook = makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', partnerManagerId: 'pm-2', name: 'Contoso Partners' }),
    ],
    opportunities: [
      makeOpportunity({
        id: 'opp-open',
        partnerId: 'partner-1',
        forecastedRevenue: 100_000,
        createdAt: '2026-08-03T00:00:00Z',
        expectedCloseDate: '2026-10-15T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-sell-to',
        partnerId: 'partner-1',
        accountName: 'Northwind Systems',
        oppType: 'sell-to',
        forecastedRevenue: 50_000,
        createdAt: '2026-08-03T00:00:00Z',
        expectedCloseDate: '2026-10-15T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-other',
        partnerId: 'partner-2',
        accountName: 'Contoso Only Deal',
        forecastedRevenue: 999_000,
        createdAt: '2026-08-03T00:00:00Z',
        expectedCloseDate: '2026-10-15T00:00:00Z',
      }),
    ],
    registrations: [
      makeRegistration({
        id: 'reg-conflict',
        partnerId: 'partner-1',
        accountName: 'Shared Account',
      }),
      makeRegistration({
        id: 'reg-other-side',
        partnerId: 'partner-2',
        accountName: 'Shared Account',
      }),
      makeRegistration({ id: 'reg-clean', partnerId: 'partner-1', accountName: 'Clean Account' }),
      makeRegistration({
        id: 'reg-other',
        partnerId: 'partner-2',
        accountName: 'Contoso Only Deal',
      }),
    ],
    targets: [
      makeTarget({ partnerId: 'partner-1', quarter, revenueTarget: 100_000 }),
      makeTarget({ partnerId: 'partner-2', quarter, revenueTarget: 300_000 }),
    ],
    activities: [],
    certifications: [
      {
        partnerId: 'partner-1',
        partnerStrategistsCertified: 1,
        partnerStrategistsGoal: 2,
        partnerEngineersCertified: 0,
        partnerEngineersGoal: 1,
      },
    ],
    teamUsers: [makeTeamUser()],
  });
  const scopedProvider = new MockDataProvider(scopedBook);
  const partnerScope = { audience: 'partner', partnerId: 'partner-1' } as const;

  it('scopes every legacy collection before it crosses the seam', async () => {
    expect((await scopedProvider.listPartners(partnerScope)).map((p) => p.id)).toEqual([
      'partner-1',
    ]);
    expect((await scopedProvider.listOpportunities(partnerScope)).map((o) => o.id)).toEqual([
      'opp-open',
    ]);
    // The conflict drops on BOTH sides of it; the clean registration stays.
    expect((await scopedProvider.listRegistrations(partnerScope)).map((r) => r.id)).toEqual([
      'reg-clean',
    ]);
    expect((await scopedProvider.getTargets(partnerScope)).map((t) => t.partnerId)).toEqual([
      'partner-1',
    ]);
    expect((await scopedProvider.listCertifications(partnerScope)).map((c) => c.partnerId)).toEqual(
      ['partner-1'],
    );
    // The internal directories: empty for a partner audience.
    expect(await scopedProvider.listPartnerManagers(partnerScope)).toEqual([]);
    expect(await scopedProvider.listTeamUsers(partnerScope)).toEqual([]);
  });

  it('computes the summary from the scoped rows, before aggregation', async () => {
    const { data: scoped } = await scopedProvider.getForecastSummary(partnerScope, { quarter });
    // 100k open over a 100k target; the 999k other-partner deal and the 50k
    // Sell To deal cannot move a single figure.
    expect(scoped.openPipelineValue).toBe(100_000);
    expect(scoped.openCount).toBe(1);
    expect(scoped.target).toBe(100_000);

    const { data: org } = await scopedProvider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    expect(org.openPipelineValue).toBe(1_149_000);
    expect(org.target).toBe(400_000);
  });

  it('paginates only scoped rows: the page total is the scoped count', async () => {
    const { data: page } = await scopedProvider.listQuarterOpportunities(
      partnerScope,
      { quarter },
      { limit: 25 },
    );
    expect(page.totalCount).toBe(1);
    expect(page.rows.map((row) => row.id)).toEqual(['opp-open']);
    expect(page.nextCursor).toBeUndefined();
  });

  it('returns a one-entry directory and no manager groups for a partner audience', async () => {
    const { data: directory } = await scopedProvider.getPartnerDirectory(partnerScope);
    expect(directory).toEqual([{ id: 'partner-1', name: 'Northwind Systems' }]);
    const { data: groups } = await scopedProvider.getManagerForecastGroups(partnerScope, {
      quarter,
    });
    expect(groups).toEqual([]);
  });

  it('scopes the weekly series to the partner’s own opportunity history', async () => {
    const withHistory = new MockDataProvider({
      ...scopedBook,
      snapshots: [
        {
          takenAt: '2026-09-07T00:00:00.000Z',
          opportunityId: 'opp-open',
          forecastedRevenue: 80_000,
          forecastCategory: 'pipeline',
          stage: 'scope',
          expectedCloseDate: '2026-10-15T00:00:00Z',
        },
        {
          takenAt: '2026-09-07T00:00:00.000Z',
          opportunityId: 'opp-other',
          forecastedRevenue: 999_000,
          forecastCategory: 'commit',
          stage: 'deal-desk-review',
          expectedCloseDate: '2026-10-15T00:00:00Z',
        },
      ],
    });
    const { data: scopedWeeks } = await withHistory.getWeeklyForecastSeries(partnerScope, {
      quarter,
    });
    const { data: orgWeeks } = await withHistory.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    // The recorded week carries only partner-1's 80k, never the other
    // partner's 999k; the org view carries both.
    const scopedRecorded = scopedWeeks.find((week) => week.recordedAt !== undefined);
    const orgRecorded = orgWeeks.find((week) => week.recordedAt !== undefined);
    expect(scopedRecorded?.total).toBe(80_000);
    expect(orgRecorded?.total).toBe(1_079_000);
  });

  it('answers an unknown partner with empty collections, never the book', async () => {
    const nobody = { audience: 'partner', partnerId: 'partner-absent' } as const;
    expect(await scopedProvider.listPartners(nobody)).toEqual([]);
    expect(await scopedProvider.listOpportunities(nobody)).toEqual([]);
    const { data: summary } = await scopedProvider.getForecastSummary(nobody, { quarter });
    expect(summary.openPipelineValue).toBe(0);
    expect(summary.openCount).toBe(0);
    const { data: directory } = await scopedProvider.getPartnerDirectory(nobody);
    expect(directory).toEqual([]);
  });

  it('no partner-audience answer carries another partner’s identifiers anywhere inside it', async () => {
    const answers = await Promise.all([
      scopedProvider.listPartners(partnerScope),
      scopedProvider.listOpportunities(partnerScope),
      scopedProvider.listRegistrations(partnerScope),
      scopedProvider.getTargets(partnerScope),
      scopedProvider.listActivities(partnerScope),
      scopedProvider.listCertifications(partnerScope),
      scopedProvider.getForecastSummary(partnerScope, { quarter }),
      scopedProvider.getWeightedForecast(partnerScope, { quarter }),
      scopedProvider.getForecastQuality(partnerScope, { quarter }, 3),
      scopedProvider.getManagerForecastGroups(partnerScope, { quarter }),
      scopedProvider.listQuarterOpportunities(partnerScope, { quarter }, { limit: 25 }),
      scopedProvider.getPartnerDirectory(partnerScope),
      scopedProvider.getPerformanceSummary(partnerScope, { phase: 'q3' }),
      scopedProvider.getRegistrationFunnel(partnerScope, { phase: 'q3' }),
      scopedProvider.getStageBreakdown(partnerScope, { phase: 'q3' }),
      scopedProvider.getTypeBreakdown(partnerScope, { phase: 'q3' }),
      scopedProvider.getQuarterlyRevenueTrend(partnerScope, {}),
      scopedProvider.getWeeklyActivitySeries(partnerScope, {}),
      scopedProvider.getWeeklyGoalProgress(partnerScope, {}),
      scopedProvider.getRegistrationOpsSummary(partnerScope, {}),
      scopedProvider.getPartnerLeaderboard(partnerScope, { phase: 'q3' }),
      scopedProvider.getManagerDirectory(partnerScope),
      scopedProvider.getPartnerRoster(partnerScope, {}),
      scopedProvider.getPartnerCertification(partnerScope, { partnerId: 'partner-1' }),
      scopedProvider.listScopedOpportunities(partnerScope, { phase: 'q3' }, { limit: 25 }),
      scopedProvider.listPendingRegistrations(partnerScope, {}, { limit: 25 }),
      scopedProvider.listUnconvertedRegistrations(partnerScope, {}, { limit: 25 }),
      scopedProvider.listDuplicateRegistrationGroups(partnerScope, {}, { limit: 25 }),
      scopedProvider.listWeeklyClassificationMeetings(
        partnerScope,
        { partnerManagerId: 'pm-1' },
        { limit: 25 },
      ),
    ]);
    // A serialization scan: partner-2's id, name, and exclusive account name
    // must appear nowhere in any answer, nested or not.
    const serialized = JSON.stringify(answers);
    expect(serialized).not.toContain('partner-2');
    expect(serialized).not.toContain('Contoso');
    expect(serialized).not.toContain('opp-other');
    expect(serialized).not.toContain('opp-sell-to');
    expect(serialized).not.toContain('reg-conflict');
    expect(serialized).not.toContain('reg-other-side');
  });
});
