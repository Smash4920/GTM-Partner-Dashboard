import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import type { ProviderId } from './providers';
import type { QueryContext } from './queryContext';
import { probeProviderReadiness, useCommittedProvider } from './useCommittedProvider';
import { makeProviderBook } from '../test/fixtures';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Candidates are distinguishable by object identity; the probe decides their fate. */
function candidateFactory() {
  const built: { id: ProviderId; provider: DataProvider }[] = [];
  const createCandidate = (id: ProviderId): DataProvider => {
    const provider = new MockDataProvider(makeProviderBook());
    built.push({ id, provider });
    return provider;
  };
  return { built, createCandidate };
}

describe('useCommittedProvider', () => {
  it('starts committed to the initial provider at generation 0', () => {
    const { createCandidate } = candidateFactory();
    const { result } = renderHook(() => useCommittedProvider({ createCandidate }));

    expect(result.current.status).toBe('idle');
    expect(result.current.requestedId).toBe('local');
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });
    expect(result.current.failure).toBeNull();
  });

  it('commits object, id, and generation only after the readiness probe succeeds', async () => {
    const { built, createCandidate } = candidateFactory();
    const gate = deferred<unknown>();
    const probe = vi.fn<(candidate: DataProvider, signal: AbortSignal) => Promise<unknown>>(
      () => gate.promise,
    );
    const onCommit = vi.fn();
    const { result } = renderHook(() => useCommittedProvider({ createCandidate, probe, onCommit }));
    const localProvider = result.current.committed.provider;

    act(() => result.current.requestProvider('remote'));

    // Requested moved immediately; committed did not. The candidate exists
    // but owns nothing visible yet.
    expect(result.current.status).toBe('probing');
    expect(result.current.requestedId).toBe('remote');
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });
    expect(result.current.committed.provider).toBe(localProvider);
    expect(built).toHaveLength(2);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0]?.[0]).toBe(built[1]?.provider);
    expect(probe.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);

    await act(async () => {
      gate.resolve(undefined);
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.requestedId).toBe('remote');
    expect(result.current.committed.id).toBe('remote');
    expect(result.current.committed.provider).toBe(built[1]?.provider);
    expect(result.current.committed.generation).toBe(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(result.current.committed);
  });

  it('keeps the committed provider authoritative on probe failure, then retries the same candidate', async () => {
    const { built, createCandidate } = candidateFactory();
    let gate!: ReturnType<typeof deferred<unknown>>;
    const signals: AbortSignal[] = [];
    const probe = vi.fn((_candidate: DataProvider, signal: AbortSignal) => {
      signals.push(signal);
      gate = deferred<unknown>();
      return gate.promise;
    });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useCommittedProvider({ createCandidate, probe, onCommit }));
    const localProvider = result.current.committed.provider;

    act(() => result.current.requestProvider('remote'));
    await act(async () => {
      gate.reject(new Error('getForecastSummary failed in transit (simulated)'));
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.failure).toBe('getForecastSummary failed in transit (simulated)');
    // The failure changed nothing about who is in charge.
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });
    expect(result.current.committed.provider).toBe(localProvider);
    expect(onCommit).not.toHaveBeenCalled();

    // Retry re-probes the same candidate instance rather than rebuilding it.
    act(() => result.current.retry());
    expect(result.current.status).toBe('probing');
    expect(probe).toHaveBeenCalledTimes(2);
    expect(probe.mock.calls[1]?.[0]).toBe(built[1]?.provider);
    expect(built).toHaveLength(2);

    await act(async () => {
      gate.resolve(undefined);
    });
    expect(result.current.status).toBe('idle');
    expect(result.current.committed).toMatchObject({ id: 'remote', generation: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('cancel abandons the request and a later selection rebuilds the candidate', async () => {
    const { built, createCandidate } = candidateFactory();
    let gate!: ReturnType<typeof deferred<unknown>>;
    const probe = vi.fn(() => {
      gate = deferred<unknown>();
      return gate.promise;
    });
    const { result } = renderHook(() => useCommittedProvider({ createCandidate, probe }));

    act(() => result.current.requestProvider('remote'));
    await act(async () => {
      gate.reject(new Error('boom'));
    });
    expect(result.current.status).toBe('failed');

    act(() => result.current.cancel());
    expect(result.current.status).toBe('idle');
    expect(result.current.requestedId).toBe('local');
    expect(result.current.failure).toBeNull();
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });

    // Cancelling discards the candidate: asking again builds a fresh one.
    act(() => result.current.requestProvider('remote'));
    expect(built).toHaveLength(3);
    await act(async () => {
      gate.resolve(undefined);
    });
    expect(result.current.committed).toMatchObject({ id: 'remote', generation: 1 });
  });

  it('asking for the committed provider cancels an in-flight switch and aborts its probe', async () => {
    const { createCandidate } = candidateFactory();
    const gate = deferred<unknown>();
    const signals: AbortSignal[] = [];
    const probe = vi.fn((_candidate: DataProvider, signal: AbortSignal) => {
      signals.push(signal);
      return gate.promise;
    });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useCommittedProvider({ createCandidate, probe, onCommit }));

    act(() => result.current.requestProvider('remote'));
    expect(result.current.status).toBe('probing');

    act(() => result.current.requestProvider('local'));
    expect(result.current.status).toBe('idle');
    expect(result.current.requestedId).toBe('local');
    expect(signals[0]?.aborted).toBe(true);

    // A late answer from the abandoned probe must not commit.
    await act(async () => {
      gate.resolve(undefined);
    });
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a newer request abandons the older probe, whose late success never commits', async () => {
    const { createCandidate } = candidateFactory();
    const gates = new Map<DataProvider, ReturnType<typeof deferred<unknown>>>();
    const signals: AbortSignal[] = [];
    const probe = vi.fn((candidate: DataProvider, signal: AbortSignal) => {
      signals.push(signal);
      const gate = deferred<unknown>();
      gates.set(candidate, gate);
      return gate.promise;
    });
    const onCommit = vi.fn();
    const { result } = renderHook(() => useCommittedProvider({ createCandidate, probe, onCommit }));

    act(() => result.current.requestProvider('remote'));
    act(() => result.current.requestProvider('scaled'));

    // The first probe was cancelled and abandoned in favour of the second.
    expect(signals).toHaveLength(2);
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);
    expect(result.current.requestedId).toBe('scaled');

    // The abandoned probe resolves late — too late to matter.
    const [remoteCandidate, scaledCandidate] = [...gates.keys()];
    await act(async () => {
      gates.get(remoteCandidate!)?.resolve(undefined);
    });
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });
    expect(result.current.status).toBe('probing');

    await act(async () => {
      gates.get(scaledCandidate!)?.resolve(undefined);
    });
    expect(result.current.committed).toMatchObject({ id: 'scaled', generation: 1 });
    expect(result.current.committed.provider).toBe(scaledCandidate);
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('a probe failure arriving after cancel is discarded', async () => {
    const { createCandidate } = candidateFactory();
    const gate = deferred<unknown>();
    const probe = vi.fn(() => gate.promise);
    const { result } = renderHook(() => useCommittedProvider({ createCandidate, probe }));

    act(() => result.current.requestProvider('remote'));
    act(() => result.current.cancel());
    await act(async () => {
      gate.reject(new Error('late failure'));
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.failure).toBeNull();
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });
  });

  it('describes a non-Error probe rejection', async () => {
    const { createCandidate } = candidateFactory();
    const gate = deferred<unknown>();
    const { result } = renderHook(() =>
      useCommittedProvider({ createCandidate, probe: () => gate.promise }),
    );

    act(() => result.current.requestProvider('scaled'));
    await act(async () => {
      gate.reject('no session');
    });

    expect(result.current.status).toBe('failed');
    expect(result.current.failure).toBe('The readiness check failed');
  });
});

describe('probeProviderReadiness', () => {
  it('pings the smallest scoped query for the current fiscal quarter', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const spy = vi.spyOn(provider, 'getForecastSummary');
    await probeProviderReadiness(provider);
    expect(spy).toHaveBeenCalledWith({ quarter: CURRENT_FISCAL_QUARTER }, { signal: undefined });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it('threads the caller’s abort signal into the probe’s provider call', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const spy = vi.spyOn(provider, 'getForecastSummary');
    const controller = new AbortController();
    await probeProviderReadiness(provider, controller.signal);
    expect(spy).toHaveBeenCalledWith(
      { quarter: CURRENT_FISCAL_QUARTER },
      { signal: controller.signal },
    );
  });

  it('a cancelled switch aborts the in-flight probe call, and its late answer never commits', async () => {
    const gate = deferred<unknown>();
    const contexts: (QueryContext | undefined)[] = [];
    const createCandidate = (id: ProviderId): DataProvider => {
      const candidate = new MockDataProvider(makeProviderBook());
      if (id !== 'local') {
        const inner = candidate.getForecastSummary.bind(candidate);
        candidate.getForecastSummary = (scope, context) => {
          contexts.push(context);
          return gate.promise.then(() => inner(scope, context));
        };
      }
      return candidate;
    };
    const onCommit = vi.fn();
    const { result } = renderHook(() => useCommittedProvider({ createCandidate, onCommit }));

    act(() => result.current.requestProvider('remote'));
    await waitFor(() => expect(contexts).toHaveLength(1));
    expect(contexts[0]?.signal?.aborted).toBe(false);

    act(() => result.current.cancel());
    // Cancellation reached the provider-visible work, not just the hook.
    expect(contexts[0]?.signal?.aborted).toBe(true);
    expect(result.current.status).toBe('idle');

    await act(async () => {
      gate.resolve(undefined);
    });
    expect(result.current.committed).toMatchObject({ id: 'local', generation: 0 });
    expect(onCommit).not.toHaveBeenCalled();
  });
});
