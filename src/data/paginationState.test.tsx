import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import type { PageRequest } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { usePaginatedRows } from './paginationState';
import { makeOpportunity, makeProviderBook } from '../test/fixtures';
import type { Opportunity } from './types';

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
        fetchPage: (page: PageRequest) =>
          provider.listQuarterOpportunities({ quarter, partnerManagerId: 'pm-1' }, page),
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
    const spy = vi.spyOn(provider, 'listQuarterOpportunities').mockImplementation((scope, page) =>
      (async () => {
        if (page.cursor !== undefined) await gate.promise;
        return real(scope, page);
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

    spy.mockRejectedValueOnce(new Error('page failed in transit (simulated)'));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBe('page failed in transit (simulated)'));
    // The loaded pages stay exactly as they were.
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2']);
    expect(result.current.loadingMore).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));
    expect(result.current.error).toBeNull();
    // The retry repeated the failed page request — same cursor, same limit —
    // and issued no other call.
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2]?.[1]).toEqual({ cursor: 'offset:2', limit: 2 });
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
    expect(spy.mock.calls[2]?.[1]).toEqual({ limit: 4 });
    await waitFor(() => expect(result.current.refreshing).toBe(false));
    // The pages already on screen survive intact: same ids, same order.
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2', 'opp-3', 'opp-4']);
    expect(result.current.hasMore).toBe(true);

    // The cursor survived too: the next page continues where the window ends.
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(5));
    expect(spy.mock.calls[3]?.[1]).toEqual({ cursor: 'offset:4', limit: 2 });
  });

  it('a failed window refresh keeps the loaded rows and recovers on retry', async () => {
    const provider = new MockDataProvider(book);
    const spy = vi.spyOn(provider, 'listQuarterOpportunities');
    const { result, rerender } = renderRows(provider);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(4));

    spy.mockRejectedValueOnce(new Error('refresh failed in transit (simulated)'));
    rerender({ enabled: true, resetKey: 'pm-1', refreshKey: 'rev:opp-1=9' });
    await waitFor(() => expect(result.current.error).toBe('refresh failed in transit (simulated)'));
    expect(result.current.rows.map((row) => row.id)).toEqual(['opp-1', 'opp-2', 'opp-3', 'opp-4']);
    expect(result.current.refreshing).toBe(false);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.rows).toHaveLength(4);
    expect(spy).toHaveBeenCalledTimes(4);
    expect(spy.mock.calls[3]?.[1]).toEqual({ limit: 4 });
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
    expect(spy.mock.calls[2]?.[1]).toEqual({ limit: 2 });
  });

  it('drops a page that arrives after the membership changed', async () => {
    const provider = new MockDataProvider(book);
    const gate = deferred<void>();
    const real = provider.listQuarterOpportunities.bind(provider);
    vi.spyOn(provider, 'listQuarterOpportunities').mockImplementation((scope, page) =>
      (async () => {
        if (page.cursor !== undefined) await gate.promise;
        return real(scope, page);
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
    vi.spyOn(provider, 'listQuarterOpportunities').mockImplementation((scope, page) =>
      (async () => {
        await gate.promise;
        return real(scope, page);
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
