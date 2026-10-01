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
import { INTERNAL_DEMO_SCOPE } from './accessScope';

const quarter = CURRENT_FISCAL_QUARTER;
const baseScope: ForecastScope = { quarter, edits: NO_SESSION_EDITS };

/**
 * The widget set the Forecasting view renders, composed exactly the way the
 * view composes it, so the tests observe the same independence the page has.
 */
function useForecastWidgets(provider: InstanceType<typeof MockDataProvider>, scope: ForecastScope) {
  return {
    summary: useForecastSummary(provider, INTERNAL_DEMO_SCOPE, scope),
    weighted: useWeightedForecast(provider, INTERNAL_DEMO_SCOPE, scope),
    quality: useForecastQuality(provider, INTERNAL_DEMO_SCOPE, scope),
    groups: useManagerGroups(provider, INTERNAL_DEMO_SCOPE, scope),
    weeks: useWeeklySeries(provider, INTERNAL_DEMO_SCOPE, scope),
    directory: usePartnerNames(provider, INTERNAL_DEMO_SCOPE),
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
    expect(summarySpy.mock.calls.at(-1)?.[1]).toMatchObject({ partnerManagerId: 'pm-1' });
    expect(weightedSpy.mock.calls.length).toBe(weightedCalls);

    rerender({ scope: baseScope });
    await waitFor(() => expect(summarySpy.mock.calls.length).toBe(summaryCalls + 2));
    expect(summarySpy.mock.calls.at(-1)?.[1].partnerManagerId).toBeUndefined();
  });

  it('fails one widget without disturbing its siblings, and retry repeats only that query', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const weightedSpy = vi
      .spyOn(provider, 'getWeightedForecast')
      .mockRejectedValueOnce(new Error('RAW SENTINEL: weighted aggregation blew up internally'));
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');
    const groupsSpy = vi.spyOn(provider, 'getManagerForecastGroups');

    const { result } = renderWidgets(provider);

    await waitFor(() => expect(result.current.weighted.error).not.toBeNull());
    await waitFor(() => expect(result.current.summary.data).not.toBeNull());
    await waitFor(() => expect(result.current.groups.data).not.toBeNull());

    // The failed widget is unavailable with its stable operation copy —
    // never the rejection's own prose; the siblings settled successfully.
    expect(result.current.weighted).toMatchObject({
      data: null,
      loading: false,
      error: 'Failed to load the weighted forecast',
    });
    expect(result.current.weighted.error).not.toContain('RAW SENTINEL');
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
      .mockRejectedValueOnce(new Error('RAW SENTINEL: directory store internal detail'));

    const { result } = renderWidgets(provider);
    await waitFor(() => expect(result.current.directory.error).not.toBeNull());
    // Stable copy, no raw prose; the meta stays null while nothing answered.
    expect(result.current.directory.error).toBe('Failed to load the partner directory');
    expect(result.current.directory.meta).toBeNull();
    // Ids remain a legible fallback; the aggregates are untouched.
    expect(result.current.directory.names).toEqual({});
    await waitFor(() => expect(result.current.summary.data).not.toBeNull());
    expect(result.current.summary.error).toBeNull();

    act(() => result.current.directory.retry());
    await waitFor(() =>
      expect(result.current.directory.names['partner-1']).toBe('Northwind Systems'),
    );
    expect(directorySpy).toHaveBeenCalledTimes(2);
    // The recovered answer brings its envelope with it.
    expect(result.current.directory.error).toBeNull();
    expect(result.current.directory.meta).toMatchObject({
      providerId: 'local',
      completeness: 'complete',
    });
  });

  it('preserves the directory envelope: provider, as-of, completeness, and warnings survive the name mapping', async () => {
    // A legal partial directory answer: usable names plus a typed warning.
    // The mapping to id → name must not drop the metadata that says the
    // answer is partial.
    const provider = new MockDataProvider(makeProviderBook());
    const realDirectory = provider.getPartnerDirectory.bind(provider);
    vi.spyOn(provider, 'getPartnerDirectory').mockImplementation(async (context) => {
      const result = await realDirectory(context);
      return {
        ...result,
        meta: {
          ...result.meta,
          completeness: 'partial' as const,
          warnings: [
            {
              code: 'unattributed-opportunities' as const,
              message: '1 partner could not be attributed and is missing from the directory',
            },
          ],
        },
      };
    });

    const { result } = renderHook(() => usePartnerNames(provider, INTERNAL_DEMO_SCOPE));

    await waitFor(() => expect(result.current.names['partner-1']).toBe('Northwind Systems'));
    expect(result.current.meta).toMatchObject({
      providerId: 'local',
      completeness: 'partial',
    });
    expect(typeof result.current.meta?.asOf).toBe('string');
    expect(result.current.meta?.lineage.length).toBeGreaterThan(0);
    expect(result.current.meta?.warnings).toEqual([
      {
        code: 'unattributed-opportunities',
        message: '1 partner could not be attributed and is missing from the directory',
      },
    ]);
    expect(result.current.error).toBeNull();
  });

  it('a manager book failure is independent of the aggregates', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    vi.spyOn(provider, 'listQuarterOpportunities').mockRejectedValueOnce(
      new Error('listQuarterOpportunities failed in transit (simulated)'),
    );
    const { result } = renderHook(() => ({
      widgets: useForecastWidgets(provider, baseScope),
      book: useManagerBook(provider, INTERNAL_DEMO_SCOPE, baseScope, 'pm-1'),
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
        first: useManagerBook(provider, INTERNAL_DEMO_SCOPE, scope, 'pm-1', 2),
        second: useManagerBook(provider, INTERNAL_DEMO_SCOPE, scope, 'pm-2', 2),
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
    expect(spy.mock.calls[2]?.[1]).toMatchObject({ partnerManagerId: 'pm-1' });
    expect(spy.mock.calls[2]?.[2]).toEqual({ limit: 2 });
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
    expect(spy.mock.calls[2]?.[1]).toMatchObject({ partnerManagerId: 'pm-2' });
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

  it('an edit to the other book neither aborts nor refetches a book mid-load-more', async () => {
    const provider = new MockDataProvider(twoManagerBook);
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const pm1Signals: (AbortSignal | undefined)[] = [];
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page, context) => {
        if (scope.partnerManagerId === 'pm-1') pm1Signals.push(context?.signal);
        return (async () => {
          // Hold pm-1's page fetch; every other call answers normally.
          if (scope.partnerManagerId === 'pm-1' && page.cursor !== undefined) await gate;
          return real(access, scope, page, context);
        })();
      });
    const { result, rerender } = renderTwoBooks(provider);
    await waitFor(() => expect(result.current.first.rows).toHaveLength(2));
    await waitFor(() => expect(result.current.second.rows).toHaveLength(1));

    act(() => result.current.first.loadMore());
    await waitFor(() => expect(result.current.first.loadingMore).toBe(true));
    expect(spy).toHaveBeenCalledTimes(3);

    // The edit lands in pm-2's loaded window while pm-1's page is flying:
    // pm-2 refreshes, pm-1's page keeps its signal, its cursor, its state.
    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-9': 9 } } },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(4));
    expect(spy.mock.calls[3]?.[1]).toMatchObject({ partnerManagerId: 'pm-2' });
    expect(pm1Signals[1]?.aborted).toBe(false);
    expect(result.current.first.loadingMore).toBe(true);
    expect(result.current.first.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);

    // And pm-1's page still lands, unbothered.
    await act(async () => {
      resolveGate();
    });
    await waitFor(() => expect(result.current.first.rows).toHaveLength(3));
    expect(result.current.first.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2', 'opp-3']);
    expect(result.current.first.error).toBeNull();
    // pm-1 saw exactly its initial load and its page — never a refetch.
    expect(spy.mock.calls.filter((call) => call[1].partnerManagerId === 'pm-1')).toHaveLength(2);
  });

  it('a relevant edit supersedes a book’s in-flight page while the other book is untouched', async () => {
    const provider = new MockDataProvider(twoManagerBook);
    let resolveGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const pm1Signals: (AbortSignal | undefined)[] = [];
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page, context) => {
        if (scope.partnerManagerId === 'pm-1') pm1Signals.push(context?.signal);
        return (async () => {
          if (scope.partnerManagerId === 'pm-1' && page.cursor !== undefined) await gate;
          return real(access, scope, page, context);
        })();
      });
    const { result, rerender } = renderTwoBooks(provider);
    await waitFor(() => expect(result.current.first.rows).toHaveLength(2));
    await waitFor(() => expect(result.current.second.rows).toHaveLength(1));

    act(() => result.current.first.loadMore());
    await waitFor(() => expect(result.current.first.loadingMore).toBe(true));

    // opp-1 is on pm-1's screen: its edit supersedes the in-flight page —
    // cancelled at the seam, the window refetched with the edit — while
    // pm-2's settled book is not touched at all.
    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 7 } } },
    });
    await waitFor(() => expect(result.current.first.refreshing).toBe(true));
    expect(pm1Signals[1]?.aborted).toBe(true);
    expect(result.current.first.loadingMore).toBe(false);
    await waitFor(() => expect(result.current.first.refreshing).toBe(false));
    expect(spy.mock.calls[3]?.[1]).toMatchObject({ partnerManagerId: 'pm-1' });
    expect(spy.mock.calls[3]?.[2]).toEqual({ limit: 2 });
    expect(result.current.first.rows.find((row) => row.id === 'opp-1')?.forecastedRevenue).toBe(7);

    // The superseded page's late answer appends nothing, and pm-2 issued
    // exactly its initial load throughout.
    await act(async () => {
      resolveGate();
    });
    expect(result.current.first.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);
    expect(spy.mock.calls.filter((call) => call[1].partnerManagerId === 'pm-2')).toHaveLength(1);
  });

  it('an edit to the other book neither refetches nor clears a book’s retained page failure', async () => {
    const provider = new MockDataProvider(twoManagerBook);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTwoBooks(provider);
    await waitFor(() => expect(result.current.first.rows).toHaveLength(2));
    await waitFor(() => expect(result.current.second.rows).toHaveLength(1));

    // pm-1's next page fails; its loaded rows and the failure stay.
    spy.mockRejectedValueOnce(new Error('RAW SENTINEL: cursor store offline'));
    act(() => result.current.first.loadMore());
    await waitFor(() =>
      expect(result.current.first.error).toBe('Failed to load more of this book'),
    );
    expect(spy).toHaveBeenCalledTimes(3);

    // The edit belongs to pm-2's book: pm-1 must not refetch, clear, or
    // retry on its retained failure — pm-2's refresh is the only new call.
    rerender({
      scope: { quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-9': 9 } } },
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(4));
    expect(spy.mock.calls[3]?.[1]).toMatchObject({ partnerManagerId: 'pm-2' });
    await act(async () => {});
    expect(spy.mock.calls.filter((call) => call[1].partnerManagerId === 'pm-1')).toHaveLength(2);
    expect(result.current.first.error).toBe('Failed to load more of this book');
    expect(result.current.first.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);

    // pm-1's explicit Retry still repeats exactly the page it owes.
    act(() => result.current.first.retry());
    await waitFor(() => expect(result.current.first.rows).toHaveLength(3));
    expect(result.current.first.error).toBeNull();
    const pm1Calls = spy.mock.calls.filter((call) => call[1].partnerManagerId === 'pm-1');
    expect(pm1Calls).toHaveLength(3);
    const firstPage = await spy.mock.results[0]!.value;
    expect(pm1Calls[2]?.[2]).toEqual({ cursor: firstPage.data.nextCursor, limit: 2 });
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
    const { result } = renderHook(() =>
      useManagerBook(provider, INTERNAL_DEMO_SCOPE, baseScope, null),
    );
    expect(spy).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ rows: [], totalCount: 0, loading: false });
  });

  it('walks the book a page at a time', async () => {
    const provider = new MockDataProvider(book);
    const { result } = renderHook(() =>
      useManagerBook(provider, INTERNAL_DEMO_SCOPE, baseScope, 'pm-1', 2),
    );

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
      (scope: ForecastScope) => useManagerBook(provider, INTERNAL_DEMO_SCOPE, scope, 'pm-1', 2),
      { initialProps: baseScope },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    rerender({ quarter, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 9 } } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    // One window-sized request; the loaded pages stay on screen throughout.
    expect(spy.mock.calls[2]?.[2]).toEqual({ limit: 4 });
    expect(result.current.rows).toHaveLength(4);
    expect(result.current.hasMore).toBe(true);
  });

  it('a note edit does not refetch the book; the row renders the overlay', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderHook(
      (scope: ForecastScope) => useManagerBook(provider, INTERNAL_DEMO_SCOPE, scope, 'pm-1', 2),
      { initialProps: baseScope },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    rerender({ quarter, edits: { ...NO_SESSION_EDITS, notes: { 'opp-1': 'Called the CFO' } } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.rows).toHaveLength(2);
  });

  it('reports a failed page with stable copy and retries it', async () => {
    const provider = new MockDataProvider(book);
    vi.spyOn(provider, 'listQuarterOpportunities').mockRejectedValueOnce(
      new Error('RAW SENTINEL: listQuarterOpportunities blew up internally'),
    );
    const { result } = renderHook(() =>
      useManagerBook(provider, INTERNAL_DEMO_SCOPE, baseScope, 'pm-1', 2),
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    // Stable operation-specific copy, never the rejection's own prose.
    expect(result.current.error).toBe('Failed to load this manager’s book');
    expect(result.current.error).not.toContain('RAW SENTINEL');
    expect(result.current.rows).toEqual([]);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });
});
