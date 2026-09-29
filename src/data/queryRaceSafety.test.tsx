import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import type { DataProvider, ForecastSummary } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { ForecastScope } from './DataProvider';
import { useDashboardData } from './useDashboardData';
import { useForecastSummary, useManagerBook, usePartnerNames } from './useForecastQueries';
import { makeOpportunity, makePartner, makeProviderBook } from '../test/fixtures';

/**
 * VAL-RES-002: abort and generation checks reject obsolete results.
 *
 * The seam's methods cannot be cancelled mid-flight yet — the contract takes
 * no signal — so the hooks carry the guard that matters: a result is written
 * only while its request is still the newest one for the provider that is
 * still committed. Every test here resolves promises out of order with
 * provider-tagged values and asserts the hook's output only ever shows the
 * newest generation's tag.
 */

const quarter = CURRENT_FISCAL_QUARTER;
const baseScope: ForecastScope = { quarter, edits: NO_SESSION_EDITS };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return Object.assign(new MockDataProvider(makeProviderBook()), overrides);
}

/** An aggregates-serving provider whose summary carries a visible tag. */
function taggedAggregatesProvider(tag: number, gate?: () => Promise<unknown>): DataProvider {
  return stubProvider({
    getForecastSummary: async (scope) => {
      if (gate) await gate();
      const base = await new MockDataProvider(makeProviderBook()).getForecastSummary(scope);
      return { ...base, openPipelineValue: tag } satisfies ForecastSummary;
    },
  });
}

describe('VAL-RES-002 query race safety', () => {
  describe('useDashboardData', () => {
    it("never exposes the prior provider's book once the provider changes, and drops its late answer", async () => {
      const first = stubProvider({
        listPartnerManagers: async () => [{ id: 'pm-1', name: 'FIRST provider manager' }],
      });
      const secondGate = deferred<void>();
      const second = stubProvider({
        listPartnerManagers: async () => {
          await secondGate.promise;
          return [{ id: 'pm-1', name: 'SECOND provider manager' }];
        },
      });

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) => useDashboardData(provider),
        { initialProps: { provider: first } },
      );
      await waitFor(() => expect(result.current.data).not.toBeNull());
      expect(result.current.data?.partnerManagers[0]?.name).toBe('FIRST provider manager');

      // The provider commits elsewhere and the hook is re-rendered with it.
      // From this render on, the first provider's book is no one's data.
      rerender({ provider: second });
      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(true);

      await act(async () => {
        secondGate.resolve();
      });
      await waitFor(() => expect(result.current.data).not.toBeNull());
      expect(result.current.data?.partnerManagers[0]?.name).toBe('SECOND provider manager');
    });

    it('drops a whole-book answer that resolves after the provider was swapped', async () => {
      const slowGate = deferred<void>();
      const slow = stubProvider({
        listPartnerManagers: async () => {
          await slowGate.promise;
          return [{ id: 'pm-1', name: 'SLOW provider manager' }];
        },
      });
      const fast = stubProvider({
        listPartnerManagers: async () => [{ id: 'pm-1', name: 'FAST provider manager' }],
      });

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) => useDashboardData(provider),
        { initialProps: { provider: slow } },
      );
      // Swap before the first answer exists at all, then let the loser land.
      rerender({ provider: fast });
      await waitFor(() => expect(result.current.data).not.toBeNull());
      expect(result.current.data?.partnerManagers[0]?.name).toBe('FAST provider manager');

      await act(async () => {
        slowGate.resolve();
      });
      expect(result.current.data?.partnerManagers[0]?.name).toBe('FAST provider manager');
    });

    it('drops a failure that rejects after the provider was swapped', async () => {
      const failureGate = deferred<void>();
      const failing = stubProvider({
        listPartners: async () => {
          await failureGate.promise;
          throw new Error('listPartners failed in transit (simulated)');
        },
      });
      const healthy = stubProvider();

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) => useDashboardData(provider),
        { initialProps: { provider: failing } },
      );
      rerender({ provider: healthy });
      await waitFor(() => expect(result.current.data).not.toBeNull());

      await act(async () => {
        failureGate.resolve();
      });
      // The late failure belongs to an abandoned generation: no error appears
      // under the healthy provider, and its data is untouched.
      expect(result.current.error).toBeNull();
      expect(result.current.data).not.toBeNull();
    });
  });

  describe('useForecastSummary', () => {
    it("shows no prior-provider aggregates while the new provider's first answer is in flight", async () => {
      const first = taggedAggregatesProvider(111);
      const secondGate = deferred<unknown>();
      const second = taggedAggregatesProvider(222, () => secondGate.promise);

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) => useForecastSummary(provider, baseScope),
        { initialProps: { provider: first } },
      );
      await waitFor(() => expect(result.current.data?.openPipelineValue).toBe(111));

      rerender({ provider: second });
      // The old provider's figures must not render under the new provider,
      // not even for one frame while the new answer is in flight.
      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(true);

      await act(async () => {
        secondGate.resolve(undefined);
      });
      await waitFor(() => expect(result.current.data?.openPipelineValue).toBe(222));
    });

    it('drops an in-flight refresh from the previous provider when it resolves late', async () => {
      const refreshGate = deferred<unknown>();
      let calls = 0;
      const first = stubProvider({
        getForecastSummary: async (scope) => {
          calls += 1;
          const base = await new MockDataProvider(makeProviderBook()).getForecastSummary(scope);
          // The first load lands immediately; the refresh waits on the gate.
          if (calls > 1) await refreshGate.promise;
          return { ...base, openPipelineValue: 100 + calls };
        },
      });
      const second = taggedAggregatesProvider(999);

      const { result, rerender } = renderHook(
        ({ provider, scope }: { provider: DataProvider; scope: ForecastScope }) =>
          useForecastSummary(provider, scope),
        { initialProps: { provider: first, scope: baseScope } },
      );
      await waitFor(() => expect(result.current.data?.openPipelineValue).toBe(101));

      // An edit starts a refresh on the first provider…
      rerender({
        provider: first,
        scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 5 } } },
      });
      await waitFor(() => expect(calls).toBe(2));
      // …and the provider is switched before the refresh answers.
      rerender({
        provider: second,
        scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 5 } } },
      });
      await waitFor(() => expect(result.current.data?.openPipelineValue).toBe(999));

      // The abandoned refresh lands late and changes nothing.
      await act(async () => {
        refreshGate.resolve(undefined);
      });
      expect(result.current.data?.openPipelineValue).toBe(999);
    });
  });

  describe('usePartnerNames', () => {
    it('falls back to ids on a provider change and ignores the late directory', async () => {
      const first = stubProvider({
        getPartnerDirectory: async () => [{ id: 'partner-1', name: 'FIRST partner' }],
      });
      const secondGate = deferred<void>();
      const second = stubProvider({
        getPartnerDirectory: async () => {
          await secondGate.promise;
          return [{ id: 'partner-1', name: 'SECOND partner' }];
        },
      });

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) => usePartnerNames(provider),
        { initialProps: { provider: first } },
      );
      await waitFor(() => expect(result.current.names['partner-1']).toBe('FIRST partner'));

      rerender({ provider: second });
      // A name from another provider's directory is a cross-source label:
      // the table degrades to raw ids until the new directory arrives.
      expect(result.current.names['partner-1']).toBeUndefined();

      await act(async () => {
        secondGate.resolve();
      });
      await waitFor(() => expect(result.current.names['partner-1']).toBe('SECOND partner'));
    });
  });

  describe('useManagerBook', () => {
    // Two managers with disjoint books: pm-1 owns partner-1's deals, pm-2 owns
    // partner-2's, so a page can never be mistaken for the other manager's.
    const book = makeProviderBook({
      partners: [
        makePartner({ id: 'partner-1', partnerManagerId: 'pm-1' }),
        makePartner({ id: 'partner-2', partnerManagerId: 'pm-2' }),
      ],
      opportunities: [
        makeOpportunity({ id: 'opp-1', expectedCloseDate: '2026-08-10T00:00:00.000Z' }),
        makeOpportunity({ id: 'opp-2', expectedCloseDate: '2026-08-20T00:00:00.000Z' }),
        makeOpportunity({
          id: 'opp-pm2',
          partnerId: 'partner-2',
          expectedCloseDate: '2026-08-15T00:00:00.000Z',
        }),
      ],
    });

    it("never shows one manager's rows under another manager while the page loads", async () => {
      const gates = new Map<string, ReturnType<typeof deferred<void>>>();
      const provider = stubProvider({
        listQuarterOpportunities: async (scope, page) => {
          const gate = deferred<void>();
          gates.set(scope.partnerManagerId ?? 'none', gate);
          await gate.promise;
          return new MockDataProvider(book).listQuarterOpportunities(scope, page);
        },
      });

      const { result, rerender } = renderHook(
        ({ managerId }: { managerId: string | null }) =>
          useManagerBook(provider, baseScope, managerId, 1),
        { initialProps: { managerId: 'pm-1' } },
      );
      await act(async () => {
        gates.get('pm-1')?.resolve();
      });
      await waitFor(() => expect(result.current.rows).toHaveLength(1));
      expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1']);
      expect(result.current.loading).toBe(false);

      rerender({ managerId: 'pm-2' });
      // Immediately: the previous manager's rows are gone, not stale-shown.
      expect(result.current.rows).toEqual([]);
      expect(result.current.loading).toBe(true);

      await act(async () => {
        gates.get('pm-2')?.resolve();
      });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.rows.map((row) => row.id)).toEqual(['opp-pm2']);
    });

    it('drops a page that arrives after the provider changed', async () => {
      const firstGate = deferred<void>();
      const first = stubProvider({
        listQuarterOpportunities: async (scope, page) => {
          await firstGate.promise;
          return new MockDataProvider(
            makeProviderBook({
              opportunities: [makeOpportunity({ id: 'first-provider-opp' })],
            }),
          ).listQuarterOpportunities(scope, page);
        },
      });
      const second = stubProvider({
        listQuarterOpportunities: async (scope, page) =>
          new MockDataProvider(
            makeProviderBook({
              opportunities: [makeOpportunity({ id: 'second-provider-opp' })],
            }),
          ).listQuarterOpportunities(scope, page),
      });

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) =>
          useManagerBook(provider, baseScope, 'pm-1', 5),
        { initialProps: { provider: first } },
      );

      rerender({ provider: second });
      await waitFor(() =>
        expect(result.current.rows.map((row) => row.id)).toEqual(['second-provider-opp']),
      );

      await act(async () => {
        firstGate.resolve();
      });
      expect(result.current.rows.map((row) => row.id)).toEqual(['second-provider-opp']);
    });
  });

  describe('provider probes', () => {
    it('a superseded hook request never writes state once abandoned', async () => {
      // The coordinator-level half of VAL-RES-002 lives in
      // useCommittedProvider.test.tsx ("a newer request abandons the older
      // probe"), which captures the probe AbortSignal and asserts it is
      // aborted. This pins the hook-level half: an abandoned request's late
      // resolution writes nothing, even though the provider ignored every
      // cancellation hint and resolved anyway.
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const gate = deferred<void>();
      const provider = stubProvider({
        getPartnerDirectory: async () => {
          await gate.promise;
          return [{ id: 'partner-1', name: 'STALE directory' }];
        },
      });
      const { result, unmount } = renderHook(() => usePartnerNames(provider));
      unmount();
      await act(async () => {
        gate.resolve();
      });
      expect(result.current.names['partner-1']).toBeUndefined();
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });
});
