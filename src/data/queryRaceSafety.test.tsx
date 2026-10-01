import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER, SNAPSHOT_DATE } from './constants';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import type { QueryContext } from './queryContext';
import { buildQueryMeta, queryResult } from './queryMetadata';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { ForecastScope } from './DataProvider';
import type { PartnerRef } from './DataProvider';
import { useForecastSummary, useManagerBook, usePartnerNames } from './useForecastQueries';
import { makeOpportunity, makePartner, makeProviderBook } from '../test/fixtures';
import { INTERNAL_DEMO_SCOPE } from './accessScope';

/**
 * VAL-RES-002: abort and generation checks reject obsolete results.
 *
 * Every request's AbortSignal now reaches the provider through the query
 * context, so obsolete work is cancelled at the seam — and the hooks still
 * carry the guard that matters for a provider that ignores its signal: a
 * result is written only while its request is still the newest one for the
 * provider that is still committed. Every test here resolves promises out of
 * order with provider-tagged values and asserts the hook's output only ever
 * shows the newest generation's tag.
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

/** A partner-directory answer wrapped the way the scoped contract wraps everything. */
async function directoryResult(partners: PartnerRef[]) {
  return queryResult(
    partners,
    buildQueryMeta({
      providerId: 'local',
      asOf: SNAPSHOT_DATE.toISOString(),
      lineage: [],
    }),
  );
}

/** An aggregates-serving provider whose summary carries a visible tag. */
function taggedAggregatesProvider(tag: number, gate?: () => Promise<unknown>): DataProvider {
  return stubProvider({
    getForecastSummary: async (_access, scope) => {
      if (gate) await gate();
      const { data: base, meta } = await new MockDataProvider(
        makeProviderBook(),
      ).getForecastSummary(INTERNAL_DEMO_SCOPE, scope);
      return { data: { ...base, openPipelineValue: tag }, meta };
    },
  });
}

describe('VAL-RES-002 query race safety', () => {
  describe('useForecastSummary', () => {
    it("shows no prior-provider aggregates while the new provider's first answer is in flight", async () => {
      const first = taggedAggregatesProvider(111);
      const secondGate = deferred<unknown>();
      const second = taggedAggregatesProvider(222, () => secondGate.promise);

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) =>
          useForecastSummary(provider, INTERNAL_DEMO_SCOPE, baseScope),
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
        getForecastSummary: async (_access, scope) => {
          calls += 1;
          const { data: base, meta } = await new MockDataProvider(
            makeProviderBook(),
          ).getForecastSummary(INTERNAL_DEMO_SCOPE, scope);
          // The first load lands immediately; the refresh waits on the gate.
          if (calls > 1) await refreshGate.promise;
          return { data: { ...base, openPipelineValue: 100 + calls }, meta };
        },
      });
      const second = taggedAggregatesProvider(999);

      const { result, rerender } = renderHook(
        ({ provider, scope }: { provider: DataProvider; scope: ForecastScope }) =>
          useForecastSummary(provider, INTERNAL_DEMO_SCOPE, scope),
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
        getPartnerDirectory: async () =>
          directoryResult([{ id: 'partner-1', name: 'FIRST partner' }]),
      });
      const secondGate = deferred<void>();
      const second = stubProvider({
        getPartnerDirectory: async () => {
          await secondGate.promise;
          return directoryResult([{ id: 'partner-1', name: 'SECOND partner' }]);
        },
      });

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) =>
          usePartnerNames(provider, INTERNAL_DEMO_SCOPE),
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
        listQuarterOpportunities: async (_access, scope, page) => {
          const gate = deferred<void>();
          gates.set(scope.partnerManagerId ?? 'none', gate);
          await gate.promise;
          return new MockDataProvider(book).listQuarterOpportunities(
            INTERNAL_DEMO_SCOPE,
            scope,
            page,
          );
        },
      });

      const { result, rerender } = renderHook(
        ({ managerId }: { managerId: string | null }) =>
          useManagerBook(provider, INTERNAL_DEMO_SCOPE, baseScope, managerId, 1),
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
        listQuarterOpportunities: async (_access, scope, page) => {
          await firstGate.promise;
          return new MockDataProvider(
            makeProviderBook({
              opportunities: [makeOpportunity({ id: 'first-provider-opp' })],
            }),
          ).listQuarterOpportunities(INTERNAL_DEMO_SCOPE, scope, page);
        },
      });
      const second = stubProvider({
        listQuarterOpportunities: async (_access, scope, page) =>
          new MockDataProvider(
            makeProviderBook({
              opportunities: [makeOpportunity({ id: 'second-provider-opp' })],
            }),
          ).listQuarterOpportunities(INTERNAL_DEMO_SCOPE, scope, page),
      });

      const { result, rerender } = renderHook(
        ({ provider }: { provider: DataProvider }) =>
          useManagerBook(provider, INTERNAL_DEMO_SCOPE, baseScope, 'pm-1', 5),
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
      // aborted. This pins the hook-level half: the abandoned request's
      // signal is aborted for providers that honour it, and its late
      // resolution writes nothing even though this provider ignored the
      // signal and resolved anyway.
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const gate = deferred<void>();
      const contexts: QueryContext[] = [];
      const provider = stubProvider({
        getPartnerDirectory: async (_access, context) => {
          if (context !== undefined) contexts.push(context);
          await gate.promise;
          return directoryResult([{ id: 'partner-1', name: 'STALE directory' }]);
        },
      });
      const { result, unmount } = renderHook(() => usePartnerNames(provider, INTERNAL_DEMO_SCOPE));
      await waitFor(() => expect(contexts).toHaveLength(1));
      unmount();
      expect(contexts[0]?.signal?.aborted).toBe(true);
      await act(async () => {
        gate.resolve();
      });
      expect(result.current.names['partner-1']).toBeUndefined();
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });
});
