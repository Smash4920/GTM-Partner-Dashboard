import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyDemoAccessScope } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
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
import type { ProviderBook } from './types';

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
  it('requests only the roster and the two portal-visible leaderboards', async () => {
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
      'getPartnerLeaderboard',
      'getPartnerRoster',
    ]);
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
    for (const legacy of [
      'listOpportunities',
      'listRegistrations',
      'listPartners',
      'listPartnerManagers',
      'listActivities',
      'listCertifications',
      'getTargets',
      'listTeamUsers',
    ]) {
      expect(calls.map((call) => call.method)).not.toContain(legacy);
    }
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
});
