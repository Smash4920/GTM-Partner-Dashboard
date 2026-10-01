import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import { usePartnerPerformanceQueries } from './usePartnerPerformanceQueries';
import type { PartnerPerformanceQueryInput } from './usePartnerPerformanceQueries';
import {
  makeCertification,
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTarget,
} from '../test/fixtures';
import type { ProviderBook } from './mock/book';

/**
 * VAL-DATA-014 (Partner Performance): the route requests exactly the scoped
 * aggregates, bounded trend, and cursor-paginated row collections it renders
 * — with the manager/partner drill-down as a provider input — and every
 * query fails and retries independently of its siblings.
 */

/** A provider that records which contract methods were called, in order. */
function spyProvider(inner: DataProvider): { provider: DataProvider; calls: string[] } {
  const calls: string[] = [];
  const watched = new Set<string>(DATA_PROVIDER_METHODS);
  const provider = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || typeof value !== 'function' || !watched.has(property)) {
        return value;
      }
      return (...args: unknown[]) => {
        calls.push(property);
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { provider, calls };
}

function makeBook(): ProviderBook {
  return makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', name: 'Beacon Consulting', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-3', name: 'Cobalt Group', partnerManagerId: 'pm-2' }),
    ],
    opportunities: [
      makeOpportunity({
        id: 'opp-open',
        partnerId: 'partner-1',
        forecastedRevenue: 250_000,
        createdAt: '2026-08-03T00:00:00.000Z',
        expectedCloseDate: '2026-10-15T00:00:00.000Z',
      }),
      makeOpportunity({
        id: 'opp-won',
        partnerId: 'partner-1',
        outcome: 'won',
        forecastedRevenue: 120_000,
        createdAt: '2026-08-01T00:00:00.000Z',
        expectedCloseDate: '2026-09-01T00:00:00.000Z',
        closedAt: '2026-09-01T00:00:00.000Z',
      }),
      makeOpportunity({
        id: 'opp-lost',
        partnerId: 'partner-2',
        outcome: 'lost',
        forecastedRevenue: 60_000,
        createdAt: '2026-08-05T00:00:00.000Z',
        expectedCloseDate: '2026-09-05T00:00:00.000Z',
        closedAt: '2026-09-05T00:00:00.000Z',
      }),
      makeOpportunity({
        id: 'opp-prior-year',
        partnerId: 'partner-1',
        outcome: 'won',
        forecastedRevenue: 100_000,
        createdAt: '2025-08-01T00:00:00.000Z',
        expectedCloseDate: '2025-09-10T00:00:00.000Z',
        closedAt: '2025-09-10T00:00:00.000Z',
      }),
      // An open Q3 deal for the other manager's book.
      makeOpportunity({
        id: 'opp-pm2',
        partnerId: 'partner-3',
        forecastedRevenue: 40_000,
        createdAt: '2026-08-06T00:00:00.000Z',
        expectedCloseDate: '2026-10-20T00:00:00.000Z',
      }),
    ],
    registrations: [
      makeRegistration({
        id: 'reg-pending',
        partnerId: 'partner-1',
        accountName: 'Acme Freight',
        amount: 180_000,
        submittedAt: '2026-09-14T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-lapsed',
        partnerId: 'partner-1',
        accountName: 'Cobalt Health',
        amount: 140_000,
        submittedAt: '2026-06-01T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-06-03T00:00:00.000Z',
      }),
      makeRegistration({
        id: 'reg-conflict',
        partnerId: 'partner-2',
        accountName: 'Cobalt Health',
        amount: 130_000,
        submittedAt: '2026-06-05T00:00:00.000Z',
        status: 'pending',
      }),
    ],
    targets: [makeTarget({ partnerId: 'partner-1', quarter: 'FY27-Q3', revenueTarget: 100_000 })],
    certifications: [
      makeCertification({
        partnerId: 'partner-1',
        partnerStrategistsCertified: 2,
        partnerStrategistsGoal: 4,
        partnerEngineersCertified: 3,
        partnerEngineersGoal: 6,
      }),
    ],
    activities: [],
  });
}

function inputFor(
  provider: DataProvider,
  overrides: Partial<PartnerPerformanceQueryInput> = {},
): PartnerPerformanceQueryInput {
  return {
    provider,
    access: INTERNAL_DEMO_SCOPE,
    phase: 'q3',
    managerId: 'all',
    partnerId: 'all',
    edits: NO_SESSION_EDITS,
    classifications: {},
    prospects: [],
    ...overrides,
  };
}

/** Waits until every Partner Performance query has settled with an answer. */
async function settle(result: { current: ReturnType<typeof usePartnerPerformanceQueries> }) {
  await waitFor(() => {
    expect(result.current.summary.data).not.toBeNull();
    expect(result.current.funnel.data).not.toBeNull();
    expect(result.current.stages.data).not.toBeNull();
    expect(result.current.trend.data).not.toBeNull();
    expect(result.current.activity.data).not.toBeNull();
    expect(result.current.goal.data).not.toBeNull();
    expect(result.current.ops.data).not.toBeNull();
    expect(result.current.leaderboard.data).not.toBeNull();
    expect(result.current.managers.data).not.toBeNull();
    expect(result.current.roster.data).not.toBeNull();
    expect(result.current.opportunities.meta).not.toBeNull();
    expect(result.current.pending.meta).not.toBeNull();
    expect(result.current.unconverted.meta).not.toBeNull();
    expect(result.current.duplicates.meta).not.toBeNull();
  });
}

describe('usePartnerPerformanceQueries (VAL-DATA-014)', () => {
  it('requests exactly its scoped queries — aggregates, directories, and bounded pages', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    expect([...new Set(calls)].sort()).toEqual([
      'getManagerDirectory',
      'getPartnerCertification',
      'getPartnerLeaderboard',
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getWeeklyActivitySeries',
      'getWeeklyGoalProgress',
      'listDuplicateRegistrationGroups',
      'listPendingRegistrations',
      'listScopedOpportunities',
      'listUnconvertedRegistrations',
    ]);
    // Every row collection is one bounded page request.
    for (const pageQuery of [
      'listScopedOpportunities',
      'listPendingRegistrations',
      'listUnconvertedRegistrations',
      'listDuplicateRegistrationGroups',
    ]) {
      expect(calls.filter((method) => method === pageQuery)).toHaveLength(1);
    }
    expect(result.current.opportunities.rows.length).toBeLessThanOrEqual(25);
  });

  it('answers with the same deterministic values the whole-book view computed', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    const summary = result.current.summary.data!;
    // 250k + 40k open in Q3 across the org; 120k won against a 100k target.
    expect(summary.openPipelineValue).toBe(290_000);
    expect(summary.openCount).toBe(2);
    expect(summary.closedWon).toBe(120_000);
    expect(summary.priorClosedWon).toBe(100_000);
    expect(summary.attainment).toBe(1.2);
    expect(summary.alignedPartners).toBe(3);

    // The pipeline page holds every in-phase deal — open, won, and lost —
    // close-date ordered, exactly the set the whole-book card rendered.
    expect(result.current.opportunities.rows.map((row) => row.id)).toEqual([
      'opp-won',
      'opp-lost',
      'opp-open',
      'opp-pm2',
    ]);
    expect(result.current.opportunities.totalCount).toBe(4);
    expect(result.current.opportunities.hasMore).toBe(false);

    // The queue is phase-filtered: the June conflict registration is out.
    expect(result.current.pending.rows.map((row) => row.id)).toEqual(['reg-pending']);
    expect(result.current.pending.totalCount).toBe(1);

    // Ops deliberately span history: the June approval is leaking, lapsed,
    // and in conflict.
    const ops = result.current.ops.data!;
    expect(ops.approvedNotConverted).toBe(1);
    expect(ops.exclusivityLapsed).toBe(1);
    expect(ops.duplicateGroups).toBe(1);
    expect(result.current.unconverted.rows.map((row) => row.id)).toEqual(['reg-lapsed']);
    expect(result.current.duplicates.rows.map((group) => group.accountName)).toEqual([
      'Cobalt Health',
    ]);
  });

  it('scopes every aggregate to the selected manager', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    rerender(inputFor(provider, { managerId: 'pm-2' }));
    await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(40_000));

    const summary = result.current.summary.data!;
    expect(summary.openCount).toBe(1);
    expect(summary.closedWon).toBe(0);
    expect(summary.alignedPartners).toBe(1);
    expect(result.current.opportunities.rows.map((row) => row.id)).toEqual(['opp-pm2']);
    expect(result.current.leaderboard.data!.map((row) => row.partner.id)).toEqual(['partner-3']);
  });

  it('scopes every aggregate to the selected partner and surfaces its certification', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    rerender(inputFor(provider, { partnerId: 'partner-1' }));
    await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(250_000));

    expect(result.current.summary.data!.alignedPartners).toBe(1);
    const certification = result.current.certification.data;
    expect(certification?.partner.id).toBe('partner-1');
    expect(certification?.certification?.partnerStrategistsCertified).toBe(2);
  });

  it('pages the pipeline opportunities a cursor at a time, 25 rows per request', async () => {
    const opportunities = Array.from({ length: 30 }, (_, index) =>
      makeOpportunity({
        id: `opp-${String(index).padStart(2, '0')}`,
        partnerId: 'partner-1',
        forecastedRevenue: 10_000 + index,
        createdAt: '2026-08-03T00:00:00.000Z',
        expectedCloseDate: `2026-10-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
      }),
    );
    const { provider, calls } = spyProvider(
      new MockDataProvider(
        makeProviderBook({
          ...makeBook(),
          opportunities,
        }),
      ),
    );
    const { result } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );

    await waitFor(() => expect(result.current.opportunities.meta).not.toBeNull());
    expect(result.current.opportunities.rows).toHaveLength(25);
    expect(result.current.opportunities.totalCount).toBe(30);
    expect(result.current.opportunities.hasMore).toBe(true);

    act(() => result.current.opportunities.loadMore());
    await waitFor(() => expect(result.current.opportunities.rows).toHaveLength(30));
    expect(result.current.opportunities.hasMore).toBe(false);
    // Two bounded page requests, no more.
    expect(calls.filter((method) => method === 'listScopedOpportunities')).toHaveLength(2);
  });

  it('keeps a failed query independent: siblings stay settled, retry repeats only the failed call', async () => {
    const remote = new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
      latencyMs: 0,
      failMethods: { getPerformanceSummary: 1 },
    });
    const { provider, calls } = spyProvider(remote);
    const { result } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );

    await waitFor(() => expect(result.current.summary.error).not.toBeNull());
    // The summary alone failed; the funnel, the trend, and the pages landed.
    await waitFor(() => {
      expect(result.current.funnel.data).not.toBeNull();
      expect(result.current.trend.data).not.toBeNull();
      expect(result.current.opportunities.meta).not.toBeNull();
    });
    expect(result.current.summary.error).toBe('Failed to load the performance summary');
    expect(result.current.summary.data).toBeNull();

    act(() => result.current.summary.retry());
    await waitFor(() => expect(result.current.summary.data).not.toBeNull());

    expect(calls.filter((method) => method === 'getPerformanceSummary')).toHaveLength(2);
    expect(calls.filter((method) => method === 'getRegistrationFunnel')).toHaveLength(1);
    expect(calls.filter((method) => method === 'getQuarterlyRevenueTrend')).toHaveLength(1);
    expect(calls.filter((method) => method === 'listScopedOpportunities')).toHaveLength(1);
  });

  it('refreshes the loaded pipeline window in place when one of its deals is edited', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    rerender(
      inputFor(provider, {
        edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-open': 400_000 } },
      }),
    );
    // 400k edited + the other manager's untouched 40k open deal.
    await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(440_000));
    await waitFor(() =>
      expect(calls.filter((name) => name === 'listScopedOpportunities')).toHaveLength(2),
    );

    // The window refreshed in place: same rows, edited value, no reset.
    const edited = result.current.opportunities.rows.find((row) => row.id === 'opp-open');
    expect(edited?.forecastedRevenue).toBe(400_000);
    // The edit moves no registration, meeting, or directory answer.
    expect(calls.filter((name) => name === 'getRegistrationFunnel')).toHaveLength(1);
    expect(calls.filter((name) => name === 'getWeeklyGoalProgress')).toHaveLength(1);
    expect(calls.filter((name) => name === 'getRegistrationOpsSummary')).toHaveLength(1);
  });
});
