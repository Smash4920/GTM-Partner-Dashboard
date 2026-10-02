import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTION_POLICY } from '../../lib/actionRules';
import {
  avgOpenDealSize,
  closedWonForPhase,
  coverageState,
  filterByPhase,
  openPipeline,
  phaseForQuarter,
  remainingQuota,
  targetsForPhase,
} from '../../lib/metrics';
import { makeOpportunity, makeProviderBook, makeTarget } from '../../test/fixtures';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import { CURRENT_FISCAL_QUARTER, FISCAL_PHASES, SNAPSHOT_DATE } from '../constants';
import type { ForecastSummary, Page, PageRequest } from '../DataProvider';
import type { QueryResult } from '../queryMetadata';
import { NO_SESSION_EDITS } from '../sessionEdits';
import { generateDashboardData } from './generate';
import { MockDataProvider } from './MockDataProvider';

const quarter = CURRENT_FISCAL_QUARTER;
const phase = phaseForQuarter(quarter);
const book = generateDashboardData();
const provider = new MockDataProvider(book);

function sharedFields(summary: ForecastSummary | Omit<ForecastSummary, 'daysLeftInQuarter'>) {
  return {
    openPipelineValue: summary.openPipelineValue,
    openCount: summary.openCount,
    closedWon: summary.closedWon,
    target: summary.target,
    attainment: summary.attainment,
    coverage: summary.coverage,
    remainingQuota: summary.remainingQuota,
    avgOpenDealSize: summary.avgOpenDealSize,
  };
}

describe('shared provider answer characterization', () => {
  it.each(FISCAL_PHASES)('preserves exact scalar summary parity for %s', async (selectedPhase) => {
    const rows = filterByPhase(book.opportunities, selectedPhase);
    const open = openPipeline(rows);
    const closedWon = closedWonForPhase(rows, selectedPhase);
    const target = targetsForPhase(book.targets, selectedPhase).reduce(
      (sum, item) => sum + item.revenueTarget,
      0,
    );
    const summary = await provider.getPerformanceSummary(INTERNAL_DEMO_SCOPE, {
      phase: selectedPhase,
    });
    expect(sharedFields(summary.data)).toEqual({
      openPipelineValue: open.value,
      openCount: open.count,
      closedWon,
      target,
      attainment: target > 0 ? closedWon / target : 0,
      coverage: coverageState(rows, book.targets, selectedPhase),
      remainingQuota: remainingQuota(rows, book.targets, selectedPhase),
      avgOpenDealSize: avgOpenDealSize(rows),
    });
  });

  const partner = book.partners[0]!;
  const cases: Array<[string, DemoAccessScope, string | undefined]> = [
    ['organization', INTERNAL_DEMO_SCOPE, undefined],
    ['manager selection', INTERNAL_DEMO_SCOPE, partner.partnerManagerId],
    [
      'manager access',
      { audience: 'internal', partnerManagerId: partner.partnerManagerId },
      undefined,
    ],
    ['partner access', { audience: 'partner', partnerId: partner.id }, undefined],
    ['unknown manager', INTERNAL_DEMO_SCOPE, 'missing-manager'],
  ];

  it.each(cases)(
    'matches all eight summary fields for %s with edits',
    async (_, access, partnerManagerId) => {
      const opportunity = book.opportunities[0]!;
      const edits = {
        ...NO_SESSION_EDITS,
        revenueOverrides: { [opportunity.id]: 123_456 },
        notes: { [opportunity.id]: 'Session note' },
      };
      const forecast = await provider.getForecastSummary(access, {
        quarter,
        partnerManagerId,
        edits,
      });
      const performance = await provider.getPerformanceSummary(access, {
        phase,
        partnerManagerId,
        edits,
      });
      expect(sharedFields(performance.data)).toEqual(sharedFields(forecast.data));
      expect(performance.meta).toEqual(forecast.meta);
    },
  );

  it.each([
    ['missing', undefined, 0, { kind: 'no-target' }],
    ['zero', 0, 0, { kind: 'no-target' }],
    ['met', 40_000, 1, { kind: 'target-met' }],
    ['exceeded', 20_000, 2, { kind: 'target-met' }],
    ['unmet', 100_000, 0.4, { kind: 'coverage', value: 2 }],
  ] as const)('pins the %s target summary', async (_, revenueTarget, attainment, coverage) => {
    const local = new MockDataProvider(
      makeProviderBook({
        opportunities: [
          makeOpportunity({ id: 'open', forecastedRevenue: 120_000 }),
          makeOpportunity({
            id: 'won',
            outcome: 'won',
            forecastedRevenue: 40_000,
            closedAt: '2026-08-10T00:00:00.000Z',
          }),
        ],
        targets: revenueTarget === undefined ? [] : [makeTarget({ revenueTarget })],
      }),
    );
    const forecast = await local.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
    const performance = await local.getPerformanceSummary(INTERNAL_DEMO_SCOPE, { phase });
    const expected = {
      openPipelineValue: 120_000,
      openCount: 1,
      closedWon: 40_000,
      target: revenueTarget ?? 0,
      attainment,
      coverage,
      remainingQuota: Math.max(0, (revenueTarget ?? 0) - 40_000),
      avgOpenDealSize: 120_000,
    };
    expect(sharedFields(forecast.data)).toEqual(expected);
    expect(sharedFields(performance.data)).toEqual(expected);
  });

  const edits = { ...NO_SESSION_EDITS, revenueOverrides: { [book.opportunities[0]!.id]: 123_456 } };
  const pageQueries: Array<
    [string, (page: PageRequest) => Promise<QueryResult<Page<unknown>>>, boolean]
  > = [
    [
      'actions',
      (page) =>
        provider.listActionItems(
          INTERNAL_DEMO_SCOPE,
          { policy: DEFAULT_ACTION_POLICY, edits },
          page,
        ),
      true,
    ],
    [
      'quarter opportunities',
      (page) => provider.listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter, edits }, page),
      true,
    ],
    [
      'leaderboard',
      (page) => provider.listPartnerLeaderboard(INTERNAL_DEMO_SCOPE, { phase, edits }, page),
      true,
    ],
    [
      'scoped opportunities',
      (page) => provider.listScopedOpportunities(INTERNAL_DEMO_SCOPE, { phase, edits }, page),
      true,
    ],
    [
      'pending registrations',
      (page) => provider.listPendingRegistrations(INTERNAL_DEMO_SCOPE, {}, page),
      false,
    ],
    [
      'unconverted registrations',
      (page) => provider.listUnconvertedRegistrations(INTERNAL_DEMO_SCOPE, {}, page),
      false,
    ],
    [
      'duplicate groups',
      (page) => provider.listDuplicateRegistrationGroups(INTERNAL_DEMO_SCOPE, {}, page),
      false,
    ],
    [
      'recent registrations',
      (page) => provider.listRecentRegistrations(INTERNAL_DEMO_SCOPE, {}, page),
      false,
    ],
    [
      'weekly meetings',
      (page) =>
        provider.listWeeklyClassificationMeetings(
          INTERNAL_DEMO_SCOPE,
          { partnerManagerId: partner.partnerManagerId },
          page,
        ),
      false,
    ],
  ];

  it.each(pageQueries)(
    'preserves the %s envelope through page transitions',
    async (_, query, hasEdits) => {
      const first = await query({ limit: 100 });
      expect(first.data.totalCount).toBeGreaterThan(1);
      expect(first.meta).toMatchObject({
        providerId: 'local',
        asOf: SNAPSHOT_DATE.toISOString(),
        completeness: 'complete',
        warnings: [],
      });
      expect(first.meta.lineage.filter((entry) => entry.source === 'session-edits')).toHaveLength(
        hasEdits ? 1 : 0,
      );
      async function walk(limit: number) {
        const rows: unknown[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
          const answer = await query({ limit, cursor });
          expect(answer.meta).toEqual(first.meta);
          expect(answer.data.totalCount).toBe(first.data.totalCount);
          expect(answer.data.rows).toHaveLength(
            Math.min(limit, first.data.totalCount - rows.length),
          );
          rows.push(...answer.data.rows);
          cursor = answer.data.nextCursor;
          expect(cursor === undefined).toBe(rows.length === first.data.totalCount);
          pages += 1;
          expect(pages).toBeLessThan(500);
        } while (cursor !== undefined);
        return rows;
      }
      expect(await walk(3)).toEqual(await walk(100));
    },
  );
});
