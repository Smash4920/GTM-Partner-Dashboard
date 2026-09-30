import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import { MockDataProvider } from './mock/MockDataProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { ForecastScope } from './DataProvider';
import {
  useForecastQuality,
  useForecastSummary,
  useManagerBook,
  useManagerGroups,
  usePartnerNames,
  useWeeklySeries,
  useWeightedForecast,
} from './useForecastQueries';
import { makeOpportunity, makePartner, makeProviderBook } from '../test/fixtures';

const quarter = CURRENT_FISCAL_QUARTER;
const baseScope: ForecastScope = { quarter, edits: NO_SESSION_EDITS };

/**
 * The widget set the Forecasting view renders, composed exactly the way the
 * view composes it, so the tests observe the same independence the page has.
 */
function useForecastWidgets(provider: InstanceType<typeof MockDataProvider>, scope: ForecastScope) {
  return {
    summary: useForecastSummary(provider, scope),
    weighted: useWeightedForecast(provider, scope),
    quality: useForecastQuality(provider, scope),
    groups: useManagerGroups(provider, scope),
    weeks: useWeeklySeries(provider, scope),
    directory: usePartnerNames(provider),
  };
}

function renderWidgets(provider: InstanceType<typeof MockDataProvider>) {
  return renderHook(({ scope }: { scope: ForecastScope }) => useForecastWidgets(provider, scope), {
    initialProps: { scope: baseScope },
  });
}

async function waitForAllWidgets(
  widgets: () => ReturnType<typeof useForecastWidgets>,
): Promise<void> {
  await waitFor(() => {
    expect(widgets().summary.data).not.toBeNull();
    expect(widgets().weighted.data).not.toBeNull();
    expect(widgets().quality.data).not.toBeNull();
    expect(widgets().groups.data).not.toBeNull();
    expect(widgets().weeks.data).not.toBeNull();
  });
  await waitFor(() => expect(widgets().directory.names['partner-1']).toBeDefined());
}

describe('forecast widgets (VAL-RES-005)', () => {
  it('loads every widget to a settled state', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const { result } = renderWidgets(provider);

    expect(result.current.summary.loading).toBe(true);

    await waitForAllWidgets(() => result.current);
    expect(result.current.summary).toMatchObject({
      loading: false,
      refreshing: false,
      error: null,
    });
    expect(result.current.groups.data).toHaveLength(1);
    expect(result.current.directory.names['partner-1']).toBe('Northwind Systems');
  });

  it('does not refetch when the caller rebuilds an equal scope object', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const spy = vi.spyOn(provider, 'getForecastSummary');
    const { result, rerender } = renderWidgets(provider);
    await waitForAllWidgets(() => result.current);
    const calls = spy.mock.calls.length;

    // The hazard this guards: a scope rebuilt every render is a new object
    // every render, and an effect keyed on it refetches forever. The hooks
    // key on the values instead.
    rerender({ scope: { quarter, edits: { ...NO_SESSION_EDITS } } });
    rerender({ scope: { quarter, edits: { ...NO_SESSION_EDITS } } });
    expect(spy.mock.calls.length).toBe(calls);
  });

  it('refetches the summary — and only the summary — when the manager scope changes (VAL-DATA-001)', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');
    const weightedSpy = vi.spyOn(provider, 'getWeightedForecast');
    const { result, rerender } = renderWidgets(provider);
    await waitForAllWidgets(() => result.current);
    const summaryCalls = summarySpy.mock.calls.length;
    const weightedCalls = weightedSpy.mock.calls.length;

    // The manager is part of the summary's query key: the selection is a
    // provider input, not a client-side re-read of the org answer. The
    // quarter-level aggregates do not move.
    rerender({ scope: { ...baseScope, partnerManagerId: 'pm-1' } });
    await waitFor(() => expect(summarySpy.mock.calls.length).toBe(summaryCalls + 1));
    expect(summarySpy.mock.calls.at(-1)?.[0]).toMatchObject({ partnerManagerId: 'pm-1' });
    expect(weightedSpy.mock.calls.length).toBe(weightedCalls);

    rerender({ scope: baseScope });
    await waitFor(() => expect(summarySpy.mock.calls.length).toBe(summaryCalls + 2));
    expect(summarySpy.mock.calls.at(-1)?.[0].partnerManagerId).toBeUndefined();
  });

  it('fails one widget without disturbing its siblings, and retry repeats only that query', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const weightedSpy = vi
      .spyOn(provider, 'getWeightedForecast')
      .mockRejectedValueOnce(new Error('getWeightedForecast failed in transit (simulated)'));
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');
    const groupsSpy = vi.spyOn(provider, 'getManagerForecastGroups');

    const { result } = renderWidgets(provider);

    await waitFor(() => expect(result.current.weighted.error).not.toBeNull());
    await waitFor(() => expect(result.current.summary.data).not.toBeNull());
    await waitFor(() => expect(result.current.groups.data).not.toBeNull());

    // The failed widget is unavailable; the siblings settled successfully.
    expect(result.current.weighted).toMatchObject({
      data: null,
      loading: false,
      error: 'getWeightedForecast failed in transit (simulated)',
    });
    expect(result.current.summary.error).toBeNull();
    expect(result.current.groups.error).toBeNull();

    act(() => result.current.weighted.retry());
    await waitFor(() => expect(result.current.weighted.data).not.toBeNull());
    // Focused retry: the failed query ran again, and nothing else did.
    expect(weightedSpy).toHaveBeenCalledTimes(2);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(groupsSpy).toHaveBeenCalledTimes(1);
  });

  it('a failed partner directory degrades to opaque ids and recovers on retry', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const directorySpy = vi
      .spyOn(provider, 'getPartnerDirectory')
      .mockRejectedValueOnce(new Error('getPartnerDirectory failed in transit (simulated)'));

    const { result } = renderWidgets(provider);
    await waitFor(() => expect(result.current.directory.error).not.toBeNull());
    // Ids remain a legible fallback; the aggregates are untouched.
    expect(result.current.directory.names).toEqual({});
    await waitFor(() => expect(result.current.summary.data).not.toBeNull());
    expect(result.current.summary.error).toBeNull();

    act(() => result.current.directory.retry());
    await waitFor(() =>
      expect(result.current.directory.names['partner-1']).toBe('Northwind Systems'),
    );
    expect(directorySpy).toHaveBeenCalledTimes(2);
  });

  it('a manager book failure is independent of the aggregates', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    vi.spyOn(provider, 'listQuarterOpportunities').mockRejectedValueOnce(
      new Error('listQuarterOpportunities failed in transit (simulated)'),
    );
    const { result } = renderHook(() => ({
      widgets: useForecastWidgets(provider, baseScope),
      book: useManagerBook(provider, baseScope, 'pm-1'),
    }));

    await waitFor(() => expect(result.current.book.error).not.toBeNull());
    expect(result.current.book.rows).toEqual([]);
    await waitForAllWidgets(() => result.current.widgets);

    act(() => result.current.book.retry());
    await waitFor(() => expect(result.current.book.rows.length).toBeGreaterThan(0));
    expect(result.current.book.error).toBeNull();
  });
});

describe('edit invalidation (VAL-RES-007)', () => {
  it('a note or next-step edit refetches nothing', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');
    const weightedSpy = vi.spyOn(provider, 'getWeightedForecast');
    const qualitySpy = vi.spyOn(provider, 'getForecastQuality');
    const groupsSpy = vi.spyOn(provider, 'getManagerForecastGroups');
    const weeksSpy = vi.spyOn(provider, 'getWeeklyForecastSeries');
    const directorySpy = vi.spyOn(provider, 'getPartnerDirectory');

    const { result, rerender } = renderWidgets(provider);
    await waitForAllWidgets(() => result.current);

    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, notes: { 'opp-1': 'Called the CFO' } } },
    });
    rerender({
      scope: {
        quarter,
        edits: {
          ...NO_SESSION_EDITS,
          notes: { 'opp-1': 'Called the CFO' },
          nextSteps: { 'opp-1': 'Send the MSA' },
        },
      },
    });
    // Let any (unexpected) effect settle before counting.
    await act(async () => {});
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(weightedSpy).toHaveBeenCalledTimes(1);
    expect(qualitySpy).toHaveBeenCalledTimes(1);
    expect(groupsSpy).toHaveBeenCalledTimes(1);
    expect(weeksSpy).toHaveBeenCalledTimes(1);
    expect(directorySpy).toHaveBeenCalledTimes(1);
  });

  it('a revenue edit refetches every aggregate but not the directory', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');
    const qualitySpy = vi.spyOn(provider, 'getForecastQuality');
    const groupsSpy = vi.spyOn(provider, 'getManagerForecastGroups');
    const weeksSpy = vi.spyOn(provider, 'getWeeklyForecastSeries');
    const directorySpy = vi.spyOn(provider, 'getPartnerDirectory');

    const { result, rerender } = renderWidgets(provider);
    await waitForAllWidgets(() => result.current);

    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 5 } } },
    });
    await waitFor(() => expect(summarySpy).toHaveBeenCalledTimes(2));
    expect(qualitySpy).toHaveBeenCalledTimes(2);
    expect(groupsSpy).toHaveBeenCalledTimes(2);
    expect(weeksSpy).toHaveBeenCalledTimes(2);
    expect(directorySpy).toHaveBeenCalledTimes(1);
  });

  it('a forecast-call edit refetches the weighted forecast, quality, and series — not the summary or groups', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');
    const weightedSpy = vi.spyOn(provider, 'getWeightedForecast');
    const qualitySpy = vi.spyOn(provider, 'getForecastQuality');
    const groupsSpy = vi.spyOn(provider, 'getManagerForecastGroups');
    const weeksSpy = vi.spyOn(provider, 'getWeeklyForecastSeries');

    const { result, rerender } = renderWidgets(provider);
    await waitForAllWidgets(() => result.current);

    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, forecastCalls: { 'opp-1': 'commit' } } },
    });
    await waitFor(() => expect(weightedSpy).toHaveBeenCalledTimes(2));
    expect(qualitySpy).toHaveBeenCalledTimes(2);
    expect(weeksSpy).toHaveBeenCalledTimes(2);
    expect(summarySpy).toHaveBeenCalledTimes(1);
    expect(groupsSpy).toHaveBeenCalledTimes(1);
  });
});

describe('useManagerBook edit scoping (two-manager matrix)', () => {
  /**
   * Two open books over disjoint deals: pm-1 owns opp-1…opp-3 (page size 2,
   * so opp-3 is never loaded), pm-2 owns opp-9. An edit must refresh exactly
   * the books whose loaded rows contain the deal — and no others.
   */
  const twoManagerBook = makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', name: 'Contoso Partners', partnerManagerId: 'pm-2' }),
    ],
    opportunities: [
      makeOpportunity({ id: 'opp-1', expectedCloseDate: '2026-08-10T00:00:00.000Z' }),
      makeOpportunity({ id: 'opp-2', expectedCloseDate: '2026-08-20T00:00:00.000Z' }),
      makeOpportunity({ id: 'opp-3', expectedCloseDate: '2026-09-01T00:00:00.000Z' }),
      makeOpportunity({
        id: 'opp-9',
        partnerId: 'partner-2',
        expectedCloseDate: '2026-08-15T00:00:00.000Z',
      }),
    ],
  });

  function renderTwoBooks(provider: MockDataProvider) {
    return renderHook(
      ({ scope }: { scope: ForecastScope }) => ({
        first: useManagerBook(provider, scope, 'pm-1', 2),
        second: useManagerBook(provider, scope, 'pm-2', 2),
      }),
      { initialProps: { scope: baseScope } },
    );
  }

  it('a revenue edit refreshes only the book whose loaded rows contain the deal', async () => {
    const provider = new MockDataProvider(twoManagerBook);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTwoBooks(provider);
    await waitFor(() => expect(result.current.first.rows).toHaveLength(2));
    await waitFor(() => expect(result.current.second.rows).toHaveLength(1));
    expect(spy).toHaveBeenCalledTimes(2);

    // opp-1 is in pm-1's loaded window: that book refreshes, pm-2's does not.
    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 9 } } },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    expect(spy.mock.calls[2]?.[0]).toMatchObject({ partnerManagerId: 'pm-1' });
    expect(spy.mock.calls[2]?.[1]).toEqual({ limit: 2 });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.current.first.rows.find((row) => row.id === 'opp-1')?.forecastedRevenue).toBe(9);
    expect(result.current.second.rows.map((row) => row.id)).toEqual(['opp-9']);
  });

  it('a forecast-call edit refreshes only the book whose loaded rows contain the deal', async () => {
    const provider = new MockDataProvider(twoManagerBook);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTwoBooks(provider);
    await waitFor(() => expect(result.current.first.rows).toHaveLength(2));
    await waitFor(() => expect(result.current.second.rows).toHaveLength(1));

    // opp-9 is in pm-2's loaded window: that book refreshes, pm-1's does not.
    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, forecastCalls: { 'opp-9': 'commit' } } },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    expect(spy.mock.calls[2]?.[0]).toMatchObject({ partnerManagerId: 'pm-2' });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.current.second.rows[0]?.forecastCategory).toBe('commit');
  });

  it('an edit to a deal no open book has loaded refreshes neither', async () => {
    const provider = new MockDataProvider(twoManagerBook);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTwoBooks(provider);
    await waitFor(() => expect(result.current.first.rows).toHaveLength(2));
    await waitFor(() => expect(result.current.second.rows).toHaveLength(1));

    // opp-3 belongs to pm-1 but sits on a page that was never loaded.
    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-3': 9 } } },
    });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.first.refreshing).toBe(false);
    expect(result.current.second.refreshing).toBe(false);
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

  it('a revenue edit refreshes the loaded window in place instead of resetting pages', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useManagerBook(provider, scope, 'pm-1', 2),
      { initialProps: baseScope },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    rerender({ quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 9 } } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    // One window-sized request; the loaded pages stay on screen throughout.
    expect(spy.mock.calls[2]?.[1]).toEqual({ limit: 4 });
    expect(result.current.rows).toHaveLength(4);
    expect(result.current.hasMore).toBe(true);
  });

  it('a note edit does not refetch the book; the row renders the overlay', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useManagerBook(provider, scope, 'pm-1', 2),
      { initialProps: baseScope },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    rerender({ quarter, edits: { ...NO_SESSION_EDITS, notes: { 'opp-1': 'Called the CFO' } } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.rows).toHaveLength(2);
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
