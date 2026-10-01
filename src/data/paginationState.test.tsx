import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import type { PageRequest } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { usePaginatedRows } from './paginationState';
import type { QueryContext } from './queryContext';
import { editMapKey } from './queryState';
import { makeOpportunity, makeProviderBook } from '../test/fixtures';
import type { Opportunity } from './types';
import { INTERNAL_DEMO_SCOPE } from './accessScope';

/**
 * VAL-RES-006 pagination semantics: cursor walks without duplicates,
 * concurrent load-more coalescing, failed pages retaining loaded rows,
 * in-place window refreshes, membership resets, and silent aborts.
 */

const quarter = CURRENT_FISCAL_QUARTER;

/** Five in-quarter deals with a stable close-date order: pages are slices. */
const book = makeProviderBook({
  opportunities: [
    makeOpportunity({ id: 'opp-1', expectedCloseDate: '2026-08-10T00:00:00.000Z' }),
    makeOpportunity({ id: 'opp-2', expectedCloseDate: '2026-08-20T00:00:00.000Z' }),
    makeOpportunity({ id: 'opp-3', expectedCloseDate: '2026-09-01T00:00:00.000Z' }),
    makeOpportunity({ id: 'opp-4', expectedCloseDate: '2026-09-10T00:00:00.000Z' }),
    makeOpportunity({ id: 'opp-5', expectedCloseDate: '2026-10-01T00:00:00.000Z' }),
  ],
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HarnessProps {
  enabled: boolean;
  resetKey: string;
  refreshKey: string;
}

function renderRows(
  provider: MockDataProvider,
  initialProps: HarnessProps = { enabled: true, resetKey: 'pm-1', refreshKey: 'rev:' },
) {
  return renderHook(
    ({ enabled, resetKey, refreshKey }: HarnessProps) =>
      usePaginatedRows<Opportunity>({
        provider,
        enabled,
        resetKey,
        refreshKey,
        pageSize: 2,
        fetchPage: (page: PageRequest, context: QueryContext) =>
          provider.listQuarterOpportunities(
            INTERNAL_DEMO_SCOPE,
            { quarter, partnerManagerId: 'pm-1' },
            page,
            context,
          ),
        errorFallback: 'Failed to load this book',
        loadMoreErrorFallback: 'Failed to load more of this book',
      }),
    { initialProps },
  );
}

describe('usePaginatedRows', () => {
  it('walks the collection a page at a time with no duplicate rows', async () => {
    const provider = new MockDataProvider(book);
    const { result } = renderRows(provider);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);
    expect(result.current.totalCount).toBe(5);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(5));

    expect(result.current.hasMore).toBe(false);
    expect(new Set(result.current.rows.map((row) => row.id)).size).toBe(5);
  });

  it('fetches nothing while disabled', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result } = renderRows(provider, { enabled: false, resetKey: 'none', refreshKey: '' });

    expect(spy).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({
      rows: [],
      loading: false,
      error: null,
      hasMore: false,
    });
  });

  it('coalesces concurrent load-more calls into a single request per cursor', async () => {
    const provider = new MockDataProvider(book);
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page) =>
        (async () => {
          if (page.cursor !== undefined) await gate.promise;
          return real(access, scope, page);
        })(),
      );
    const { result } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    // Three clicks land while the first page-two request is still in flight.
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
      result.current.loadMore();
    });
    expect(result.current.loadingMore).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);

    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(spy).toHaveBeenCalledTimes(2);
    expect(new Set(result.current.rows.map((row) => row.id)).size).toBe(4);
  });

  it('a failed page keeps the loaded rows, and retry repeats that page only', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    // The sentinel stands in for raw provider prose: the state must carry
    // the stable load-more copy, never the rejection's own message.
    spy.mockRejectedValueOnce(new Error('RAW SENTINEL: cursor store offline'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe('Failed to load more of this book'));
    expect(result.current.error).not.toContain('RAW SENTINEL');
    // The loaded pages stay exactly as they were.
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);
    expect(result.current.loadingMore).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.error).toBeNull();
    // The retry repeated the failed page request — same cursor, same limit —
    // and issued no other call. The cursor is opaque; what matters is that
    // it is exactly the continuation the first page handed out.
    expect(spy).toHaveBeenCalledTimes(3);
    const firstPage = await spy.mock.results[0]!.value;
    expect(firstPage.data.nextCursor).toEqual(expect.any(String));
    expect(spy.mock.calls[2]?.[2]).toEqual({ cursor: firstPage.data.nextCursor, limit: 2 });
  });

  it('a data change refreshes the loaded window in place instead of resetting pages', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    rerender({ enabled: true, resetKey: 'pm-1', refreshKey: 'rev:opp-1=9' });
    // One window-sized request, not a restart from page one.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    expect(spy.mock.calls[2]?.[2]).toEqual({ limit: 4 });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    // The pages already on screen survive intact: same ids, same order.
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2', 'opp-3', 'opp-4']);
    expect(result.current.hasMore).toBe(true);

    // The cursor survived too: the next page continues where the window ends.
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    const refreshed = await spy.mock.results[2]!.value;
    expect(spy.mock.calls[3]?.[2]).toEqual({ cursor: refreshed.data.nextCursor, limit: 2 });
  });

  it('a failed window refresh keeps the loaded rows and recovers on retry', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    spy.mockRejectedValueOnce(new Error('RAW SENTINEL: snapshot segment unreadable'));
    rerender({ enabled: true, resetKey: 'pm-1', refreshKey: 'rev:opp-1=9' });
    // Stable operation-specific copy, never the rejection's own prose.
    await waitFor(() => expect(result.current.error).toBe('Failed to load this book'));
    expect(result.current.error).not.toContain('RAW SENTINEL');
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2', 'opp-3', 'opp-4']);
    expect(result.current.refreshing).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.rows).toHaveLength(4);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls[3]?.[2]).toEqual({ limit: 4 });
  });

  it('a membership change resets to the first page', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    rerender({ enabled: true, resetKey: 'pm-2', refreshKey: 'rev:' });
    // Immediately: the previous membership's rows are gone, not stale-shown.
    expect(result.current.rows).toEqual([]);
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(2);
    expect(spy.mock.calls[2]?.[2]).toEqual({ limit: 2 });
  });

  it('drops a page that arrives after the membership changed', async () => {
    const provider = new MockDataProvider(book);
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    vi.spyOn(provider, 'listQuarterOpportunities').mockImplementation((access, scope, page) =>
      (async () => {
        if (page.cursor !== undefined) await gate.promise;
        return real(access, scope, page);
      })(),
    );
    const { result, rerender } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    rerender({ enabled: true, resetKey: 'pm-2', refreshKey: 'rev:' });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.loadingMore).toBe(false);

    // The abandoned page lands late and changes nothing.
    await act(async () => {
      gate.resolve();
    });
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('an aborted first page writes nothing and logs nothing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const provider = new MockDataProvider(book);
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    vi.spyOn(provider, 'listQuarterOpportunities').mockImplementation((access, scope, page) =>
      (async () => {
        await gate.promise;
        return real(access, scope, page);
      })(),
    );
    const { result, unmount } = renderRows(provider);
    unmount();
    await act(async () => {
      gate.resolve();
    });
    expect(result.current.rows).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe('usePaginatedRows signal propagation', () => {
  /** Captures the query context of every page request. */
  function captureContexts(provider: MockDataProvider): QueryContext[] {
    const contexts: QueryContext[] = [];
    const real = provider.listQuarterOpportunities.bind(provider);
    vi.spyOn(provider, 'listQuarterOpportunities').mockImplementation(
      (access, scope, page, context) => {
        if (context !== undefined) contexts.push(context);
        return real(access, scope, page, context);
      },
    );
    return contexts;
  }

  it('hands a live signal to the initial, load-more, and refresh requests', async () => {
    const provider = new MockDataProvider(book);
    const contexts = captureContexts(provider);
    const { result, rerender, unmount } = renderRows(provider);

    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(contexts[0]?.signal?.aborted).toBe(false);

    // Load-more is a request of its own, with its own live signal; the
    // settled initial request's signal is untouched.
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(contexts).toHaveLength(2);
    expect(contexts[0]?.signal?.aborted).toBe(false);
    expect(contexts[1]?.signal?.aborted).toBe(false);

    // The refresh supersedes the initial run's attempt: its signal aborts,
    // and the window refetch carries a fresh one.
    rerender({ enabled: true, resetKey: 'pm-1', refreshKey: 'rev:opp-1=9' });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(contexts).toHaveLength(3);
    expect(contexts[0]?.signal?.aborted).toBe(true);
    expect(contexts[2]?.signal?.aborted).toBe(false);

    unmount();
    expect(contexts[2]?.signal?.aborted).toBe(true);
  });

  it('a membership change aborts a page fetch still in flight', async () => {
    const provider = new MockDataProvider(book);
    const contexts: QueryContext[] = [];
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    vi.spyOn(provider, 'listQuarterOpportunities').mockImplementation(
      (access, scope, page, context) => {
        if (context !== undefined) contexts.push(context);
        return (async () => {
          if (page.cursor !== undefined) await gate.promise;
          return real(access, scope, page, context);
        })();
      },
    );
    const { result, rerender } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(contexts).toHaveLength(2);
    expect(contexts[1]?.signal?.aborted).toBe(false);

    rerender({ enabled: true, resetKey: 'pm-2', refreshKey: 'rev:' });
    // The abandoned page fetch is cancelled at the seam, not just ignored.
    expect(contexts[1]?.signal?.aborted).toBe(true);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    await act(async () => {
      gate.resolve();
    });
    expect(result.current.rows).toHaveLength(2);
  });
});

describe('usePaginatedRows rowEdits narrowing', () => {
  /** A tracked collection whose edits arrive as a prop, like the real book. */
  function renderTracked(provider: MockDataProvider) {
    return renderHook(
      ({ edits }: { edits: Record<string, number> }) =>
        usePaginatedRows<Opportunity>({
          provider,
          enabled: true,
          resetKey: 'pm-1',
          refreshKey: `rev:${editMapKey(edits)}`,
          pageSize: 2,
          fetchPage: (page, context) =>
            provider.listQuarterOpportunities(
              INTERNAL_DEMO_SCOPE,
              {
                quarter,
                partnerManagerId: 'pm-1',
                edits: {
                  revenueOverrides: edits,
                  notes: {},
                  nextSteps: {},
                  forecastCalls: {},
                },
              },
              page,
              context,
            ),
          rowEdits: { maps: { rev: edits }, idOf: (row) => row.id },
          errorFallback: 'Failed to load this book',
          loadMoreErrorFallback: 'Failed to load more of this book',
        }),
      { initialProps: { edits: {} as Record<string, number> } },
    );
  }

  it('an edit no loaded row contains issues no request', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    // opp-5 sits on the third page, which was never loaded.
    rerender({ edits: { 'opp-5': 9 } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);
    expect(result.current.refreshing).toBe(false);
  });

  it('an edit a loaded row contains refreshes the window in place', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    // opp-3 is on the loaded second page.
    rerender({ edits: { 'opp-3': 42_000 } });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    expect(spy.mock.calls[2]?.[2]).toEqual({ limit: 4 });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    // The window's values came back with the edit folded in.
    expect(result.current.rows.find((row) => row.id === 'opp-3')?.forecastedRevenue).toBe(42_000);
    expect(result.current.rows).toHaveLength(4);
  });

  it('a page appended after the edit already carries it, and owes no refresh', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    // The edit targets page two before page two is loaded: no refresh,
    // because no loaded row is affected.
    rerender({ edits: { 'opp-3': 42_000 } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);

    // The append fetches with the current edits, so the row lands already
    // carrying the override…
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.rows.find((row) => row.id === 'opp-3')?.forecastedRevenue).toBe(42_000);

    // …and loading it must not now trigger the refresh the earlier edit
    // skipped: the fetch-time edit values moved with the page.
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a recorded failure still retries, narrowing or not', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    // The refresh fails; the loaded rows stay, and the failure is recorded
    // as the stable copy, not the rejection's prose.
    spy.mockRejectedValueOnce(new Error('RAW SENTINEL: index segment missing'));
    rerender({ edits: { 'opp-1': 7 } });
    await waitFor(() => expect(result.current.error).toBe('Failed to load this book'));
    expect(result.current.error).not.toContain('RAW SENTINEL');
    expect(result.current.rows).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);

    // The retry repeats the failed window fetch — narrowing never swallows
    // a recorded failure, even though the edit maps have not moved since.
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(spy).toHaveBeenCalledTimes(3);
    expect(result.current.rows.find((row) => row.id === 'opp-1')?.forecastedRevenue).toBe(7);
  });

  it('an unrelated edit during the initial load neither aborts nor restarts it', async () => {
    const provider = new MockDataProvider(book);
    const contexts: QueryContext[] = [];
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page, context) => {
        if (context !== undefined) contexts.push(context);
        return (async () => {
          await gate.promise;
          return real(access, scope, page, context);
        })();
      });
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(result.current.loading).toBe(true);

    // opp-5 is in this collection but on a page nobody has asked for yet:
    // the edit does not touch the question the in-flight load is answering.
    rerender({ edits: { 'opp-5': 9 } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    expect(contexts[0]?.signal?.aborted).toBe(false);

    // The load lands as if the edit never happened; the edit is picked up
    // by whatever fetches page three, when anything does.
    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('an edit to a row in the in-flight first page refetches with the current edits', async () => {
    const provider = new MockDataProvider(book);
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page, context) =>
        (async () => {
          await gate.promise;
          return real(access, scope, page, context);
        })(),
      );
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // Nothing is loaded yet, so no loaded row can prove the edit matters —
    // but opp-1 is inside the page already flying. The answer that comes
    // back is stale before it lands, and must not become the collection.
    rerender({ edits: { 'opp-1': 42_000 } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve();
    });
    // The stale answer is discarded and the first page re-asked with the
    // edits now current.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    expect(result.current.rows.find((row) => row.id === 'opp-1')?.forecastedRevenue).toBe(42_000);
    expect(result.current.error).toBeNull();
  });

  it('an unrelated edit during a page fetch neither aborts nor refetches the book', async () => {
    const provider = new MockDataProvider(book);
    const contexts: QueryContext[] = [];
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page, context) => {
        if (context !== undefined) contexts.push(context);
        return (async () => {
          if (page.cursor !== undefined) await gate.promise;
          return real(access, scope, page, context);
        })();
      });
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));
    expect(spy).toHaveBeenCalledTimes(2);

    // opp-5 sits beyond the page in flight: no loaded or landing row is
    // affected, so the page keeps its cursor, its signal, and its answer.
    rerender({ edits: { 'opp-5': 9 } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(2);
    expect(contexts[1]?.signal?.aborted).toBe(false);
    expect(result.current.loadingMore).toBe(true);
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);

    await act(async () => {
      gate.resolve();
    });
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2', 'opp-3', 'opp-4']);
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a relevant edit during a page fetch supersedes the page with a window refresh', async () => {
    const provider = new MockDataProvider(book);
    const contexts: QueryContext[] = [];
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page, context) => {
        if (context !== undefined) contexts.push(context);
        return (async () => {
          if (page.cursor !== undefined) await gate.promise;
          return real(access, scope, page, context);
        })();
      });
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));

    // opp-1 is on screen: its edit supersedes the in-flight page — the page
    // is cancelled at the seam and the window refetches with the edit.
    rerender({ edits: { 'opp-1': 7 } });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(contexts[1]?.signal?.aborted).toBe(true);
    expect(result.current.loadingMore).toBe(false);

    await waitFor(() => expect(result.current.refreshing).toBe(false));
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2]?.[2]).toEqual({ limit: 2 });
    expect(result.current.rows.find((row) => row.id === 'opp-1')?.forecastedRevenue).toBe(7);

    // The superseded page's late answer changes nothing.
    await act(async () => {
      gate.resolve();
    });
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('an edit to a row in the in-flight page drops that page and re-asks the same cursor', async () => {
    const provider = new MockDataProvider(book);
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    const spy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((access, scope, page, context) =>
        (async () => {
          if (page.cursor !== undefined) await gate.promise;
          return real(access, scope, page, context);
        })(),
      );
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.loadingMore).toBe(true));

    // opp-3 is not loaded, so the edit skips the effect — but it is inside
    // the page already flying. The stale answer must not append.
    rerender({ edits: { 'opp-3': 21_000 } });
    await act(async () => {});

    await act(async () => {
      gate.resolve();
    });
    // The stale page is discarded and the same cursor re-asked with the
    // edits now current — one extra request, never stale rows.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    const firstPage = await spy.mock.results[0]!.value;
    expect(spy.mock.calls[2]?.[2]).toEqual({ cursor: firstPage.data.nextCursor, limit: 2 });
    expect(result.current.rows.find((row) => row.id === 'opp-3')?.forecastedRevenue).toBe(21_000);
    expect(result.current.error).toBeNull();
  });

  it('an unrelated edit while a page failure is retained keeps the error and the owed retry', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    spy.mockRejectedValueOnce(new Error('RAW SENTINEL: cursor store offline'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe('Failed to load more of this book'));
    expect(spy).toHaveBeenCalledTimes(2);

    // No loaded row contains opp-5: the edit must not refetch, clear, or
    // retry the book — the retained failure is the explicit retry's alone.
    rerender({ edits: { 'opp-5': 9 } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe('Failed to load more of this book');
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);

    // The explicit retry still repeats exactly the failed page request.
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.error).toBeNull();
    expect(spy).toHaveBeenCalledTimes(3);
    const firstPage = await spy.mock.results[0]!.value;
    expect(spy.mock.calls[2]?.[2]).toEqual({ cursor: firstPage.data.nextCursor, limit: 2 });
  });

  it('an unrelated edit while a refresh failure is retained keeps the rows, error, and owed retry', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderTracked(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    // A relevant edit's window refresh fails: the failure is retained.
    spy.mockRejectedValueOnce(new Error('RAW SENTINEL: snapshot segment unreadable'));
    rerender({ edits: { 'opp-1': 7 } });
    await waitFor(() => expect(result.current.error).toBe('Failed to load this book'));
    expect(spy).toHaveBeenCalledTimes(2);

    // Layering an unrelated edit on top changes nothing the failed refresh
    // owed: no refetch, no cleared error, no consumed retry.
    rerender({ edits: { 'opp-1': 7, 'opp-5': 9 } });
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe('Failed to load this book');
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);

    // The explicit retry still retries the owed failure, with the edits now
    // current.
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2]?.[2]).toEqual({ limit: 2 });
    expect(result.current.rows.find((row) => row.id === 'opp-1')?.forecastedRevenue).toBe(7);
  });
});
