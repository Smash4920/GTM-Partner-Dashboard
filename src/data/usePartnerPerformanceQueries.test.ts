import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { ActivityScope, DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import { usePartnerPerformanceQueries } from './usePartnerPerformanceQueries';
import type { PartnerPerformanceQueryInput } from './usePartnerPerformanceQueries';
import {
  makeCertification,
  makeMeeting,
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
    expect(result.current.leaderboard.meta).not.toBeNull();
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
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getWeeklyActivitySeries',
      'getWeeklyGoalProgress',
      'listDuplicateRegistrationGroups',
      'listPartnerLeaderboard',
      'listPendingRegistrations',
      'listScopedOpportunities',
      'listUnconvertedRegistrations',
    ]);
    // Every row collection is one bounded page request, the full leaderboard
    // included.
    for (const pageQuery of [
      'listScopedOpportunities',
      'listPendingRegistrations',
      'listUnconvertedRegistrations',
      'listDuplicateRegistrationGroups',
      'listPartnerLeaderboard',
    ]) {
      expect(calls.filter((method) => method === pageQuery)).toHaveLength(1);
    }
    expect(result.current.opportunities.rows.length).toBeLessThanOrEqual(25);
    expect(result.current.leaderboard.rows.length).toBeLessThanOrEqual(25);
    expect(result.current.leaderboard.totalCount).toBe(3);
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
    await waitFor(() =>
      expect(result.current.leaderboard.rows.map((row) => row.partner.id)).toEqual(['partner-3']),
    );
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

  it('pages the full leaderboard 25 partners at a time, one unique page per Load more', async () => {
    // Thirty roster partners with strictly decreasing wins, so the ranking
    // order is the fixture's order and every page boundary is checkable.
    const partners = Array.from({ length: 30 }, (_, index) =>
      makePartner({
        id: `partner-${String(index + 1).padStart(2, '0')}`,
        name: `Partner ${index + 1}`,
        partnerManagerId: 'pm-1',
      }),
    );
    const opportunities = partners.map((partner, index) =>
      makeOpportunity({
        id: `opp-${partner.id}`,
        partnerId: partner.id,
        outcome: 'won',
        forecastedRevenue: 1_000_000 - index * 1_000,
        createdAt: '2026-08-01T00:00:00.000Z',
        expectedCloseDate: '2026-09-01T00:00:00.000Z',
        closedAt: '2026-09-01T00:00:00.000Z',
      }),
    );
    const { provider, calls } = spyProvider(
      new MockDataProvider(makeProviderBook({ ...makeBook(), partners, opportunities })),
    );
    const { result } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );

    // The card opens on one bounded page of the ranking, never the roster.
    await waitFor(() => expect(result.current.leaderboard.meta).not.toBeNull());
    expect(result.current.leaderboard.rows).toHaveLength(25);
    expect(result.current.leaderboard.totalCount).toBe(30);
    expect(result.current.leaderboard.hasMore).toBe(true);
    expect(result.current.leaderboard.rows[0]!.partner.id).toBe('partner-01');

    act(() => result.current.leaderboard.loadMore());
    await waitFor(() => expect(result.current.leaderboard.rows).toHaveLength(30));
    expect(result.current.leaderboard.hasMore).toBe(false);
    // One unique appended page: no overlap with the twenty-five on screen,
    // and the walk continues in ranking order.
    const ids = result.current.leaderboard.rows.map((row) => row.partner.id);
    expect(new Set(ids).size).toBe(30);
    expect(ids[25]).toBe('partner-26');
    // Two bounded page requests, no more.
    expect(calls.filter((method) => method === 'listPartnerLeaderboard')).toHaveLength(2);
  });

  it('refreshes the leaderboard window in place on a revenue edit instead of resetting', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);
    expect(result.current.leaderboard.rows.map((row) => row.partner.id)).toEqual([
      'partner-1',
      'partner-3',
      'partner-2',
    ]);

    rerender(
      inputFor(provider, {
        edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-open': 400_000 } },
      }),
    );
    await waitFor(() =>
      expect(calls.filter((method) => method === 'listPartnerLeaderboard')).toHaveLength(2),
    );

    // The loaded window refreshed in place: same membership, edit applied.
    expect(result.current.leaderboard.rows.map((row) => row.partner.id)).toEqual([
      'partner-1',
      'partner-3',
      'partner-2',
    ]);
    expect(result.current.leaderboard.rows[0]!.openPipelineValue).toBe(400_000);
    expect(result.current.leaderboard.totalCount).toBe(3);
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

  describe('scope identity', () => {
    it('drops every drill-down-scoped answer the moment the manager changes — synchronously', async () => {
      const { provider } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
        { initialProps: inputFor(provider) },
      );
      await settle(result);

      rerender(inputFor(provider, { managerId: 'pm-2' }));

      // The manager is the membership of these answers: under the new
      // manager's label none of the old scope's figures may render, not even
      // for the frames while the replacement requests are in flight.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.funnel.data).toBeNull();
      expect(result.current.stages.data).toBeNull();
      expect(result.current.trend.data).toBeNull();
      expect(result.current.activity.data).toBeNull();
      expect(result.current.goal.data).toBeNull();
      expect(result.current.ops.data).toBeNull();
      expect(result.current.opportunities.rows).toEqual([]);
      expect(result.current.leaderboard.rows).toEqual([]);

      await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(40_000));
    });

    it('never restores the prior manager’s summary when the replacement request fails', async () => {
      let resolveSecond!: () => void;
      let rejectSecond!: (reason: unknown) => void;
      const gate = new Promise<unknown>((res, rej) => {
        resolveSecond = () => res(undefined);
        rejectSecond = rej;
      });
      void resolveSecond;
      const inner = new MockDataProvider(makeBook());
      let summaryCalls = 0;
      const provider: DataProvider = Object.assign(new MockDataProvider(makeBook()), {
        getPerformanceSummary: (
          ...args: Parameters<DataProvider['getPerformanceSummary']>
        ): ReturnType<DataProvider['getPerformanceSummary']> => {
          summaryCalls += 1;
          if (summaryCalls === 1) return inner.getPerformanceSummary(...args);
          return gate.then(() => inner.getPerformanceSummary(...args));
        },
      });
      const { result, rerender } = renderHook(
        (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
        { initialProps: inputFor(provider) },
      );
      await settle(result);
      expect(result.current.summary.data?.openPipelineValue).toBe(290_000);

      rerender(inputFor(provider, { managerId: 'pm-2' }));
      // The new manager's summary is an initial load, never a stale frame of
      // the org-wide figures under the new label.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.summary.loading).toBe(true);

      await act(async () => {
        rejectSecond(new Error('boom'));
      });
      // The failed first fetch of the new scope is unavailable with a retry;
      // the prior scope's numbers never come back.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.summary.error).toBe('Failed to load the performance summary');
    });

    it('keeps the same scope’s last good answer while an edit refresh is in flight', async () => {
      let resolveSecond!: () => void;
      const gate = new Promise<void>((res) => {
        resolveSecond = res;
      });
      const inner = new MockDataProvider(makeBook());
      let summaryCalls = 0;
      const provider: DataProvider = Object.assign(new MockDataProvider(makeBook()), {
        getPerformanceSummary: (
          ...args: Parameters<DataProvider['getPerformanceSummary']>
        ): ReturnType<DataProvider['getPerformanceSummary']> => {
          summaryCalls += 1;
          if (summaryCalls === 1) return inner.getPerformanceSummary(...args);
          return gate.then(() => inner.getPerformanceSummary(...args));
        },
      });
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
      // Same manager, same phase, new edit: the previous answer stays on
      // screen, marked refreshing, until the edited one lands.
      expect(result.current.summary.data?.openPipelineValue).toBe(290_000);
      expect(result.current.summary.refreshing).toBe(true);

      await act(async () => {
        resolveSecond();
      });
      await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(440_000));
    });
  });

  describe('session prospects', () => {
    /** A provider that also records the activity-scope argument of each call. */
    function scopeSpyProvider(inner: DataProvider) {
      const activityScopes: ActivityScope[] = [];
      const goalScopes: ActivityScope[] = [];
      const provider = new Proxy(inner, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property === 'getWeeklyActivitySeries') {
            return (access: DemoAccessScope, scope: ActivityScope, context: unknown) => {
              activityScopes.push(scope);
              return target.getWeeklyActivitySeries(access, scope, context as never);
            };
          }
          if (property === 'getWeeklyGoalProgress') {
            return (access: DemoAccessScope, scope: ActivityScope, context: unknown) => {
              goalScopes.push(scope);
              return target.getWeeklyGoalProgress(access, scope, context as never);
            };
          }
          return value;
        },
      });
      return { provider, activityScopes, goalScopes };
    }

    it('passes prospects into the activity and goal scopes so a prospect-classified meeting counts exactly once', async () => {
      // One current-week meeting, reclassified onto a session prospect. The
      // roster filter must see the prospect — appended by the provider from
      // the scope the hook passes — or the meeting falls out of every
      // aggregate even though the classification names a roster partner.
      const prospect = makePartner({
        id: 'prospect-1',
        name: 'Prospect Co',
        partnerManagerId: 'pm-1',
      });
      const book = makeProviderBook({
        ...makeBook(),
        activities: [makeMeeting({ id: 'meeting-1', partnerId: 'partner-1' })],
      });
      const { provider, activityScopes, goalScopes } = scopeSpyProvider(new MockDataProvider(book));
      const classifications = {
        'meeting-1': { type: 'pio-interlock', partnerId: 'prospect-1' },
      } as const;
      const { result } = renderHook(
        (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
        {
          initialProps: inputFor(provider, {
            classifications: { ...classifications },
            prospects: [prospect],
          }),
        },
      );
      await settle(result);

      // The prospect rode along with both queries as a scope input.
      expect(activityScopes).toHaveLength(1);
      expect(activityScopes[0]!.prospects?.map((partner) => partner.id)).toEqual(['prospect-1']);
      expect(goalScopes).toHaveLength(1);
      expect(goalScopes[0]!.prospects?.map((partner) => partner.id)).toEqual(['prospect-1']);

      // Exactly once: the current-week bucket holds the one classified
      // meeting, and the goal counts it as this week's one PIO interlock.
      const activity = result.current.activity.data!;
      expect(activity[activity.length - 1]!.total).toBe(1);
      expect(activity[activity.length - 1]!.byType['pio-interlock']).toBe(1);
      expect(result.current.goal.data!.meetings).toBe(1);
      expect(result.current.goal.data!.pioMeetings).toBe(1);
    });

    it('refetches the activity and goal aggregates when a prospect is added', async () => {
      const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
        { initialProps: inputFor(provider) },
      );
      await settle(result);

      rerender(
        inputFor(provider, {
          prospects: [makePartner({ id: 'prospect-1', name: 'Prospect Co' })],
        }),
      );
      await waitFor(() =>
        expect(calls.filter((name) => name === 'getWeeklyGoalProgress')).toHaveLength(2),
      );
      expect(calls.filter((name) => name === 'getWeeklyActivitySeries')).toHaveLength(2);
    });
  });

  describe('certification gating', () => {
    it('never asks for a certification while no partner is selected', async () => {
      const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
      const { result } = renderHook(
        (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
        { initialProps: inputFor(provider) },
      );
      await settle(result);

      // 'All partners' has no certification answer to give, so no request is
      // issued and nothing invisible can fail.
      expect(calls.filter((name) => name === 'getPartnerCertification')).toHaveLength(0);
    });

    it('starts the certification query only when a partner is selected', async () => {
      const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
        { initialProps: inputFor(provider) },
      );
      await settle(result);
      expect(calls.filter((name) => name === 'getPartnerCertification')).toHaveLength(0);

      rerender(inputFor(provider, { partnerId: 'partner-1' }));
      await waitFor(() => expect(result.current.certification.data).not.toBeNull());

      expect(calls.filter((name) => name === 'getPartnerCertification')).toHaveLength(1);
      expect(result.current.certification.data?.partner.id).toBe('partner-1');

      // Deselecting stops the query from re-firing; selecting another
      // partner starts it again under that partner's identity.
      rerender(inputFor(provider, { partnerId: 'all' }));
      rerender(inputFor(provider, { partnerId: 'partner-2' }));
      await waitFor(() =>
        expect(calls.filter((name) => name === 'getPartnerCertification')).toHaveLength(2),
      );
      await waitFor(() => expect(result.current.certification.data?.partner.id).toBe('partner-2'));
    });

    it('fails the certification query independently, with a retry that repeats only that call', async () => {
      const remote = new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
        latencyMs: 0,
        failMethods: { getPartnerCertification: 1 },
      });
      const { provider, calls } = spyProvider(remote);
      const { result, rerender } = renderHook(
        (input: PartnerPerformanceQueryInput) => usePartnerPerformanceQueries(input),
        { initialProps: inputFor(provider) },
      );
      await settle(result);
      // The armed failure is still unspent: no partner selected, no call.
      expect(result.current.certification.error).toBeNull();

      rerender(inputFor(provider, { partnerId: 'partner-1' }));
      await waitFor(() => expect(result.current.certification.error).not.toBeNull());
      expect(result.current.certification.error).toBe('Failed to load the certification profile');
      expect(result.current.certification.data).toBeNull();
      // The failure is this card's alone: the selected partner's summary
      // answered on the same selection change.
      await waitFor(() => expect(result.current.summary.data).not.toBeNull());

      // The retry repeats only the failed call.
      const beforeRetry = calls.length;
      act(() => result.current.certification.retry());
      await waitFor(() => expect(result.current.certification.data).not.toBeNull());

      expect(calls.slice(beforeRetry)).toEqual(['getPartnerCertification']);
      expect(result.current.certification.data?.partner.id).toBe('partner-1');
    });
  });
});
