import { afterEach, describe, expect, it, vi } from 'vitest';
import { abortableDelay, createAbortError, isAbortError, throwIfAborted } from './abort';

afterEach(() => {
  vi.useRealTimers();
});

describe('createAbortError / isAbortError', () => {
  it('produces one recognizable cancellation shape', () => {
    const error = createAbortError();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    expect(isAbortError(error)).toBe(true);
  });

  it('recognizes the DOM abort reason too, and nothing else', () => {
    const controller = new AbortController();
    controller.abort();
    // A provider that rejects with signal.reason rather than our helper still
    // reads as a cancellation.
    expect(isAbortError(controller.signal.reason)).toBe(true);
    expect(isAbortError(new Error('boom'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('throwIfAborted', () => {
  it('throws only for an aborted signal', () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(undefined)).not.toThrow();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow(createAbortError());
  });
});

describe('abortableDelay', () => {
  it('resolves when the timer fires', async () => {
    vi.useFakeTimers();
    let settled = false;
    const pending = abortableDelay(100, undefined).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with an abort error mid-wait and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let rejected: unknown = null;
    const pending = abortableDelay(100, controller.signal).catch((error: unknown) => {
      rejected = error;
    });
    await vi.advanceTimersByTimeAsync(40);
    controller.abort();
    await pending;
    expect(isAbortError(rejected)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects immediately for an already-aborted signal, without a timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    await expect(abortableDelay(100, controller.signal)).rejects.toSatisfy(isAbortError);
    expect(vi.getTimerCount()).toBe(0);
  });
});
