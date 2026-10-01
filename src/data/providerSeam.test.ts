import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTraceContext } from '../lib/tracing';
import { makeProviderBook } from '../test/fixtures';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import {
  DATA_PROVIDER_CONTEXT_SLOTS,
  DATA_PROVIDER_METHODS,
  type DataProvider,
} from './DataProvider';
import { createSimulatedRemoteProvider } from './mock/createSimulatedRemoteProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import type { QueryContext } from './queryContext';
import { traceDataProvider } from './traceDataProvider';

const WRAPPERS = [
  { name: 'trace', wrap: traceDataProvider },
  {
    name: 'remote',
    wrap: (inner: DataProvider) =>
      createSimulatedRemoteProvider(inner, { latencyMs: 0, failureRate: 0 }),
  },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function captureProvider() {
  const inner = new MockDataProvider(makeProviderBook());
  const answer = await inner.getPartnerDirectory(INTERNAL_DEMO_SCOPE);
  const call = vi.fn(function (this: DataProvider, ...args: unknown[]) {
    void args;
    return Promise.resolve(answer);
  });
  for (const method of DATA_PROVIDER_METHODS) {
    Object.defineProperty(inner, method, { configurable: true, value: call });
  }
  return { inner, answer, call };
}

describe.each(WRAPPERS)('$name seam reflection and argument preparation', ({ name, wrap }) => {
  it.each(DATA_PROVIDER_METHODS)(
    'pads and truncates %s at its declared context slot',
    async (method) => {
      const { inner, answer, call } = await captureProvider();
      const provider = wrap(inner);
      const slot = DATA_PROVIDER_CONTEXT_SLOTS[method];
      const context = Object.freeze({ signal: new AbortController().signal, marker: 'kept' });
      const before = Array.from({ length: slot }, (_, index) => ({ index }));
      // Dynamic calls characterize the Proxy's omitted-argument behavior,
      // independently of the interface's required business inputs.
      const invoke = Reflect.get(provider, method) as (...args: unknown[]) => Promise<unknown>;
      const inputs = [[], [INTERNAL_DEMO_SCOPE], before, [...before, context, 'discarded']];
      for (const input of inputs) {
        const result = await invoke(...input);
        const forwarded = call.mock.calls.at(-1)!;
        expect(forwarded).toHaveLength(slot + 1);
        for (let index = 0; index < slot; index += 1) {
          expect(forwarded[index]).toBe(input[index]);
        }
        const supplied = input[slot];
        if (name === 'remote') {
          expect(forwarded[slot]).toBe(supplied);
          expect(result).toEqual({ ...answer, meta: { ...answer.meta, providerId: 'remote' } });
        } else {
          expect(forwarded[slot]).toMatchObject({
            ...(supplied as QueryContext),
            trace: expect.any(Object),
          });
          expect(forwarded[slot]).not.toBe(supplied);
          expect(result).toBe(answer);
        }
      }
      expect(call).toHaveBeenCalledTimes(inputs.length);
      expect(call.mock.contexts).toEqual(inputs.map(() => inner));
    },
  );

  it('passes unknown keys, symbols, then, and nonfunctions through without binding', async () => {
    const { inner, call } = await captureProvider();
    const symbol = Symbol('future method');
    const identity = { id: 'inner' };
    const future = vi.fn();
    const getter = vi.fn(() => identity);
    Object.defineProperties(inner, {
      identity: { get: getter },
      then: { value: future },
      future: { value: future },
      getManagerDirectory: { value: identity },
      [symbol]: { value: future },
    });
    const provider = wrap(inner);

    expect(Reflect.get(provider, 'identity')).toBe(identity);
    expect(getter.mock.contexts[0]).toBe(provider);
    expect(Reflect.get(provider, 'then')).toBe(future);
    expect(Reflect.get(provider, 'future')).toBe(future);
    expect(Reflect.get(provider, 'toString')).toBe(Reflect.get(inner, 'toString'));
    expect(Reflect.get(provider, 'constructor')).toBe(Reflect.get(inner, 'constructor'));
    expect(Reflect.get(provider, symbol)).toBe(future);
    expect(Reflect.get(provider, 'getManagerDirectory')).toBe(identity);
    expect(Reflect.get(provider, 'absent')).toBeUndefined();
    expect(call).not.toHaveBeenCalled();
    expect(future).not.toHaveBeenCalled();
  });

  it('captures each lookup independently and delegates with the target receiver', async () => {
    const { inner, answer, call } = await captureProvider();
    const provider = wrap(inner);
    const first = provider.getPartnerDirectory;
    const second = provider.getPartnerDirectory;
    expect(first).not.toBe(second);
    const replacement = vi.fn().mockResolvedValue(answer);
    Object.defineProperty(inner, 'getPartnerDirectory', { value: replacement });

    await first.call(new MockDataProvider(makeProviderBook()), INTERNAL_DEMO_SCOPE);
    expect(call).toHaveBeenCalledOnce();
    expect(call.mock.contexts[0]).toBe(inner);
    expect(replacement).not.toHaveBeenCalled();
    await provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE);
    expect(replacement).toHaveBeenCalledOnce();
    expect(replacement.mock.contexts[0]).toBe(inner);
  });
});

describe('seam composition', () => {
  it.each(['trace-outside', 'remote-outside'])(
    'merges only the trace through %s',
    async (order) => {
      const { inner, answer, call } = await captureProvider();
      const remote = (provider: DataProvider) =>
        createSimulatedRemoteProvider(provider, {
          latencyMs: 0,
          failureRate: 0,
          providerId: 'wire',
        });
      const provider =
        order === 'trace-outside'
          ? traceDataProvider(remote(inner))
          : remote(traceDataProvider(inner));
      const parent = createTraceContext();
      const context = Object.freeze({
        signal: new AbortController().signal,
        trace: parent,
        marker: 'kept',
      });

      const result = await provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE, context);

      expect(call).toHaveBeenCalledOnce();
      expect(call.mock.contexts[0]).toBe(inner);
      const forwarded = call.mock.calls[0]![1] as QueryContext;
      expect(forwarded).not.toBe(context);
      expect(forwarded).toMatchObject({
        signal: context.signal,
        marker: 'kept',
        trace: {
          traceId: parent.traceId,
          requestId: parent.requestId,
          parentSpanId: parent.spanId,
        },
      });
      expect(forwarded.trace?.spanId).not.toBe(parent.spanId);
      expect(context.trace).toBe(parent);
      expect(result.data).toBe(answer.data);
      expect(result.meta).toEqual({ ...answer.meta, providerId: 'wire' });
    },
  );

  it('pins seeded waits and failure draws after cancellation before delegation', async () => {
    vi.useFakeTimers();
    const { inner, call } = await captureProvider();
    const delay = vi.spyOn(globalThis, 'setTimeout');
    const provider = createSimulatedRemoteProvider(inner, {
      latencyMs: 100,
      failureRate: 0.5,
      seed: 11,
    });
    const controller = new AbortController();
    const cancelled = provider
      .getPartnerDirectory(INTERNAL_DEMO_SCOPE, { signal: controller.signal })
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    expect(await cancelled).toMatchObject({ name: 'AbortError' });
    expect(call).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    const outcomes: string[] = [];
    for (let index = 0; index < 8; index += 1) {
      const pending = provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE).then(
        (result) => result.meta.providerId,
        (error: unknown) => (error as Error).message,
      );
      await vi.runAllTimersAsync();
      outcomes.push(await pending);
    }
    expect({ waits: delay.mock.calls.map((args) => args[1]), outcomes }).toMatchInlineSnapshot(`
      {
        "outcomes": [
          "remote",
          "getPartnerDirectory failed in transit (simulated)",
          "getPartnerDirectory failed in transit (simulated)",
          "remote",
          "getPartnerDirectory failed in transit (simulated)",
          "remote",
          "getPartnerDirectory failed in transit (simulated)",
          "getPartnerDirectory failed in transit (simulated)",
        ],
        "waits": [
          80,
          99,
          84,
          76,
          86,
          85,
          76,
          129,
          89,
        ],
      }
    `);
    expect(call).toHaveBeenCalledTimes(outcomes.filter((outcome) => outcome === 'remote').length);
  });
});
