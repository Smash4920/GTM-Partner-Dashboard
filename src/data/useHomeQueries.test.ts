import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { SessionEdits } from './sessionEdits';
import { useHomeQueries } from './useHomeQueries';
import type { HomeQueryInput } from './useHomeQueries';
import {
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTarget,
} from '../test/fixtures';
import type { MeetingClassification } from './types';
import type { ProviderBook } from './mock/book';

/**
 * VAL-DATA-014 (Home): the route requests exactly the scoped aggregates and
 * the bounded queue page it renders — never a whole-book list method — with
 * the phase and type filters as provider inputs, and every query failing
 * and retrying independently of its siblings.
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

/** The characterization book: one open Q3 deal, a Q3 win, a Q3 loss, and a
 * prior-year win, with registrations covering every funnel stage. */
function makeBook(): ProviderBook {
  return makeProviderBook({
    partnerManagers: [{ id: 'pm-1', name: 'J. Alvarez' }],
    partners: [
      makePartner({ id: 'partner-1', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', name: 'Beacon Consulting', partnerManagerId: 'pm-1' }),
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
        id: 'reg-converted',
        partnerId: 'partner-2',
        accountName: 'Delta Energy',
        amount: 110_000,
        submittedAt: '2026-08-20T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-08-25T00:00:00.000Z',
        convertedTo: 'opp-won',
      }),
      makeRegistration({
        id: 'reg-rejected',
        partnerId: 'partner-1',
        accountName: 'Borealis Labs',
        amount: 90_000,
        submittedAt: '2026-08-10T00:00:00.000Z',
        status: 'rejected',
        decisionAt: '2026-08-12T00:00:00.000Z',
      }),
    ],
    targets: [makeTarget({ partnerId: 'partner-1', quarter: 'FY27-Q3', revenueTarget: 100_000 })],
    activities: [],
  });
}

function inputFor(provider: DataProvider, overrides: Partial<HomeQueryInput> = {}): HomeQueryInput {
  return {
    provider,
    access: INTERNAL_DEMO_SCOPE,
    phase: 'q3',
    oppType: 'all',
    edits: NO_SESSION_EDITS,
    classifications: {},
    prospects: [],
    ...overrides,
  };
}

/** Waits until every Home query has settled with data. */
async function settle(result: { current: ReturnType<typeof useHomeQueries> }) {
  await waitFor(() => {
    expect(result.current.summary.data).not.toBeNull();
    expect(result.current.funnel.data).not.toBeNull();
    expect(result.current.stages.data).not.toBeNull();
    expect(result.current.types.data).not.toBeNull();
    expect(result.current.trend.data).not.toBeNull();
    expect(result.current.activity.data).not.toBeNull();
    expect(result.current.pending.meta).not.toBeNull();
    expect(result.current.leaderboard.data).not.toBeNull();
    expect(result.current.roster.data).not.toBeNull();
  });
}

describe('useHomeQueries (VAL-DATA-014)', () => {
  it('requests exactly the scoped aggregates and the bounded queue page — never the whole book', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    expect([...new Set(calls)].sort()).toEqual([
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getStageBreakdown',
      'getTopPartnerLeaders',
      'getTypeBreakdown',
      'getWeeklyActivitySeries',
      'listPendingRegistrations',
    ]);
    // The queue page is bounded: one page request, under the maximum limit.
    expect(calls.filter((method) => method === 'listPendingRegistrations')).toHaveLength(1);
    expect(result.current.pending.rows.length).toBeLessThanOrEqual(7);
  });

  it('answers with the same deterministic values the whole-book view computed', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    const summary = result.current.summary.data!;
    expect(summary.openPipelineValue).toBe(250_000);
    expect(summary.openCount).toBe(1);
    expect(summary.closedWon).toBe(120_000);
    expect(summary.priorClosedWon).toBe(100_000);
    expect(summary.target).toBe(100_000);
    expect(summary.attainment).toBe(1.2);
    expect(summary.coverage).toEqual({ kind: 'target-met' });
    // One deal won of two closed: the win rate is count-based.
    expect(summary.winRate).toBe(0.5);
    expect(summary.avgOpenDealSize).toBe(250_000);
    // Two of three registrations decided; one approved row converted.
    expect(summary.decidedRegistrations).toBe(2);
    expect(summary.approvalRate).toBeCloseTo(0.5, 10);
    expect(summary.convertedRegistrations).toBe(1);
    // The one approved registration is the one that converted.
    expect(summary.conversionRate).toBe(1);
    expect(summary.activePartners).toBe(2);
    expect(summary.alignedPartners).toBe(2);

    const funnel = result.current.funnel.data!;
    expect(funnel.submitted).toBe(3);
    expect(funnel.pending).toBe(1);
    expect(funnel.approved).toBe(1);
    expect(funnel.rejected).toBe(1);
    expect(funnel.converted).toBe(1);

    // The queue page is the one pending registration.
    expect(result.current.pending.rows.map((row) => row.id)).toEqual(['reg-pending']);
    expect(result.current.pending.totalCount).toBe(1);
    expect(result.current.pending.hasMore).toBe(false);

    // The fixed-cap top board ranks the winning partner first and counts
    // the whole field it was drawn from.
    const leaderboard = result.current.leaderboard.data!;
    expect(leaderboard.leaders.map((row) => row.partner.id)).toEqual(['partner-1', 'partner-2']);
    expect(leaderboard.leaders[0]!.closedWonValue).toBe(120_000);
    expect(leaderboard.totalPartners).toBe(2);
    expect(result.current.roster.data!.map((partner) => partner.id)).toEqual([
      'partner-1',
      'partner-2',
    ]);
  });

  it('keeps a failed query independent: siblings stay settled, retry repeats only the failed call', async () => {
    const remote = new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
      latencyMs: 0,
      failMethods: { getRegistrationFunnel: 1 },
    });
    const { provider, calls } = spyProvider(remote);
    const { result } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
      initialProps: inputFor(provider),
    });

    await waitFor(() => expect(result.current.funnel.error).not.toBeNull());
    // The funnel alone failed; every sibling still landed.
    await waitFor(() => {
      expect(result.current.summary.data).not.toBeNull();
      expect(result.current.stages.data).not.toBeNull();
    });
    expect(result.current.funnel.error).toBe('Failed to load the registration funnel');
    expect(result.current.funnel.data).toBeNull();

    act(() => result.current.funnel.retry());
    await waitFor(() => expect(result.current.funnel.data).not.toBeNull());

    // The retry repeated the failed method alone.
    expect(calls.filter((method) => method === 'getRegistrationFunnel')).toHaveLength(2);
    expect(calls.filter((method) => method === 'getPerformanceSummary')).toHaveLength(1);
    expect(calls.filter((method) => method === 'getStageBreakdown')).toHaveLength(1);
  });

  it('re-scopes the phase-dependent queries on a phase change and leaves the rest alone', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    rerender(inputFor(provider, { phase: 'q4' }));
    await waitFor(() => expect(result.current.summary.data?.openCount).toBe(0));

    const count = (method: string) => calls.filter((name) => name === method).length;
    expect(count('getPerformanceSummary')).toBe(2);
    expect(count('getRegistrationFunnel')).toBe(2);
    expect(count('getStageBreakdown')).toBe(2);
    expect(count('getTypeBreakdown')).toBe(2);
    expect(count('getTopPartnerLeaders')).toBe(2);
    // The trend spans every quarter and the queue spans all history: neither
    // is re-asked for a phase change.
    expect(count('getQuarterlyRevenueTrend')).toBe(1);
    expect(count('listPendingRegistrations')).toBe(1);
    expect(count('getWeeklyActivitySeries')).toBe(1);
  });

  it('passes the type lens to the queries it scopes, and not to the type mix itself', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    rerender(inputFor(provider, { oppType: 'sell-with' }));
    await waitFor(() =>
      expect(calls.filter((name) => name === 'getPerformanceSummary')).toHaveLength(2),
    );

    const count = (method: string) => calls.filter((name) => name === method).length;
    expect(count('getPerformanceSummary')).toBe(2);
    expect(count('getStageBreakdown')).toBe(2);
    expect(count('getQuarterlyRevenueTrend')).toBe(2);
    expect(count('getTopPartnerLeaders')).toBe(2);
    // The chart is the mix the lens selects from; registrations are untyped.
    expect(count('getTypeBreakdown')).toBe(1);
    expect(count('getRegistrationFunnel')).toBe(1);
  });

  it('refetches the revenue-reading aggregates on a revenue edit and nothing else', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    const edits: SessionEdits = {
      ...NO_SESSION_EDITS,
      revenueOverrides: { 'opp-open': 400_000 },
    };
    rerender(inputFor(provider, { edits }));
    await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(400_000));

    const count = (method: string) => calls.filter((name) => name === method).length;
    expect(count('getPerformanceSummary')).toBe(2);
    expect(count('getStageBreakdown')).toBe(2);
    expect(count('getTypeBreakdown')).toBe(2);
    expect(count('getQuarterlyRevenueTrend')).toBe(2);
    expect(count('getTopPartnerLeaders')).toBe(2);
    // Registrations, meetings, and the queue read no opportunity revenue.
    expect(count('getRegistrationFunnel')).toBe(1);
    expect(count('getWeeklyActivitySeries')).toBe(1);
    expect(count('listPendingRegistrations')).toBe(1);
  });

  it('refetches only the weekly activity when a meeting is reclassified', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    const classifications: Record<string, MeetingClassification> = {
      'meeting-x': { type: 'pio-interlock', partnerId: 'partner-1' },
    };
    rerender(inputFor(provider, { classifications }));
    await waitFor(() =>
      expect(calls.filter((name) => name === 'getWeeklyActivitySeries')).toHaveLength(2),
    );

    expect(calls.filter((name) => name === 'getPerformanceSummary')).toHaveLength(1);
    expect(calls.filter((name) => name === 'getRegistrationFunnel')).toHaveLength(1);
    expect(calls.filter((name) => name === 'listPendingRegistrations')).toHaveLength(1);
  });

  describe('scope identity', () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    /**
     * A provider whose second-and-later summary answers wait on a gate the
     * test controls, so the state between "scope changed" and "replacement
     * answered" is directly observable.
     */
    function gatedSummaryProvider(gate: { promise: Promise<unknown> }) {
      const inner = new MockDataProvider(makeBook());
      let calls = 0;
      const provider: DataProvider = Object.assign(new MockDataProvider(makeBook()), {
        getPerformanceSummary: (
          ...args: Parameters<DataProvider['getPerformanceSummary']>
        ): ReturnType<DataProvider['getPerformanceSummary']> => {
          calls += 1;
          if (calls === 1) return inner.getPerformanceSummary(...args);
          return gate.promise.then(() => inner.getPerformanceSummary(...args));
        },
      });
      return provider;
    }

    it('hides every phase-scoped answer the moment the phase changes — synchronously', async () => {
      const { provider } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
        initialProps: inputFor(provider),
      });
      await settle(result);

      rerender(inputFor(provider, { phase: 'q4' }));

      // The phase is the membership of these answers: under the new phase
      // label none of the old phase's figures may render, not even for the
      // frames while the replacement requests are in flight.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.funnel.data).toBeNull();
      expect(result.current.stages.data).toBeNull();
      expect(result.current.types.data).toBeNull();
      expect(result.current.leaderboard.data).toBeNull();
      // The trend spans every quarter, the activity series spans weeks, and
      // the queue spans all history: the phase is not their membership, so
      // their answers stay.
      expect(result.current.trend.data).not.toBeNull();
      expect(result.current.activity.data).not.toBeNull();
      expect(result.current.pending.rows.length).toBeGreaterThan(0);

      await waitFor(() => expect(result.current.summary.data?.openCount).toBe(0));
    });

    it('hides lensed answers the moment the type lens changes — synchronously', async () => {
      const { provider } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
        initialProps: inputFor(provider),
      });
      await settle(result);

      rerender(inputFor(provider, { oppType: 'sell-with' }));

      // The lens re-scopes the summary, stages, trend, and leaderboard; the
      // type chart is the mix the lens selects from and the funnel is
      // untyped, so those two keep their answers.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.stages.data).toBeNull();
      expect(result.current.trend.data).toBeNull();
      expect(result.current.leaderboard.data).toBeNull();
      expect(result.current.types.data).not.toBeNull();
      expect(result.current.funnel.data).not.toBeNull();

      await waitFor(() => expect(result.current.summary.data).not.toBeNull());
    });

    it('never restores the prior phase’s summary when the replacement request fails', async () => {
      const gate = deferred<unknown>();
      const provider = gatedSummaryProvider(gate);
      const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
        initialProps: inputFor(provider),
      });
      await settle(result);
      expect(result.current.summary.data?.openPipelineValue).toBe(250_000);

      rerender(inputFor(provider, { phase: 'q4' }));
      // While the new phase's answer is in flight the widget is the new
      // scope's initial load — never a stale frame of Q3's figures.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.summary.loading).toBe(true);

      await act(async () => {
        gate.reject(new Error('boom'));
      });
      // The failed first fetch of the new scope is unavailable, with its
      // retry — the prior phase's numbers do not come back.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.summary.error).toBe('Failed to load the performance summary');
    });

    it('keeps the same scope’s last good answer while an edit refresh is in flight', async () => {
      const gate = deferred<unknown>();
      const provider = gatedSummaryProvider(gate);
      const { result, rerender } = renderHook((input: HomeQueryInput) => useHomeQueries(input), {
        initialProps: inputFor(provider),
      });
      await settle(result);

      const edits: SessionEdits = {
        ...NO_SESSION_EDITS,
        revenueOverrides: { 'opp-open': 400_000 },
      };
      rerender(inputFor(provider, { edits }));
      // Same scope, new data: stale beats blank — the previous figures stay
      // on screen, marked refreshing, until the edited answer lands.
      expect(result.current.summary.data?.openPipelineValue).toBe(250_000);
      expect(result.current.summary.refreshing).toBe(true);
      expect(result.current.summary.error).toBeNull();

      await act(async () => {
        gate.resolve(undefined);
      });
      await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(400_000));
    });
  });
});
