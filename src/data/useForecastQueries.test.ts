import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import { MockDataProvider } from './mock/MockDataProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { ForecastScope } from './DataProvider';
import { useForecastAggregates, useManagerBook, usePartnerNames } from './useForecastQueries';
import { makeOpportunity, makeProviderBook } from '../test/fixtures';

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

describe('useForecastAggregates', () => {
  it('loads five aggregates and leaves the loading state behind', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const { result } = renderHook(() => useForecastAggregates(provider, baseScope));

    expect(result.current).toMatchObject({ data: null, loading: true, refreshing: true });

    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.loading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data?.groups).toHaveLength(1);
  });

  it('does not refetch when the caller rebuilds an equal scope object', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const spy = vi.spyOn(provider, 'getForecastSummary');
    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useForecastAggregates(provider, scope),
      { initialProps: baseScope },
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    const calls = spy.mock.calls.length;

    // The hazard this guards: a scope rebuilt every render is a new object
    // every render, and an effect keyed on it refetches forever — render,
    // fetch, setState, render. The hook depends on the values instead.
    rerender({ quarter, edits: { ...NO_SESSION_EDITS } });
    rerender({ quarter, edits: { ...NO_SESSION_EDITS } });
    expect(spy.mock.calls.length).toBe(calls);

    // A real edit does refetch, which is where the new figures come from.
    rerender({ quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 5 } } });
    await waitFor(() => expect(spy.mock.calls.length).toBe(calls + 1));
  });

  it('keeps the figures on screen while a refresh is in flight', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const gate = deferred<void>();
    const real = provider.getForecastSummary.bind(provider);
    vi.spyOn(provider, 'getForecastSummary').mockImplementation(async (scope) => {
      await gate.promise;
      return real(scope);
    });

    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useForecastAggregates(provider, scope),
      { initialProps: baseScope },
    );
    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    rerender({ quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 5 } } });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    // Stale beats blank: an edit must not flash the page it just changed.
    expect(result.current.data).not.toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('drops an answer that arrives after a newer request', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const real = provider.getForecastSummary.bind(provider);
    const gates = new Map<number, () => void>();
    vi.spyOn(provider, 'getForecastSummary').mockImplementation(async (scope) => {
      const amount = scope.edits?.revenueOverrides['opp-1'] ?? 0;
      const gate = deferred<void>();
      gates.set(amount, () => gate.resolve());
      await gate.promise;
      return { ...(await real({ quarter })), openPipelineValue: amount };
    });

    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useForecastAggregates(provider, scope),
      { initialProps: baseScope },
    );

    rerender({ quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 111 } } });
    rerender({ quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 999 } } });
    await waitFor(() => expect(gates.has(999)).toBe(true));

    // The newest request lands first, then the stale one arrives late.
    await act(async () => {
      gates.get(999)!();
    });
    await waitFor(() => expect(result.current.data?.summary.openPipelineValue).toBe(999));
    await act(async () => {
      gates.get(111)!();
    });
    expect(result.current.data?.summary.openPipelineValue).toBe(999);
  });

  it('reports a failure, keeps no half-built page, and recovers on retry', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const spy = vi
      .spyOn(provider, 'getWeightedForecast')
      .mockRejectedValueOnce(new Error('getWeightedForecast failed in transit (simulated)'));

    const { result } = renderHook(() => useForecastAggregates(provider, baseScope));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe('getWeightedForecast failed in transit (simulated)');
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull();
  });
});

describe('usePartnerNames', () => {
  it('maps ids to names', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const { result } = renderHook(() => usePartnerNames(provider));
    await waitFor(() => expect(result.current['partner-1']).toBe('Northwind Systems'));
  });

  it('degrades to raw ids rather than failing the table', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    vi.spyOn(provider, 'getPartnerDirectory').mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => usePartnerNames(provider));
    await waitFor(() => expect(provider.getPartnerDirectory).toHaveBeenCalled());
    expect(result.current).toEqual({});
  });
});

describe('useManagerBook', () => {
  const book = makeProviderBook({
    opportunities: [
      makeOpportunity({ id: 'opp-1', expectedCloseDate: '2026-08-10T00:00:00.000Z' }),
      makeOpportunity({ id: 'opp-2', expectedCloseDate: '2026-08-20T00:00:00.000Z' }),
      makeOpportunity({ id: 'opp-3', expectedCloseDate: '2026-09-01T00:00:00.000Z' }),
      makeOpportunity({ id: 'opp-4', expectedCloseDate: '2026-09-10T00:00:00.000Z' }),
      makeOpportunity({ id: 'opp-5', expectedCloseDate: '2026-10-01T00:00:00.000Z' }),
    ],
  });

  it('fetches nothing until a group is expanded', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result } = renderHook(() => useManagerBook(provider, baseScope, null));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ rows: [], totalCount: 0, loading: false });
  });

  it('walks the book a page at a time', async () => {
    const provider = new MockDataProvider(book);
    const { result } = renderHook(() => useManagerBook(provider, baseScope, 'pm-1', 2));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.totalCount).toBe(5);
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.hasMore).toBe(true);
    // Server-sorted by expected close, so a page is a stable slice.
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(result.current.hasMore).toBe(false);
    expect(new Set(result.current.rows.map((row) => row.id)).size).toBe(5);
  });

  it('refetches from the first page when an edit lands', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useManagerBook(provider, scope, 'pm-1', 2),
      { initialProps: baseScope },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    rerender({ quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 9 } } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    // Back to the first page: a stale page under a fresh book would read as
    // rows that no longer exist.
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.hasMore).toBe(true);
  });

  it('reports a failed page and retries it', async () => {
    const provider = new MockDataProvider(book);
    vi.spyOn(provider, 'listQuarterOpportunities').mockRejectedValueOnce(
      new Error('listQuarterOpportunities failed in transit (simulated)'),
    );
    const { result } = renderHook(() => useManagerBook(provider, baseScope, 'pm-1', 2));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toBe('listQuarterOpportunities failed in transit (simulated)');
    expect(result.current.rows).toEqual([]);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });
});
