import { afterEach, describe, expect, it, vi } from 'vitest';
import * as metrics from '../../lib/metrics';
import { makeOpportunity, makePartner, makeProviderBook } from '../../test/fixtures';
import {
  INTERNAL_DEMO_SCOPE,
  scopeOpportunities,
  scopePartners,
  scopeTargets,
} from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import type { PerformanceScope } from '../DataProvider';
import * as sessionEdits from '../sessionEdits';
import { NO_SESSION_EDITS } from '../sessionEdits';
import { generateDashboardData } from './generate';
import { MockDataProvider } from './MockDataProvider';

const book = generateDashboardData();
const provider = new MockDataProvider(book);
const partner = book.partners[0]!;
const prospect = makePartner({ id: 'prospect', partnerManagerId: partner.partnerManagerId });
const edits = {
  revenueOverrides: { [book.opportunities[0]!.id]: 0 },
  notes: { [book.opportunities[0]!.id]: '' },
  nextSteps: { [book.opportunities[0]!.id]: '' },
  forecastCalls: { [book.opportunities[0]!.id]: 'commit' as const },
};

afterEach(() => vi.restoreAllMocks());

describe('performance preparation characterization', () => {
  const scopes: Array<[string, DemoAccessScope, Partial<PerformanceScope>]> = [
    ['organization', INTERNAL_DEMO_SCOPE, {}],
    ['roster', INTERNAL_DEMO_SCOPE, { partnerFilter: 'roster' }],
    ['manager selection', INTERNAL_DEMO_SCOPE, { partnerManagerId: partner.partnerManagerId }],
    ['manager access', { audience: 'internal', partnerManagerId: partner.partnerManagerId }, {}],
    ['partner access', { audience: 'partner', partnerId: partner.id }, {}],
    [
      'partner wins selection',
      INTERNAL_DEMO_SCOPE,
      { partnerId: partner.id, partnerManagerId: 'missing-manager' },
    ],
    ['prospect roster', INTERNAL_DEMO_SCOPE, { partnerFilter: 'roster', prospects: [prospect] }],
    ['empty selection', INTERNAL_DEMO_SCOPE, { partnerId: 'missing-partner' }],
  ];

  it.each(scopes)('preserves phase/type answers and metadata for %s', async (_, access, lens) => {
    const roster = scopePartners([...book.partners, ...(lens.prospects ?? [])], access);
    const selected =
      lens.partnerId !== undefined
        ? new Set([lens.partnerId])
        : lens.partnerManagerId !== undefined || lens.partnerFilter === 'roster'
          ? new Set(
              roster
                .filter(
                  (row) =>
                    lens.partnerManagerId === undefined ||
                    row.partnerManagerId === lens.partnerManagerId,
                )
                .map((row) => row.id),
            )
          : undefined;
    const opportunities = scopeOpportunities(book.opportunities, book.partners, access).filter(
      (row) => selected === undefined || selected.has(row.partnerId),
    );
    const targets = scopeTargets(book.targets, book.partners, access).filter(
      (row) => selected === undefined || selected.has(row.partnerId),
    );
    const edited = sessionEdits.applySessionEdits(opportunities, edits);
    for (const phase of ['fy', 'q1', 'q3'] as const) {
      for (const oppType of ['all', 'sell-to', 'sell-with', 'allocate'] as const) {
        const scope = { ...lens, phase, oppType, edits };
        const typed = metrics.filterByType(edited, oppType);
        const phaseOpps = metrics.filterByPhase(typed, phase);
        const summary = await provider.getPerformanceSummary(access, scope);
        const stages = await provider.getStageBreakdown(access, scope);
        const types = await provider.getTypeBreakdown(access, scope);
        const trend = await provider.getQuarterlyRevenueTrend(access, scope);
        const page = await provider.listScopedOpportunities(access, scope, { limit: 100 });
        expect(stages.data).toEqual({
          stages: metrics.stageBreakdown(phaseOpps),
          outcomes: metrics.outcomeTotals(phaseOpps),
        });
        expect(types.data).toEqual(metrics.typeBreakdown(metrics.filterByPhase(edited, phase)));
        expect(trend.data).toEqual(metrics.quarterlyClosedWonAndTarget(typed, targets));
        expect(summary.data.priorClosedWon).toBe(metrics.closedWonPriorYearForPhase(typed, phase));
        const ordered = [...phaseOpps].sort((a, b) =>
          a.expectedCloseDate === b.expectedCloseDate
            ? a.id.localeCompare(b.id)
            : a.expectedCloseDate.localeCompare(b.expectedCloseDate),
        );
        expect(page.data.rows).toEqual(ordered.slice(0, 100));
        expect(page.data.totalCount).toBe(ordered.length);
        for (const answer of [stages, types, trend, page]) {
          expect(answer.meta).toEqual(summary.meta);
        }
      }
    }
  });

  it.each([
    ['summary', ['type', 'phase']],
    ['stages', ['type', 'phase']],
    ['types', ['phase']],
    ['trend', ['type']],
    ['opportunities', ['type', 'phase']],
    ['top leaderboard', ['phase', 'type']],
    ['paged leaderboard', ['phase', 'type']],
  ] as const)(
    'applies edits once before the %s filters in their original order',
    async (name, order) => {
      const trace: string[] = [];
      const apply = vi.spyOn(sessionEdits, 'applySessionEdits');
      const byType = vi.spyOn(metrics, 'filterByType').mockImplementation((...args) => {
        trace.push('type');
        return originalByType(...args);
      });
      const byPhase = vi.spyOn(metrics, 'filterByPhase').mockImplementation((...args) => {
        trace.push('phase');
        return originalByPhase(...args);
      });
      const scope: PerformanceScope = {
        phase: 'q3',
        oppType: 'sell-with',
        oppTypes: ['allocate', 'sell-with'],
        partnerId: partner.id,
        edits,
      };
      const access: DemoAccessScope = { audience: 'partner', partnerId: partner.id };
      switch (name) {
        case 'summary':
          await provider.getPerformanceSummary(access, scope);
          break;
        case 'stages':
          await provider.getStageBreakdown(access, scope);
          break;
        case 'types':
          await provider.getTypeBreakdown(access, scope);
          break;
        case 'trend':
          await provider.getQuarterlyRevenueTrend(access, scope);
          break;
        case 'opportunities':
          await provider.listScopedOpportunities(access, scope, {});
          break;
        case 'top leaderboard':
          await provider.getTopPartnerLeaders(access, scope);
          break;
        case 'paged leaderboard':
          await provider.listPartnerLeaderboard(access, scope, {});
      }
      expect(apply).toHaveBeenCalledExactlyOnceWith(
        scopeOpportunities(book.opportunities, book.partners, access),
        edits,
      );
      expect(trace).toEqual(order);
      const firstFilter = order[0] === 'type' ? byType : byPhase;
      expect(apply.mock.invocationCallOrder[0]).toBeLessThan(
        firstFilter.mock.invocationCallOrder[0]!,
      );
      if (name.includes('leaderboard')) {
        expect(byType.mock.calls[0]![1]).toEqual(scope.oppTypes);
      }
    },
  );
});

const originalByType = metrics.filterByType;
const originalByPhase = metrics.filterByPhase;

describe('opportunity page ordering characterization', () => {
  it('keeps date/ID ordering, stable exact ties, references, and optional absence', async () => {
    const rows = [
      makeOpportunity({ id: 'z', accountName: 'first exact tie' }),
      makeOpportunity({ id: 'a' }),
      makeOpportunity({ id: 'z', accountName: 'second exact tie' }),
      makeOpportunity({ id: 'later', expectedCloseDate: '2026-10-16T00:00:00.000Z' }),
      makeOpportunity({ id: 'early', expectedCloseDate: '2026-10-01T00:00:00.000Z' }),
    ];
    const local = new MockDataProvider(makeProviderBook({ opportunities: rows }));
    const quarter = await local.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter: 'FY27-Q3' },
      { limit: 100 },
    );
    const scoped = await local.listScopedOpportunities(
      INTERNAL_DEMO_SCOPE,
      { phase: 'q3' },
      { limit: 100 },
    );
    const expected = [rows[4], rows[1], rows[0], rows[2], rows[3]];
    expect(quarter.data.rows).toEqual(expected);
    expect(scoped.data.rows).toEqual(expected);
    for (const page of [quarter, scoped]) {
      for (const [index, row] of page.data.rows.entries()) {
        expect(row).toBe(expected[index]);
        expect(row).not.toHaveProperty('notes');
        expect(row).not.toHaveProperty('nextStep');
        expect(row).not.toHaveProperty('forecastCategory');
      }
    }
    expect(rows.map((row) => row.id)).toEqual(['z', 'a', 'z', 'later', 'early']);
    const edited = await local.listScopedOpportunities(
      INTERNAL_DEMO_SCOPE,
      {
        phase: 'q3',
        edits: { ...NO_SESSION_EDITS, revenueOverrides: { a: 0 }, notes: { a: '' } },
      },
      { limit: 100 },
    );
    expect(edited.data.rows[1]).toMatchObject({ id: 'a', forecastedRevenue: 0, notes: '' });
    expect(edited.data.rows[0]).toBe(rows[4]);
  });
});
