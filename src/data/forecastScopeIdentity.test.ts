import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { CURRENT_FISCAL_QUARTER } from './constants';
import type { ForecastScope, ForecastSummary } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import type { QueryResult } from './queryMetadata';
import type { QueryState } from './queryState';
import { NO_SESSION_EDITS } from './sessionEdits';
import {
  useForecastQuality,
  useForecastSummary,
  useManagerGroups,
  usePartnerNames,
  useWeeklySeries,
  useWeightedForecast,
} from './useForecastQueries';
import { makeOpportunity, makePartner, makeProviderBook, makeTarget } from '../test/fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const quarter = CURRENT_FISCAL_QUARTER;
const baseScope: ForecastScope = { quarter, edits: NO_SESSION_EDITS };
const book = makeProviderBook({
  partnerManagers: [
    { id: 'pm-1', name: 'First manager' },
    { id: 'pm-2', name: 'Second manager' },
  ],
  partners: [makePartner(), makePartner({ id: 'partner-2', partnerManagerId: 'pm-2' })],
  opportunities: [
    makeOpportunity(),
    makeOpportunity({ id: 'opp-2', partnerId: 'partner-2', forecastedRevenue: 100_000 }),
  ],
  targets: [makeTarget(), makeTarget({ partnerId: 'partner-2', revenueTarget: 200_000 })],
});

function useWidgets(
  provider: MockDataProvider,
  access: DemoAccessScope,
  scope: ForecastScope,
): Record<string, QueryState<unknown>> {
  const summary = useForecastSummary(provider, access, scope);
  const weighted = useWeightedForecast(provider, access, scope);
  const quality = useForecastQuality(provider, access, scope);
  const groups = useManagerGroups(provider, access, scope);
  const weeks = useWeeklySeries(provider, access, scope);
  const directory = usePartnerNames(provider, access);
  return {
    summary,
    weighted,
    quality,
    groups,
    weeks,
    directory: { ...directory, data: directory.meta === null ? null : directory.names },
  };
}

/**
 * Compute real provider answers before holding their delivery. Deliberately
 * ignore cancellation after computation to exercise the hook's second guard.
 */
function controlledProvider() {
  const provider = new MockDataProvider(book);
  const calls: { widget: string; signal: AbortSignal; gate: ReturnType<typeof deferred<void>> }[] =
    [];
  let hold = false;
  function wrap<Args extends unknown[], T>(
    widget: string,
    run: (...args: Args) => Promise<QueryResult<T>>,
  ) {
    return async (...args: Args) => {
      const context = args.at(-1);
      if (
        typeof context !== 'object' ||
        context === null ||
        !('signal' in context) ||
        !(context.signal instanceof AbortSignal)
      ) {
        throw new Error('Query context missing');
      }
      const answer = await run(...args);
      const gate = deferred<void>();
      calls.push({ widget, signal: context.signal, gate });
      if (hold) await gate.promise;
      return answer;
    };
  }
  Object.assign(provider, {
    getForecastSummary: wrap('summary', provider.getForecastSummary.bind(provider)),
    getWeightedForecast: wrap('weighted', provider.getWeightedForecast.bind(provider)),
    getForecastQuality: wrap('quality', provider.getForecastQuality.bind(provider)),
    getManagerForecastGroups: wrap('groups', provider.getManagerForecastGroups.bind(provider)),
    getWeeklyForecastSeries: wrap('weeks', provider.getWeeklyForecastSeries.bind(provider)),
    getPartnerDirectory: wrap('directory', provider.getPartnerDirectory.bind(provider)),
  });
  return {
    provider,
    calls,
    hold: () => {
      hold = true;
    },
  };
}

describe('Forecast scope identity (VAL-DATA-001, VAL-RES-002/006)', () => {
  it('drops prior-manager summary while the new manager fails, then recovers on retry', async () => {
    // Restored final-quality actual-provider regression, with disjoint targets.
    const provider = new MockDataProvider(book);
    const realSummary = provider.getForecastSummary.bind(provider);
    const pending = deferred<QueryResult<ForecastSummary>>();
    const spy = vi
      .spyOn(provider, 'getForecastSummary')
      .mockImplementationOnce(realSummary)
      .mockReturnValueOnce(pending.promise);
    const frames: QueryState<ForecastSummary>[] = [];
    const { result, rerender } = renderHook(
      (scope: ForecastScope) => {
        const state = useForecastSummary(provider, INTERNAL_DEMO_SCOPE, scope);
        frames.push(state);
        return state;
      },
      { initialProps: { quarter, partnerManagerId: 'pm-1' } },
    );
    await waitFor(() => expect(result.current.data?.target).toBe(500_000), { interval: 5 });
    const previous = result.current.data;
    const firstFrame = frames.length;
    rerender({ quarter, partnerManagerId: 'pm-2' });
    const whilePending = result.current;
    await act(async () => pending.reject(new Error('planned technical failure')));
    expect.soft(frames[firstFrame]).toMatchObject({
      data: null,
      meta: null,
      loading: true,
      refreshing: false,
      error: null,
    });
    expect.soft(whilePending.data).toBeNull();
    expect.soft(whilePending.meta).toBeNull();
    expect.soft(whilePending.loading).toBe(true);
    expect.soft(result.current.data).toBeNull();
    expect.soft(result.current.meta).toBeNull();
    expect.soft(result.current.data).not.toBe(previous);
    expect(result.current.error).toBe('Failed to load the forecast summary');
    expect(result.current.loading).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data?.target).toBe(200_000), { interval: 5 });
    expect(result.current.data?.openPipelineValue).toBe(100_000);
    expect(result.current.meta).not.toBeNull();
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  const identities: {
    name: string;
    access: DemoAccessScope;
    scope: ForecastScope;
    affected: string[];
  }[] = [
    {
      name: 'manager',
      access: INTERNAL_DEMO_SCOPE,
      scope: { ...baseScope, partnerManagerId: 'pm-2' },
      affected: ['summary'],
    },
    {
      name: 'quarter',
      access: INTERNAL_DEMO_SCOPE,
      scope: { ...baseScope, quarter: 'FY27-Q4' },
      affected: ['summary', 'weighted', 'quality', 'groups', 'weeks'],
    },
    {
      name: 'internal access',
      access: { audience: 'internal', partnerManagerId: 'pm-2' },
      scope: baseScope,
      affected: ['summary', 'weighted', 'quality', 'groups', 'weeks', 'directory'],
    },
    {
      name: 'partner access',
      access: { audience: 'partner', partnerId: 'partner-2' },
      scope: baseScope,
      affected: ['summary', 'weighted', 'quality', 'groups', 'weeks', 'directory'],
    },
  ];

  it.each(identities)(
    '$name gates the first frame, pending, failure and focused recovery',
    async ({ access, scope, affected }) => {
      const controlled = controlledProvider();
      const frames: ReturnType<typeof useWidgets>[] = [];
      const { result, rerender } = renderHook(
        (input: { access: DemoAccessScope; scope: ForecastScope }) => {
          const states = useWidgets(controlled.provider, input.access, input.scope);
          frames.push(states);
          return states;
        },
        { initialProps: { access: INTERNAL_DEMO_SCOPE, scope: baseScope } },
      );
      await waitFor(
        () => {
          for (const state of Object.values(result.current)) expect(state.data).not.toBeNull();
        },
        { interval: 5 },
      );
      const previous = result.current;
      controlled.hold();
      const start = controlled.calls.length;
      const firstFrame = frames.length;
      rerender({ access, scope });
      await waitFor(() => expect(controlled.calls).toHaveLength(start + affected.length), {
        interval: 5,
      });
      const pending = controlled.calls.slice(start);
      expect(pending.map((call) => call.widget).sort()).toEqual([...affected].sort());
      for (const widget of Object.keys(previous)) {
        if (affected.includes(widget)) {
          expect.soft(frames[firstFrame]?.[widget]).toMatchObject({
            data: null,
            meta: null,
            loading: true,
            refreshing: false,
            error: null,
          });
          expect.soft(result.current[widget]).toMatchObject({
            data: null,
            meta: null,
            loading: true,
            refreshing: false,
            error: null,
          });
          if (widget === 'directory') {
            expect(frames[firstFrame]?.[widget]).toMatchObject({ names: {} });
            expect(result.current[widget]).toMatchObject({ names: {} });
          }
        } else {
          expect(result.current[widget]?.data).toBe(previous[widget]?.data);
          expect(result.current[widget]?.meta).toBe(previous[widget]?.meta);
        }
      }
      await act(async () => {
        for (const call of pending) call.gate.reject(new Error('planned failure'));
      });
      for (const widget of affected) {
        expect.soft(result.current[widget]).toMatchObject({
          data: null,
          meta: null,
          loading: false,
          refreshing: false,
        });
        expect(result.current[widget]?.error).not.toBeNull();
        const retryStart = controlled.calls.length;
        act(() => result.current[widget]?.retry());
        await waitFor(() => expect(controlled.calls).toHaveLength(retryStart + 1), { interval: 5 });
        expect(controlled.calls.at(-1)?.widget).toBe(widget);
        await act(async () => controlled.calls.at(-1)?.gate.resolve());
        expect(result.current[widget]?.data).not.toBeNull();
        expect(result.current[widget]?.meta).not.toBeNull();
        expect(result.current[widget]?.error).toBeNull();
      }
    },
  );

  it.each(
    identities.flatMap((identity) =>
      ['answer', 'failure'].map((lateOutcome) => ({ ...identity, lateOutcome })),
    ),
  )(
    '$name cancels obsolete delivery and ignores a late $lateOutcome',
    async ({ access, scope, affected, lateOutcome }) => {
      const controlled = controlledProvider();
      controlled.hold();
      const { result, rerender, unmount } = renderHook(
        (input: { access: DemoAccessScope; scope: ForecastScope }) =>
          useWidgets(controlled.provider, input.access, input.scope),
        { initialProps: { access: INTERNAL_DEMO_SCOPE, scope: baseScope } },
      );
      await waitFor(() => expect(controlled.calls).toHaveLength(6), { interval: 5 });
      const initial = controlled.calls.slice();
      rerender({ access, scope });
      await waitFor(() => expect(controlled.calls).toHaveLength(6 + affected.length), {
        interval: 5,
      });
      for (const call of initial) expect(call.signal.aborted).toBe(affected.includes(call.widget));
      await act(async () => {
        for (const call of controlled.calls.slice(6)) call.gate.resolve();
        for (const call of initial.filter((call) => !affected.includes(call.widget)))
          call.gate.resolve();
      });
      const current = result.current;
      await act(async () => {
        for (const call of initial.filter((call) => affected.includes(call.widget))) {
          if (lateOutcome === 'answer') call.gate.resolve();
          else call.gate.reject(new Error('ignored late failure'));
        }
      });
      for (const widget of affected) {
        expect(current[widget]?.data).not.toBeNull();
        expect(current[widget]?.meta).not.toBeNull();
        expect(result.current[widget]?.data).toBe(current[widget]?.data);
        expect(result.current[widget]?.meta).toBe(current[widget]?.meta);
        expect(result.current[widget]?.error).toBeNull();
      }
      unmount();
      expect(controlled.calls.every((call) => call.signal.aborted)).toBe(true);
    },
  );

  it('revenue refresh and failure retain same-scope data and metadata for every aggregate', async () => {
    const controlled = controlledProvider();
    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useWidgets(controlled.provider, INTERNAL_DEMO_SCOPE, scope),
      { initialProps: baseScope },
    );
    await waitFor(
      () => {
        for (const state of Object.values(result.current)) expect(state.data).not.toBeNull();
      },
      { interval: 5 },
    );
    const previous = result.current;
    controlled.hold();
    rerender({
      ...baseScope,
      edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 700_000 } },
    });
    await waitFor(() => expect(controlled.calls).toHaveLength(11), { interval: 5 });
    const pending = controlled.calls.slice(6);
    expect(pending.map((call) => call.widget).sort()).toEqual([
      'groups',
      'quality',
      'summary',
      'weeks',
      'weighted',
    ]);
    for (const call of pending) {
      expect(result.current[call.widget]?.data).toBe(previous[call.widget]?.data);
      expect(result.current[call.widget]?.meta).toBe(previous[call.widget]?.meta);
      expect(result.current[call.widget]?.refreshing).toBe(true);
    }
    await act(async () => {
      for (const call of pending) call.gate.reject(new Error('refresh failed'));
    });
    for (const call of pending) {
      expect(result.current[call.widget]?.data).toBe(previous[call.widget]?.data);
      expect(result.current[call.widget]?.meta).toBe(previous[call.widget]?.meta);
      expect(result.current[call.widget]?.error).not.toBeNull();
    }
    expect(result.current.directory?.error).toBeNull();
    const retryStart = controlled.calls.length;
    act(() => result.current.summary?.retry());
    await waitFor(() => expect(controlled.calls).toHaveLength(retryStart + 1), { interval: 5 });
    expect(controlled.calls.at(-1)?.widget).toBe('summary');
    await act(async () => controlled.calls.at(-1)?.gate.resolve());
    expect(result.current.summary?.data).not.toBe(previous.summary?.data);
    expect(result.current.summary?.data).toMatchObject({ openPipelineValue: 800_000 });
    expect(result.current.summary?.error).toBeNull();
  });
});
