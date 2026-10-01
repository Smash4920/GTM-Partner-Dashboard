import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyDemoAccessScope } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import { usePartnerPickerQueries, usePartnerViewQueries } from './usePartnerViewQueries';
import type { PartnerPickerQueryInput, PartnerViewQueryInput } from './usePartnerViewQueries';
import {
  approvedNotConverted,
  pendingRegistrations,
  registrationConversionTimes,
  registrationsNewestFirst,
} from '../lib/metrics';
import {
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTarget,
} from '../test/fixtures';
import type { ProviderBook } from './mock/book';

/**
 * VAL-CROSS-004 (Partner View): the route requests exactly the scoped
 * answers it renders — the picker's roster and ranking on the internal side,
 * and the selected partner's projection under a partner-audience scope —
 * every partner-scoped call carries the audience scope, and every query
 * fails and retries independently of its siblings. Values are pinned against
 * the metrics layer applied to the scoped book, so the seam cannot quietly
 * widen what the portal shows.
 */

/** A provider that records the method and the access scope of every call. */
function spyProvider(inner: DataProvider): {
  provider: DataProvider;
  calls: Array<{ method: string; access: DemoAccessScope }>;
} {
  const calls: Array<{ method: string; access: DemoAccessScope }> = [];
  const watched = new Set<string>(DATA_PROVIDER_METHODS);
  const provider = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || typeof value !== 'function' || !watched.has(property)) {
        return value;
      }
      return (...args: unknown[]) => {
        calls.push({ method: property, access: args[0] as DemoAccessScope });
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { provider, calls };
}

/**
 * Two partners, verifiable by hand. partner-1 has a sell-with win and open
 * deal, a Sell To deal (partner-1 is the customer there), and a conflicting
 * registration; partner-2 has the conflict's other side, its own deal, and
 * the larger portal-visible win — so any ranking that let Sell To revenue
 * in would crown partner-1, and the correct one crowns partner-2.
 */
function makeBook(): ProviderBook {
  return makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', name: 'Beacon Consulting', partnerManagerId: 'pm-2' }),
    ],
    opportunities: [
      // partner-1's Sell To win: invisible to the portal, so it must not
      // drive the default pick either.
      makeOpportunity({
        id: 'opp-sell-to-win',
        partnerId: 'partner-1',
        accountName: 'Northwind Internal',
        oppType: 'sell-to',
        outcome: 'won',
        forecastedRevenue: 500_000,
        createdAt: '2026-08-01T00:00:00Z',
        expectedCloseDate: '2026-08-10T00:00:00Z',
        closedAt: '2026-08-10T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-p1-win',
        partnerId: 'partner-1',
        outcome: 'won',
        forecastedRevenue: 100_000,
        createdAt: '2026-08-02T00:00:00Z',
        expectedCloseDate: '2026-08-12T00:00:00Z',
        closedAt: '2026-08-12T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-p1-open',
        partnerId: 'partner-1',
        forecastedRevenue: 60_000,
        createdAt: '2026-09-01T00:00:00Z',
        expectedCloseDate: '2026-10-15T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-p2-win',
        partnerId: 'partner-2',
        outcome: 'won',
        forecastedRevenue: 150_000,
        createdAt: '2026-08-03T00:00:00Z',
        expectedCloseDate: '2026-08-14T00:00:00Z',
        closedAt: '2026-08-14T00:00:00Z',
      }),
      makeOpportunity({
        id: 'opp-p2-open',
        partnerId: 'partner-2',
        accountName: 'Beacon Only Deal',
        forecastedRevenue: 40_000,
        createdAt: '2026-09-02T00:00:00Z',
        expectedCloseDate: '2026-10-20T00:00:00Z',
      }),
    ],
    registrations: [
      makeRegistration({
        id: 'reg-conflict',
        partnerId: 'partner-1',
        accountName: 'Shared Account',
        submittedAt: '2026-09-10T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-other-side',
        partnerId: 'partner-2',
        accountName: 'Shared Account',
        submittedAt: '2026-09-11T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-p1-pending',
        partnerId: 'partner-1',
        accountName: 'Northwind Foods',
        submittedAt: '2026-09-17T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-p1-leaking',
        partnerId: 'partner-1',
        accountName: 'Cobalt Health',
        submittedAt: '2026-06-01T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-06-03T00:00:00.000Z',
      }),
      makeRegistration({
        id: 'reg-p1-converted',
        partnerId: 'partner-1',
        accountName: 'Acme Freight',
        submittedAt: '2026-08-28T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-09-01T00:00:00.000Z',
        convertedTo: 'opp-p1-win',
      }),
    ],
    targets: [
      makeTarget({ partnerId: 'partner-1', revenueTarget: 200_000 }),
      makeTarget({ partnerId: 'partner-2', revenueTarget: 200_000 }),
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
    teamUsers: [],
  });
}

const PARTNER_ONE: DemoAccessScope = { audience: 'partner', partnerId: 'partner-1' };

function pickerInput(
  provider: DataProvider,
  overrides: Partial<PartnerPickerQueryInput> = {},
): PartnerPickerQueryInput {
  return { provider, prospects: [], ...overrides };
}

function viewInput(
  provider: DataProvider,
  overrides: Partial<PartnerViewQueryInput> = {},
): PartnerViewQueryInput {
  return {
    provider,
    partnerId: 'partner-1',
    phase: 'fy',
    slice: 'all',
    edits: NO_SESSION_EDITS,
    prospects: [],
    ...overrides,
  };
}

/** Waits until every Partner View query has settled with an answer. */
async function settle(result: { current: ReturnType<typeof usePartnerViewQueries> }) {
  await waitFor(() => {
    expect(result.current.summary.data).not.toBeNull();
    expect(result.current.stages.data).not.toBeNull();
    expect(result.current.motions.data).not.toBeNull();
    expect(result.current.trend.data).not.toBeNull();
    expect(result.current.certification.data).not.toBeNull();
    expect(result.current.ops.data).not.toBeNull();
    expect(result.current.history.meta).not.toBeNull();
    expect(result.current.exclusivity.meta).not.toBeNull();
    expect(result.current.pipeline.meta).not.toBeNull();
  });
}

describe('usePartnerPickerQueries (VAL-CROSS-004)', () => {
  it('requests only the roster and the combined portal-visible top board', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook(
      (input: PartnerPickerQueryInput) => usePartnerPickerQueries(input),
      { initialProps: pickerInput(provider) },
    );
    await waitFor(() => {
      expect(result.current.roster.data).not.toBeNull();
      expect(result.current.defaultPick.data).not.toBeNull();
    });

    expect([...new Set(calls.map((call) => call.method))].sort()).toEqual([
      'getPartnerRoster',
      'getTopPartnerLeaders',
    ]);
    // One provider-side ranking over Sell With + Allocate combined — not the
    // old pair of independently truncated boards merged in the client.
    expect(calls.filter((call) => call.method === 'getTopPartnerLeaders')).toHaveLength(1);
    // The picker is internal-facing demo furniture: every partner stays an
    // option, so the roster read is internal-scoped.
    expect(calls.every((call) => call.access.audience === 'internal')).toBe(true);
    expect(result.current.roster.data!.map((partner) => partner.id)).toEqual([
      'partner-1',
      'partner-2',
    ]);
  });

  it('crowns the portal-visible leader, never a Sell To one', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook(
      (input: PartnerPickerQueryInput) => usePartnerPickerQueries(input),
      { initialProps: pickerInput(provider) },
    );
    await waitFor(() => expect(result.current.defaultPick.data).not.toBeNull());

    // partner-1's 500k Sell To win would top any ranking that let it in;
    // over the revenue the portal can show, partner-2's 150k beats the 100k.
    expect(result.current.defaultPick.data).toBe('partner-2');
  });
});

describe('usePartnerViewQueries (VAL-CROSS-004)', () => {
  it('requests exactly its scoped projection — and never a whole-book read', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook((input: PartnerViewQueryInput) => usePartnerViewQueries(input), {
      initialProps: viewInput(provider),
    });
    await settle(result);

    expect([...new Set(calls.map((call) => call.method))].sort()).toEqual([
      'getPartnerCertification',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getTypeBreakdown',
      'listRecentRegistrations',
      'listScopedOpportunities',
      'listUnconvertedRegistrations',
    ]);
    // Every call is answered under the selected partner's audience scope —
    // the boundary the route's isolation rests on.
    expect(
      calls.every(
        (call) => call.access.audience === 'partner' && call.access.partnerId === 'partner-1',
      ),
    ).toBe(true);
    // Every row collection is one bounded page request.
    for (const pageQuery of [
      'listRecentRegistrations',
      'listUnconvertedRegistrations',
      'listScopedOpportunities',
    ]) {
      expect(calls.filter((call) => call.method === pageQuery)).toHaveLength(1);
    }
  });

  it('answers with the metrics layer’s values over the partner-scoped book', async () => {
    const book = makeBook();
    const { provider } = spyProvider(new MockDataProvider(book));
    const { result } = renderHook((input: PartnerViewQueryInput) => usePartnerViewQueries(input), {
      initialProps: viewInput(provider),
    });
    await settle(result);

    const scoped = applyDemoAccessScope(book, PARTNER_ONE);
    // The scoped fixture's boundary, stated: the Sell To win and the
    // conflict registration never entered this book.
    expect(scoped.opportunities.map((opp) => opp.id).sort()).toEqual(['opp-p1-open', 'opp-p1-win']);
    expect(scoped.registrations.map((reg) => reg.id).sort()).toEqual([
      'reg-p1-converted',
      'reg-p1-leaking',
      'reg-p1-pending',
    ]);

    const summary = result.current.summary.data!;
    expect(summary.openPipelineValue).toBe(60_000);
    expect(summary.openCount).toBe(1);
    expect(summary.closedWon).toBe(100_000);
    expect(summary.target).toBe(200_000);

    const ops = result.current.ops.data!;
    expect(ops.times).toEqual(
      registrationConversionTimes(scoped.registrations, scoped.opportunities),
    );
    // Two pending (the queue's own count) — wait: the conflict dropped, so
    // only reg-p1-pending is pending here.
    expect(ops.pending).toBe(pendingRegistrations(scoped.registrations).length);
    expect(ops.pending).toBe(1);
    expect(ops.approvedNotConverted).toBe(approvedNotConverted(scoped.registrations).length);
    expect(ops.duplicateGroups).toBe(0);

    // History: the partner's submissions minus the conflict, newest first.
    expect(result.current.history.rows.map((row) => row.id)).toEqual(
      registrationsNewestFirst(scoped.registrations).map((row) => row.id),
    );
    expect(result.current.history.rows.map((row) => row.id)).toEqual([
      'reg-p1-pending',
      'reg-p1-converted',
      'reg-p1-leaking',
    ]);
    expect(result.current.history.totalCount).toBe(3);

    expect(result.current.exclusivity.rows.map((row) => row.id)).toEqual(['reg-p1-leaking']);
    // The pipeline table shows the phase's scoped deals, won ones included —
    // as the folded-book table did — ordered by expected close.
    expect(result.current.pipeline.rows.map((row) => row.id)).toEqual([
      'opp-p1-win',
      'opp-p1-open',
    ]);
    expect(result.current.pipeline.totalCount).toBe(2);
    expect(result.current.certification.data?.certification?.partnerStrategistsCertified).toBe(1);
  });

  it('keeps a failed query independent: siblings stay settled, retry repeats only the failed call', async () => {
    const remote = new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
      latencyMs: 0,
      failMethods: { getStageBreakdown: 1 },
    });
    const { provider, calls } = spyProvider(remote);
    const { result } = renderHook((input: PartnerViewQueryInput) => usePartnerViewQueries(input), {
      initialProps: viewInput(provider),
    });

    await waitFor(() => expect(result.current.stages.error).not.toBeNull());
    await waitFor(() => {
      expect(result.current.summary.data).not.toBeNull();
      expect(result.current.ops.data).not.toBeNull();
      expect(result.current.history.meta).not.toBeNull();
    });
    expect(result.current.stages.error).toBe('Failed to load the pipeline by stage');
    expect(result.current.stages.data).toBeNull();

    act(() => result.current.stages.retry());
    await waitFor(() => expect(result.current.stages.data).not.toBeNull());

    expect(calls.filter((call) => call.method === 'getStageBreakdown')).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'getPerformanceSummary')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'listRecentRegistrations')).toHaveLength(1);
  });

  it('re-scopes every answer when the picker moves to another partner', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
      { initialProps: viewInput(provider) },
    );
    await settle(result);

    rerender(viewInput(provider, { partnerId: 'partner-2' }));
    await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(40_000));

    // The whole projection re-ran under the new audience scope.
    const partnerTwoCalls = calls.filter(
      (call) => call.access.audience === 'partner' && call.access.partnerId === 'partner-2',
    );
    expect(partnerTwoCalls.length).toBeGreaterThan(0);
    expect([...new Set(partnerTwoCalls.map((call) => call.method))].sort()).toEqual([
      'getPartnerCertification',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getTypeBreakdown',
      'listRecentRegistrations',
      'listScopedOpportunities',
      'listUnconvertedRegistrations',
    ]);
    // partner-2's history is empty: its only registration is the conflict's
    // other side, and conflicts stay internal on both sides of them.
    await waitFor(() => expect(result.current.history.meta).not.toBeNull());
    expect(result.current.history.rows).toEqual([]);
    expect(result.current.history.totalCount).toBe(0);
  });

  it('moves only the lensed queries when the slice changes, never the motion split', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
      { initialProps: viewInput(provider) },
    );
    await settle(result);

    rerender(viewInput(provider, { slice: 'sell-with' }));
    await waitFor(() =>
      expect(calls.filter((call) => call.method === 'getPerformanceSummary')).toHaveLength(2),
    );

    // The lens rides the summary, the stages, the trend, and the pipeline
    // table; the motion split, the registration cards, and the certification
    // answer the same question as before.
    expect(calls.filter((call) => call.method === 'getStageBreakdown')).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'getQuarterlyRevenueTrend')).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'listScopedOpportunities')).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'getTypeBreakdown')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'getRegistrationOpsSummary')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'listRecentRegistrations')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'getPartnerCertification')).toHaveLength(1);
  });

  describe('session edits', () => {
    it('applies a revenue edit at the seam and refreshes exactly the revenue-dependent answers', async () => {
      const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
        { initialProps: viewInput(provider) },
      );
      await settle(result);
      expect(result.current.summary.data?.openPipelineValue).toBe(60_000);

      // The session's edit (made on Forecasting) rides into every revenue
      // answer: the KPI aggregate and the loaded pipeline window both come
      // back with the corrected figure applied once by the provider.
      rerender(
        viewInput(provider, {
          edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-p1-open': 260_000 } },
        }),
      );
      await waitFor(() => expect(result.current.summary.data?.openPipelineValue).toBe(260_000));

      const count = (method: string) => calls.filter((call) => call.method === method).length;
      expect(count('getPerformanceSummary')).toBe(2);
      expect(count('getStageBreakdown')).toBe(2);
      expect(count('getTypeBreakdown')).toBe(2);
      expect(count('getQuarterlyRevenueTrend')).toBe(2);
      // The pipeline window refreshed in place — same rows, edited value.
      expect(count('listScopedOpportunities')).toBe(2);
      const edited = result.current.pipeline.rows.find((row) => row.id === 'opp-p1-open');
      expect(edited?.forecastedRevenue).toBe(260_000);
      expect(result.current.pipeline.rows.map((row) => row.id)).toEqual([
        'opp-p1-win',
        'opp-p1-open',
      ]);
      // Registrations, certification, and ops read no opportunity revenue.
      expect(count('getRegistrationOpsSummary')).toBe(1);
      expect(count('getPartnerCertification')).toBe(1);
      expect(count('listRecentRegistrations')).toBe(1);
      expect(count('listUnconvertedRegistrations')).toBe(1);
    });

    it('refreshes only the affected pipeline window for a note or next-step edit', async () => {
      const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
        { initialProps: viewInput(provider) },
      );
      await settle(result);

      rerender(
        viewInput(provider, {
          edits: { ...NO_SESSION_EDITS, notes: { 'opp-p1-open': 'Called to confirm' } },
        }),
      );
      await waitFor(() =>
        expect(calls.filter((call) => call.method === 'listScopedOpportunities')).toHaveLength(2),
      );

      // The loaded row carries the session's note; no aggregate moved,
      // because no aggregate on this route reads a note.
      expect(result.current.pipeline.rows.find((row) => row.id === 'opp-p1-open')?.notes).toBe(
        'Called to confirm',
      );
      const count = (method: string) => calls.filter((call) => call.method === method).length;
      expect(count('getPerformanceSummary')).toBe(1);
      expect(count('getStageBreakdown')).toBe(1);
      expect(count('getTypeBreakdown')).toBe(1);
      expect(count('getQuarterlyRevenueTrend')).toBe(1);
      expect(count('getRegistrationOpsSummary')).toBe(1);
    });

    it('issues no pipeline request for an edit that touches no loaded row', async () => {
      const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
        { initialProps: viewInput(provider) },
      );
      await settle(result);

      // A revenue edit to a deal outside the loaded window still refetches
      // the revenue aggregates (they cover the whole scope), but the window
      // itself is unaffected and is not refetched.
      rerender(
        viewInput(provider, {
          edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-not-loaded': 1 } },
        }),
      );
      await waitFor(() =>
        expect(calls.filter((call) => call.method === 'getPerformanceSummary')).toHaveLength(2),
      );
      expect(calls.filter((call) => call.method === 'listScopedOpportunities')).toHaveLength(1);
      expect(result.current.pipeline.rows.map((row) => row.id)).toEqual([
        'opp-p1-win',
        'opp-p1-open',
      ]);
    });
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

    it('drops every phase-scoped answer the moment the phase changes — synchronously', async () => {
      const { provider } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
        { initialProps: viewInput(provider) },
      );
      await settle(result);

      rerender(viewInput(provider, { phase: 'q3' }));

      // The phase is the membership of the summary, the stages, the motion
      // split, and the pipeline window: none of the FY figures may render
      // under the Q3 label, not even for one frame.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.stages.data).toBeNull();
      expect(result.current.motions.data).toBeNull();
      expect(result.current.pipeline.rows).toEqual([]);
      // The trend spans every quarter and the registration cards span all
      // history: the phase is not their membership, so their answers stay.
      expect(result.current.trend.data).not.toBeNull();
      expect(result.current.ops.data).not.toBeNull();
      expect(result.current.history.rows.length).toBeGreaterThan(0);

      await waitFor(() => expect(result.current.summary.data).not.toBeNull());
    });

    it('drops the lensed answers the moment the slice changes — synchronously', async () => {
      const { provider } = spyProvider(new MockDataProvider(makeBook()));
      const { result, rerender } = renderHook(
        (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
        { initialProps: viewInput(provider) },
      );
      await settle(result);

      rerender(viewInput(provider, { slice: 'sell-with' }));

      expect(result.current.summary.data).toBeNull();
      expect(result.current.stages.data).toBeNull();
      expect(result.current.trend.data).toBeNull();
      expect(result.current.pipeline.rows).toEqual([]);
      // The motion split always shows the full visible book, and the
      // registration cards carry no lens.
      expect(result.current.motions.data).not.toBeNull();
      expect(result.current.ops.data).not.toBeNull();

      await waitFor(() => expect(result.current.summary.data).not.toBeNull());
    });

    it('never restores the prior phase’s summary when the replacement request fails', async () => {
      const gate = deferred<unknown>();
      const inner = new MockDataProvider(makeBook());
      let summaryCalls = 0;
      const provider: DataProvider = Object.assign(new MockDataProvider(makeBook()), {
        getPerformanceSummary: (
          ...args: Parameters<DataProvider['getPerformanceSummary']>
        ): ReturnType<DataProvider['getPerformanceSummary']> => {
          summaryCalls += 1;
          if (summaryCalls === 1) return inner.getPerformanceSummary(...args);
          return gate.promise.then(() => inner.getPerformanceSummary(...args));
        },
      });
      const { result, rerender } = renderHook(
        (input: PartnerViewQueryInput) => usePartnerViewQueries(input),
        { initialProps: viewInput(provider) },
      );
      await settle(result);
      expect(result.current.summary.data?.openPipelineValue).toBe(60_000);

      rerender(viewInput(provider, { phase: 'q3' }));
      // The new phase's summary is an initial load — never a stale frame of
      // the FY figures under the Q3 label.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.summary.loading).toBe(true);

      await act(async () => {
        gate.reject(new Error('boom'));
      });
      // The failed first fetch of the new scope is unavailable with a retry;
      // the prior phase's numbers never come back.
      expect(result.current.summary.data).toBeNull();
      expect(result.current.summary.error).toBe('Failed to load the performance summary');
    });
  });
});
