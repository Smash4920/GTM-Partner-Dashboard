import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { MockDataProvider } from './mock/MockDataProvider';
import { buildQueryMeta } from './queryMetadata';
import type { QueryMeta, QueryResult } from './queryMetadata';
import { editMapKey, useScopedQuery } from './queryState';
import { makeProviderBook } from '../test/fixtures';

/**
 * VAL-RES-006 state semantics for one logical query: initial loading,
 * stale-beats-blank refresh, focused retry, late-answer rejection, and silent
 * aborts — traced state by state. The provider instance is only an identity
 * tag here; `run` stands in for whichever provider method a widget binds.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function provider() {
  return new MockDataProvider(makeProviderBook());
}

const META: QueryMeta = buildQueryMeta({
  providerId: 'local',
  asOf: '2026-09-18T00:00:00.000Z',
  lineage: [],
});

/** Every run answers with the envelope the scoped contract requires. */
function answered<T>(data: T): QueryResult<T> {
  return { data, meta: META };
}

describe('editMapKey', () => {
  it('serializes by content, not by object identity or key order', () => {
    expect(editMapKey({ 'opp-2': 2, 'opp-1': 1 })).toBe(editMapKey({ 'opp-1': 1, 'opp-2': 2 }));
    expect(editMapKey({ 'opp-1': 1 })).not.toBe(editMapKey({ 'opp-1': 2 }));
    expect(editMapKey({})).toBe('');
  });
});

describe('useScopedQuery', () => {
  it('traces initial loading into a settled answer', async () => {
    const stableProvider = provider();
    const { result } = renderHook(() =>
      useScopedQuery({
        provider: stableProvider,
        queryKey: 'q',
        run: async () => answered(42),
        errorFallback: 'x',
      }),
    );

    expect(result.current).toMatchObject({
      data: null,
      meta: null,
      loading: true,
      refreshing: false,
      error: null,
    });

    await waitFor(() => expect(result.current.data).toBe(42));
    expect(result.current).toMatchObject({
      meta: META,
      loading: false,
      refreshing: false,
      error: null,
    });
  });

  it('does not refetch when an equal key is rebuilt on another render', async () => {
    const stableProvider = provider();
    const run = vi.fn(async () => answered(1));
    const { result, rerender } = renderHook(
      ({ queryKey }) =>
        useScopedQuery({ provider: stableProvider, queryKey, run, errorFallback: 'x' }),
      { initialProps: { queryKey: 'q|a=1' } },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    // The hazard this guards: a key rebuilt every render must serialize to
    // the same string, or the effect refetches forever.
    rerender({ queryKey: `q|a=${1}` });
    rerender({ queryKey: 'q|a=1' });
    expect(run).toHaveBeenCalledTimes(1);

    rerender({ queryKey: 'q|a=2' });
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  });

  it('keeps the previous answer on screen while a refresh is in flight', async () => {
    const stableProvider = provider();
    let impl: () => Promise<QueryResult<number>> = async () => answered(1);
    const { result, rerender } = renderHook(
      ({ queryKey }) =>
        useScopedQuery({
          provider: stableProvider,
          queryKey,
          run: () => impl(),
          errorFallback: 'x',
        }),
      { initialProps: { queryKey: 'one' } },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    const refreshGate = deferred<void>();
    impl = async () => {
      await refreshGate.promise;
      return answered(2);
    };
    rerender({ queryKey: 'two' });
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    // Stale beats blank: the old answer is still the one on screen.
    expect(result.current.data).toBe(1);
    expect(result.current.loading).toBe(false);

    await act(async () => {
      refreshGate.resolve();
    });
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(result.current.refreshing).toBe(false);
  });

  it('keeps the stale answer when a refresh fails, and clears the error when a retry succeeds', async () => {
    const stableProvider = provider();
    let impl: () => Promise<QueryResult<number>> = async () => answered(1);
    const { result, rerender } = renderHook(
      ({ queryKey }) =>
        useScopedQuery({
          provider: stableProvider,
          queryKey,
          run: () => impl(),
          errorFallback: 'fallback',
        }),
      { initialProps: { queryKey: 'one' } },
    );
    await waitFor(() => expect(result.current.data).toBe(1));

    impl = async () => {
      throw new Error('flaky wire');
    };
    rerender({ queryKey: 'two' });
    await waitFor(() => expect(result.current.error).toBe('flaky wire'));
    // The same-provider answer stays on screen next to the error, still
    // carrying the as-of and lineage of the answer actually showing.
    expect(result.current.data).toBe(1);
    expect(result.current.meta).toBe(META);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.loading).toBe(false);

    impl = async () => answered(2);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toBe(2));
    expect(result.current.error).toBeNull();
  });

  it('an initial failure leaves the query unavailable, and retry repeats only this query', async () => {
    const stableProvider = provider();
    const run = vi
      .fn<() => Promise<QueryResult<number>>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(answered(7));
    const { result } = renderHook(() =>
      useScopedQuery({ provider: stableProvider, queryKey: 'q', run, errorFallback: 'fallback' }),
    );

    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current).toMatchObject({ data: null, loading: false, refreshing: false });
    expect(run).toHaveBeenCalledTimes(1);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.data).toBe(7));
    expect(result.current.error).toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('drops an answer that arrives after a newer request', async () => {
    const stableProvider = provider();
    const gates = new Map<string, () => void>();
    const { result, rerender } = renderHook(
      ({ queryKey }) =>
        useScopedQuery({
          provider: stableProvider,
          queryKey,
          run: async () => {
            const gate = deferred<void>();
            gates.set(queryKey, () => gate.resolve());
            await gate.promise;
            return answered(queryKey);
          },
          errorFallback: 'x',
        }),
      { initialProps: { queryKey: 'first' } },
    );

    rerender({ queryKey: 'second' });
    await waitFor(() => expect(gates.has('second')).toBe(true));

    // The newest request lands first, then the stale one arrives late.
    await act(async () => {
      gates.get('second')!();
    });
    await waitFor(() => expect(result.current.data).toBe('second'));
    await act(async () => {
      gates.get('first')!();
    });
    expect(result.current.data).toBe('second');
  });

  it("never exposes a previous provider's answer, and drops it when it lands late", async () => {
    const slowGate = deferred<void>();
    const slow = provider();
    const fast = provider();
    const { result, rerender } = renderHook(
      ({ current, run }) =>
        useScopedQuery({ provider: current, queryKey: 'q', run, errorFallback: 'x' }),
      {
        initialProps: {
          current: slow,
          run: async () => {
            await slowGate.promise;
            return answered('slow answer');
          },
        },
      },
    );

    rerender({ current: fast, run: async () => answered('fast answer') });
    // Not one frame of the slow provider's (absent) data under the fast one.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe('fast answer'));

    await act(async () => {
      slowGate.resolve();
    });
    expect(result.current.data).toBe('fast answer');
    expect(result.current.error).toBeNull();
  });

  it('an aborted request writes nothing and logs nothing', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const gate = deferred<void>();
    const { result, unmount } = renderHook(() =>
      useScopedQuery({
        provider: provider(),
        queryKey: 'q',
        run: async () => {
          await gate.promise;
          return answered(1);
        },
        errorFallback: 'x',
      }),
    );
    unmount();
    await act(async () => {
      gate.resolve();
    });
    expect(result.current.data).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
