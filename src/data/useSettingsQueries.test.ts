import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider, TeamRosterScope } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { createSimulatedRemoteProvider } from './mock/createSimulatedRemoteProvider';
import { useSettingsQueries } from './useSettingsQueries';
import type { SettingsQueryInput } from './useSettingsQueries';
import {
  applyTeamRosterOverlays,
  registrationSlaAlerts,
  registrationsNewestFirst,
} from '../lib/metrics';
import { makePartner, makeProviderBook, makeRegistration, makeTeamUser } from '../test/fixtures';
import type { ProviderBook } from './mock/book';

/**
 * VAL-CROSS-004 (Settings): the route's data-backed sections request
 * exactly the scoped answers they render — the overlaid roster, the manager
 * directory, the bounded SLA alert digest, the composer's registration page,
 * and the partner roster — and each section fails and retries independently.
 * The static catalog needs none of these, so a failed section never takes
 * the diagram down with it.
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
 * A book whose alert arithmetic is verifiable at the fixed snapshot (Friday
 * 2026-09-18): two pending registrations past the five-business-day SLA, one
 * still inside it. pm-1's roster user owns the alerts aligned to pm-1's
 * partner; the deal-desk user catches the rest.
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
    opportunities: [],
    registrations: [
      makeRegistration({
        id: 'reg-late',
        partnerId: 'partner-1',
        accountName: 'Acme Freight',
        submittedAt: '2026-09-10T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-later',
        partnerId: 'partner-2',
        accountName: 'Beacon Logistics',
        submittedAt: '2026-09-08T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-fresh',
        partnerId: 'partner-1',
        accountName: 'Northwind Foods',
        submittedAt: '2026-09-17T00:00:00.000Z',
        status: 'pending',
      }),
      makeRegistration({
        id: 'reg-approved',
        partnerId: 'partner-1',
        accountName: 'Cobalt Health',
        submittedAt: '2026-06-01T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-06-03T00:00:00.000Z',
      }),
    ],
    targets: [],
    activities: [],
    certifications: [],
    teamUsers: [
      makeTeamUser({
        id: 'user-pm1',
        name: 'A. Manager',
        role: 'partner-manager',
        partnerManagerId: 'pm-1',
      }),
      makeTeamUser({ id: 'user-desk', name: 'D. Desk', role: 'deal-desk-ops' }),
    ],
  });
}

function inputFor(
  provider: DataProvider,
  overrides: Partial<SettingsQueryInput> = {},
): SettingsQueryInput {
  return {
    provider,
    access: INTERNAL_DEMO_SCOPE,
    roster: {},
    prospects: [],
    ...overrides,
  };
}

/** Waits until every Settings query has settled with an answer. */
async function settle(result: { current: ReturnType<typeof useSettingsQueries> }) {
  await waitFor(() => {
    expect(result.current.teamUsers.data).not.toBeNull();
    expect(result.current.managers.data).not.toBeNull();
    expect(result.current.alerts.data).not.toBeNull();
    expect(result.current.registrations.meta).not.toBeNull();
    expect(result.current.partners.data).not.toBeNull();
  });
}

describe('useSettingsQueries (VAL-CROSS-004)', () => {
  it('requests exactly its scoped queries — and never a whole-book read', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook((input: SettingsQueryInput) => useSettingsQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    expect([...new Set(calls.map((call) => call.method))].sort()).toEqual([
      'getManagerDirectory',
      'getPartnerRoster',
      'getRegistrationSlaAlerts',
      'getTeamRoster',
      'listRecentRegistrations',
    ]);
    // This route's data is internal notification infrastructure; every call
    // carries the internal scope it was given.
    expect(calls.every((call) => call.access.audience === 'internal')).toBe(true);
  });

  it('answers with the values the metrics layer computes over the same book', async () => {
    const book = makeBook();
    const { provider } = spyProvider(new MockDataProvider(book));
    const { result } = renderHook((input: SettingsQueryInput) => useSettingsQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    expect(result.current.teamUsers.data).toEqual(book.teamUsers);
    expect(result.current.managers.data!.map((manager) => manager.id)).toEqual(['pm-1', 'pm-2']);
    expect(result.current.partners.data!.map((partner) => partner.id)).toEqual([
      'partner-1',
      'partner-2',
    ]);

    const expectedAlerts = registrationSlaAlerts(book.registrations, book.partners, book.teamUsers);
    // Hand-pinned so the comparison cannot be vacuous: the 9/8 and 9/10
    // submissions are past the SLA, the 9/17 one is inside it, and pm-1's
    // user owns exactly the Northwind one.
    expect(expectedAlerts.map((alert) => alert.registration.id)).toEqual(['reg-later', 'reg-late']);
    expect(result.current.alerts.data).toEqual({
      alerts: expectedAlerts,
      totalCount: 2,
      approachingCount: 0,
      ownedCount: 2,
      alertCountByOwner: { 'user-pm1': 1, 'user-desk': 1 },
    });

    // The composer lists the history newest first, every status included.
    expect(result.current.registrations.rows.map((row) => row.id)).toEqual(
      registrationsNewestFirst(book.registrations).map((row) => row.id),
    );
    expect(result.current.registrations.rows.map((row) => row.id)).toEqual([
      'reg-fresh',
      'reg-late',
      'reg-later',
      'reg-approved',
    ]);
    expect(result.current.registrations.totalCount).toBe(4);
  });

  it('carries the session’s roster overlays on the roster and alert queries alone', async () => {
    const book = makeBook();
    const { provider, calls } = spyProvider(new MockDataProvider(book));
    const { result, rerender } = renderHook(
      (input: SettingsQueryInput) => useSettingsQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    const roster: TeamRosterScope = {
      overrides: { 'user-pm1': { status: 'suspended' } },
      added: [makeTeamUser({ id: 'user-session', name: 'Session Add', role: 'deal-desk-ops' })],
    };
    rerender(inputFor(provider, { roster }));
    await waitFor(() =>
      expect(result.current.teamUsers.data?.map((user) => user.id)).toContain('user-session'),
    );

    // The overlay refetched exactly the two queries it rides.
    expect(calls.filter((call) => call.method === 'getTeamRoster')).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'getRegistrationSlaAlerts')).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'getManagerDirectory')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'listRecentRegistrations')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'getPartnerRoster')).toHaveLength(1);

    // And the alert answer already reflects it: pm-1's suspended user owns
    // nothing; the rule's answer over the overlaid roster is what landed.
    const overlaid = applyTeamRosterOverlays(book.teamUsers, roster.overrides, roster.added);
    const expectedAlerts = registrationSlaAlerts(book.registrations, book.partners, overlaid);
    expect(result.current.alerts.data!.alerts).toEqual(expectedAlerts);
    expect(result.current.alerts.data!.ownedCount).toBe(
      expectedAlerts.filter((alert) => alert.owner !== undefined).length,
    );
  });

  it('keeps a failed section independent: siblings stay settled, retry repeats only the failed call', async () => {
    const remote = createSimulatedRemoteProvider(new MockDataProvider(makeBook()), {
      latencyMs: 0,
      failMethods: { getRegistrationSlaAlerts: 1 },
    });
    const { provider, calls } = spyProvider(remote);
    const { result } = renderHook((input: SettingsQueryInput) => useSettingsQueries(input), {
      initialProps: inputFor(provider),
    });

    await waitFor(() => expect(result.current.alerts.error).not.toBeNull());
    await waitFor(() => {
      expect(result.current.teamUsers.data).not.toBeNull();
      expect(result.current.registrations.meta).not.toBeNull();
    });
    expect(result.current.alerts.error).toBe('Failed to load the registration SLA alerts');
    expect(result.current.alerts.data).toBeNull();

    act(() => result.current.alerts.retry());
    await waitFor(() => expect(result.current.alerts.data).not.toBeNull());
    expect(result.current.alerts.data!.totalCount).toBe(2);

    expect(calls.filter((call) => call.method === 'getRegistrationSlaAlerts')).toHaveLength(2);
    expect(calls.filter((call) => call.method === 'getTeamRoster')).toHaveLength(1);
    expect(calls.filter((call) => call.method === 'listRecentRegistrations')).toHaveLength(1);
  });
});
