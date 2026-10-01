import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
import { useRegistrationOpsQueries } from './useRegistrationOpsQueries';
import type { RegistrationOpsQueryInput } from './useRegistrationOpsQueries';
import {
  approvedNotConverted,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  pendingRegistrations,
  registrationConversionTimes,
  registrationsPastSla,
} from '../lib/metrics';
import { makeOpportunity, makePartner, makeProviderBook, makeRegistration } from '../test/fixtures';
import type { ProviderBook } from './types';

/**
 * VAL-DATA-015 (Deal Reg Ops): the route requests exactly the bounded
 * registration, conflict, conversion, and SLA answers it renders — one
 * ops aggregate and three cursor-paginated row collections, plus the roster
 * dimension — and every query fails and retries independently of its
 * siblings. Values are pinned against the metrics layer the view used to
 * call itself, so the seam cannot quietly change the arithmetic.
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

/**
 * A book whose registration arithmetic is verifiable by hand at the fixed
 * snapshot (Friday 2026-09-18):
 *
 * - one pending inside the SLA, three pending past it (the conflict pair at
 *   six and five business days, reg-pending-2 at the inclusive
 *   five-business-day boundary);
 * - one approved registration leaking past the 60-day exclusivity window,
 *   one leaking inside it, one converted and won;
 * - one duplicate client across two partners.
 */
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
        id: 'opp-won',
        partnerId: 'partner-1',
        outcome: 'won',
        forecastedRevenue: 120_000,
        createdAt: '2026-09-05T00:00:00.000Z',
        expectedCloseDate: '2026-09-15T00:00:00.000Z',
        closedAt: '2026-09-15T00:00:00.000Z',
      }),
    ],
    registrations: [
      makeRegistration({
        id: 'reg-converted',
        partnerId: 'partner-1',
        accountName: 'Acme Freight',
        submittedAt: '2026-08-28T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-09-01T00:00:00.000Z',
        convertedTo: 'opp-won',
      }),
      makeRegistration({
        id: 'reg-lapsed',
        partnerId: 'partner-1',
        accountName: 'Cobalt Health',
        submittedAt: '2026-06-01T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-06-03T00:00:00.000Z',
      }),
      makeRegistration({
        id: 'reg-leaking',
        partnerId: 'partner-2',
        accountName: 'Delta Retail',
        submittedAt: '2026-09-08T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-09-10T00:00:00.000Z',
      }),
      // The conflict pair: same account, two partners.
      makeRegistration({
        id: 'reg-dup-1',
        partnerId: 'partner-1',
        accountName: 'Shared Account',
        submittedAt: '2026-09-10T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-dup-2',
        partnerId: 'partner-3',
        accountName: 'Shared Account',
        submittedAt: '2026-09-12T00:00:00.000Z',
        status: 'pending',
      }),
      // Exactly five business days waiting at the snapshot: past the SLA,
      // inclusively.
      makeRegistration({
        id: 'reg-pending-2',
        partnerId: 'partner-2',
        accountName: 'Beacon Logistics',
        submittedAt: '2026-09-13T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-pending-1',
        partnerId: 'partner-1',
        accountName: 'Northwind Foods',
        submittedAt: '2026-09-17T00:00:00.000Z',
        status: 'pending',
      }),
    ],
    targets: [],
    activities: [],
    certifications: [],
  });
}

function inputFor(
  provider: DataProvider,
  overrides: Partial<RegistrationOpsQueryInput> = {},
): RegistrationOpsQueryInput {
  return {
    provider,
    access: INTERNAL_DEMO_SCOPE,
    prospects: [],
    ...overrides,
  };
}

/** Waits until every Deal Reg Ops query has settled with an answer. */
async function settle(result: { current: ReturnType<typeof useRegistrationOpsQueries> }) {
  await waitFor(() => {
    expect(result.current.ops.data).not.toBeNull();
    expect(result.current.roster.data).not.toBeNull();
    expect(result.current.pending.meta).not.toBeNull();
    expect(result.current.unconverted.meta).not.toBeNull();
    expect(result.current.duplicates.meta).not.toBeNull();
  });
}

describe('useRegistrationOpsQueries (VAL-DATA-015)', () => {
  it('requests exactly its scoped queries — one aggregate, three pages, one dimension', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook(
      (input: RegistrationOpsQueryInput) => useRegistrationOpsQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    expect([...new Set(calls)].sort()).toEqual([
      'getPartnerRoster',
      'getRegistrationOpsSummary',
      'listDuplicateRegistrationGroups',
      'listPendingRegistrations',
      'listUnconvertedRegistrations',
    ]);
    // The retired whole-book reads are not part of this route's world.
    for (const legacy of [
      'listOpportunities',
      'listRegistrations',
      'listPartners',
      'listPartnerManagers',
      'listActivities',
      'listCertifications',
      'getTargets',
    ]) {
      expect(calls).not.toContain(legacy);
    }
    // Every row collection is one bounded page request.
    for (const pageQuery of [
      'listPendingRegistrations',
      'listUnconvertedRegistrations',
      'listDuplicateRegistrationGroups',
    ]) {
      expect(calls.filter((method) => method === pageQuery)).toHaveLength(1);
    }
  });

  it('answers with the values the metrics layer computes over the same book', async () => {
    const book = makeBook();
    const { provider } = spyProvider(new MockDataProvider(book));
    const { result } = renderHook(
      (input: RegistrationOpsQueryInput) => useRegistrationOpsQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    const ops = result.current.ops.data!;
    expect(ops).toEqual({
      times: registrationConversionTimes(book.registrations, book.opportunities),
      pending: pendingRegistrations(book.registrations).length,
      approvedNotConverted: approvedNotConverted(book.registrations).length,
      exclusivityLapsed: approvedNotConverted(book.registrations).filter(exclusivityLapsed).length,
      pastSla: registrationsPastSla(book.registrations).length,
      duplicateGroups: duplicateRegistrationGroups(book.registrations, book.partners).length,
    });
    // Hand-computed, so the comparison above cannot be vacuous: the approval
    // hop of the one converted registration ran Friday → Tuesday, two
    // business days, and the win took ten calendar days from creation.
    expect(ops.times.submittedToApprovedBusinessDays).toBe(2);
    expect(ops.times.approvedToOpportunityCalendarDays).toBe(4);
    expect(ops.times.opportunityToWinCalendarDays).toBe(10);
    expect(ops.approvedNotConverted).toBe(2);
    expect(ops.exclusivityLapsed).toBe(1);
    // The conflict pair (Thursday and Saturday submissions) and the boundary
    // registration are all at or past five business days; only the Thursday
    // 9/17 submission is still inside the SLA.
    expect(ops.pastSla).toBe(3);
    expect(ops.duplicateGroups).toBe(1);

    // The queue spans all history, oldest first — the metric's own order.
    expect(result.current.pending.rows.map((row) => row.id)).toEqual(
      pendingRegistrations(book.registrations).map((row) => row.id),
    );
    expect(result.current.pending.rows.map((row) => row.id)).toEqual([
      'reg-dup-1',
      'reg-dup-2',
      'reg-pending-2',
      'reg-pending-1',
    ]);
    expect(result.current.pending.totalCount).toBe(4);

    expect(result.current.unconverted.rows.map((row) => row.id)).toEqual([
      'reg-lapsed',
      'reg-leaking',
    ]);
    expect(result.current.duplicates.rows.map((group) => group.accountName)).toEqual([
      'Shared Account',
    ]);
    expect(result.current.roster.data!.map((partner) => partner.id)).toEqual([
      'partner-1',
      'partner-2',
      'partner-3',
    ]);
  });

  it('pages the review queue a cursor at a time with no duplicates or gaps', async () => {
    // Twenty-three pending registrations force three ten-row pages.
    const queue = Array.from({ length: 23 }, (_, index) =>
      makeRegistration({
        id: `reg-queue-${String(index).padStart(2, '0')}`,
        partnerId: 'partner-1',
        accountName: `Queue Account ${index}`,
        submittedAt: `2026-09-${String(14 + (index % 4)).padStart(2, '0')}T00:00:00.000Z`,
        status: 'pending',
      }),
    );
    const { provider, calls } = spyProvider(
      new MockDataProvider(makeProviderBook({ ...makeBook(), registrations: queue })),
    );
    const { result } = renderHook(
      (input: RegistrationOpsQueryInput) => useRegistrationOpsQueries(input),
      { initialProps: inputFor(provider) },
    );

    await waitFor(() => expect(result.current.pending.meta).not.toBeNull());
    expect(result.current.pending.rows).toHaveLength(10);
    expect(result.current.pending.totalCount).toBe(23);
    expect(result.current.pending.hasMore).toBe(true);

    act(() => result.current.pending.loadMore());
    await waitFor(() => expect(result.current.pending.rows).toHaveLength(20));
    act(() => result.current.pending.loadMore());
    await waitFor(() => expect(result.current.pending.rows).toHaveLength(23));
    expect(result.current.pending.hasMore).toBe(false);

    // Three bounded page requests, and a walk with no repeated or missed row.
    expect(calls.filter((method) => method === 'listPendingRegistrations')).toHaveLength(3);
    const ids = result.current.pending.rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(queue.map((row) => row.id).sort());
  });

  it('keeps a failed query independent: siblings stay settled, retry repeats only the failed call', async () => {
    const remote = new SimulatedRemoteProvider(new MockDataProvider(makeBook()), {
      latencyMs: 0,
      failMethods: { listPendingRegistrations: 1 },
    });
    const { provider, calls } = spyProvider(remote);
    const { result } = renderHook(
      (input: RegistrationOpsQueryInput) => useRegistrationOpsQueries(input),
      { initialProps: inputFor(provider) },
    );

    await waitFor(() => expect(result.current.pending.error).not.toBeNull());
    // The queue alone failed; the ops aggregate and the other pages landed.
    await waitFor(() => {
      expect(result.current.ops.data).not.toBeNull();
      expect(result.current.unconverted.meta).not.toBeNull();
      expect(result.current.duplicates.meta).not.toBeNull();
    });
    expect(result.current.pending.error).toBe('Failed to load the review queue');
    expect(result.current.pending.rows).toEqual([]);

    act(() => result.current.pending.retry());
    await waitFor(() => expect(result.current.pending.meta).not.toBeNull());
    expect(result.current.pending.rows).toHaveLength(4);

    expect(calls.filter((method) => method === 'listPendingRegistrations')).toHaveLength(2);
    expect(calls.filter((method) => method === 'getRegistrationOpsSummary')).toHaveLength(1);
    expect(calls.filter((method) => method === 'listUnconvertedRegistrations')).toHaveLength(1);
    expect(calls.filter((method) => method === 'listDuplicateRegistrationGroups')).toHaveLength(1);
  });

  it('refetches only the roster when a prospect joins the session', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: RegistrationOpsQueryInput) => useRegistrationOpsQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    rerender(
      inputFor(provider, {
        prospects: [
          makePartner({ id: 'prospect-1', name: 'Delta Labs', partnerManagerId: 'pm-1' }),
        ],
      }),
    );
    await waitFor(() =>
      expect(result.current.roster.data!.map((partner) => partner.id)).toContain('prospect-1'),
    );

    // The prospect holds no registrations, so no registration answer moved
    // or refetched — the roster alone carries the new session row.
    expect(calls.filter((method) => method === 'getPartnerRoster')).toHaveLength(2);
    expect(calls.filter((method) => method === 'getRegistrationOpsSummary')).toHaveLength(1);
    expect(calls.filter((method) => method === 'listPendingRegistrations')).toHaveLength(1);
    expect(result.current.ops.data!.pastSla).toBe(3);
  });
});
