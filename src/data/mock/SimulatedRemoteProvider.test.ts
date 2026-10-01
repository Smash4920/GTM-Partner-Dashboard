import { describe, expect, it, vi } from 'vitest';
import { MockDataProvider } from './MockDataProvider';
import { ScaleDataProvider } from './ScaleDataProvider';
import { SimulatedRemoteProvider } from './SimulatedRemoteProvider';
import { CURRENT_FISCAL_QUARTER } from '../constants';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';

const quarter = CURRENT_FISCAL_QUARTER;
/** Fast and reliable: no waiting on a fake network in a unit test. */
const instant = { latencyMs: 0, failureRate: 0 };

describe('SimulatedRemoteProvider', () => {
  it('passes the answer through when the wire is clear, under its own identity', async () => {
    const provider = new SimulatedRemoteProvider(new MockDataProvider(), instant);
    const { data: partners } = await provider.getPartnerRoster(INTERNAL_DEMO_SCOPE, {});
    expect(partners).toHaveLength(25);
    // The envelope survives the hop, re-labelled: the committed provider is
    // the remote one, whatever the inner implementation called itself.
    await expect(
      provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }),
    ).resolves.toMatchObject({
      data: { openCount: expect.any(Number) },
      meta: { providerId: 'remote', completeness: 'complete' },
    });
  });

  it('fails a call with the method named, so the UI message is legible', async () => {
    const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
      latencyMs: 0,
      failureRate: 1,
    });
    await expect(provider.getWeightedForecast(INTERNAL_DEMO_SCOPE, { quarter })).rejects.toThrow(
      'getWeightedForecast failed in transit (simulated)',
    );
    await expect(
      provider.listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { limit: 5 }),
    ).rejects.toThrow('listQuarterOpportunities failed in transit (simulated)');
  });

  it('is deterministic for a seed, so a failing demo run can be replayed', async () => {
    const outcomes = async (seed: number) => {
      const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
        latencyMs: 0,
        failureRate: 0.5,
        seed,
      });
      const results: boolean[] = [];
      for (let call = 0; call < 12; call += 1) {
        results.push(
          await provider.getManagerDirectory(INTERNAL_DEMO_SCOPE).then(
            () => true,
            () => false,
          ),
        );
      }
      return results;
    };

    expect(await outcomes(7)).toEqual(await outcomes(7));
    expect(await outcomes(7)).not.toEqual(await outcomes(8));
  });

  it('actually waits, within the jitter band', async () => {
    const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
      latencyMs: 40,
      failureRate: 0,
      seed: 1,
    });
    const startedAt = Date.now();
    await provider.getManagerDirectory(INTERNAL_DEMO_SCOPE);
    // Jitter is 0.6–1.4× the base; only the floor is asserted, so the test
    // cannot flake on a slow machine.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
  });

  it('fails exactly the planned first calls, whatever order the rest arrive in', async () => {
    const inner = new MockDataProvider();
    const call = vi.spyOn(inner, 'getForecastSummary');
    const provider = new SimulatedRemoteProvider(inner, {
      latencyMs: 0,
      // A high random rate that must be ignored while the plan runs: the
      // plan, not the draw, decides.
      failureRate: 1,
      failFirstCalls: 2,
    });

    await expect(provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter })).rejects.toThrow(
      'getForecastSummary failed in transit (simulated)',
    );
    await expect(provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter })).rejects.toThrow(
      'getForecastSummary failed in transit (simulated)',
    );
    // The plan is spent; every later call passes through, despite the 100%
    // failure rate the draw would have applied.
    await expect(
      provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }),
    ).resolves.toMatchObject({
      data: { openCount: expect.any(Number) },
    });
    // A failed call never reaches the inner provider.
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('replays a named failure plan identically across instances', async () => {
    const outcomes = async () => {
      const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
        latencyMs: 0,
        failFirstCalls: 1,
      });
      const results: boolean[] = [];
      for (let call = 0; call < 4; call += 1) {
        results.push(
          await provider.getManagerDirectory(INTERNAL_DEMO_SCOPE).then(
            () => true,
            () => false,
          ),
        );
      }
      return results;
    };

    expect(await outcomes()).toEqual([false, true, true, true]);
    expect(await outcomes()).toEqual([false, true, true, true]);
  });

  it('a per-method plan fails only the named method, however unrelated calls interleave', async () => {
    const inner = new MockDataProvider();
    const summaryCalls = vi.spyOn(inner, 'getForecastSummary');
    const provider = new SimulatedRemoteProvider(inner, {
      latencyMs: 0,
      // A rate that must be ignored while the plan runs: the plan, not the
      // draw, decides — including for methods the plan never names.
      failureRate: 1,
      failMethods: { getForecastSummary: 1 },
    });

    // Unrelated calls before, between, and after the named method neither
    // consume the plan nor fail themselves.
    await expect(provider.getManagerDirectory(INTERNAL_DEMO_SCOPE)).resolves.toMatchObject({
      data: expect.any(Array),
    });
    await expect(provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter })).rejects.toThrow(
      'getForecastSummary failed in transit (simulated)',
    );
    await expect(provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE)).resolves.toMatchObject({
      data: expect.any(Array),
    });
    // The plan is spent for that method; later calls pass despite the 100%
    // failure rate the draw would have applied.
    await expect(
      provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }),
    ).resolves.toMatchObject({
      data: { openCount: expect.any(Number) },
    });
    // The failed call never reached the inner provider; the retried one ran
    // exactly once.
    expect(summaryCalls).toHaveBeenCalledTimes(1);
  });

  it('replays a per-method plan identically across instances and interleavings', async () => {
    const run = async (interleave: boolean) => {
      const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
        latencyMs: 0,
        failMethods: { getForecastSummary: 2 },
      });
      const outcomes: boolean[] = [];
      const attempt = () =>
        provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }).then(
          () => true,
          () => false,
        );
      outcomes.push(await attempt());
      if (interleave) await provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE);
      outcomes.push(await attempt());
      if (interleave) await provider.getManagerDirectory(INTERNAL_DEMO_SCOPE);
      outcomes.push(await attempt());
      return outcomes;
    };

    expect(await run(false)).toEqual([false, false, true]);
    expect(await run(true)).toEqual([false, false, true]);
  });

  it('a skip plan lets the first calls succeed, then fails exactly the named count', async () => {
    const inner = new MockDataProvider();
    const summaryCalls = vi.spyOn(inner, 'getForecastSummary');
    const provider = new SimulatedRemoteProvider(inner, {
      latencyMs: 0,
      // A rate that must be ignored while the plan runs: the plan, not the
      // draw, decides.
      failureRate: 1,
      failMethods: { getForecastSummary: { skip: 2, fail: 1 } },
    });

    const attempt = () =>
      provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }).then(
        () => true,
        () => false,
      );
    // The load page one, fail the load-more, recover on retry shape that a
    // paginated surface rehearses: succeed, succeed, fail once, succeed.
    expect(await attempt()).toBe(true);
    expect(await attempt()).toBe(true);
    expect(await attempt()).toBe(false);
    expect(await attempt()).toBe(true);
    // The failed call never reached the inner provider; the three successful
    // ones ran exactly once each.
    expect(summaryCalls).toHaveBeenCalledTimes(3);
  });

  it('a method’s seeded failure pattern is independent of unrelated calls', async () => {
    const outcomesOf = async (interleave: boolean) => {
      const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
        latencyMs: 0,
        failureRate: 0.5,
        seed: 11,
      });
      const outcomes: boolean[] = [];
      for (let call = 0; call < 10; call += 1) {
        // Interleaving an unrelated method between every named call must not
        // shift the named method's outcomes. The unrelated call has its own
        // pattern and may itself fail; that is not what is being measured.
        if (interleave) {
          await provider.getManagerDirectory(INTERNAL_DEMO_SCOPE).then(
            () => true,
            () => false,
          );
        }
        outcomes.push(
          await provider.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }).then(
            () => true,
            () => false,
          ),
        );
      }
      return outcomes;
    };

    const pattern = await outcomesOf(false);
    expect(await outcomesOf(true)).toEqual(pattern);
    // The pattern is not degenerate, or the independence claim above would
    // be untestable.
    expect(pattern).toContain(true);
    expect(pattern).toContain(false);
  });

  it('incurs exactly one delay and at most one inner invocation per public call', async () => {
    vi.useFakeTimers();
    try {
      const inner = new MockDataProvider();
      const spy = vi.spyOn(inner, 'getPartnerDirectory');
      const provider = new SimulatedRemoteProvider(inner, {
        latencyMs: 100,
        failureRate: 0,
        seed: 5,
      });

      let settled = false;
      const pending = provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE).then(() => {
        settled = true;
      });
      // One timer per invocation — the wire wait — and nothing resolves
      // before it fires. Jitter is 0.6–1.4× the base, so 59 ms is always
      // short of the floor and 140 ms always reaches the ceiling.
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(59);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(81);
      await pending;
      expect(settled).toBe(true);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);

      // The failure path is the same shape: one delay, no inner invocation.
      const failing = new SimulatedRemoteProvider(inner, {
        latencyMs: 100,
        failureRate: 1,
        seed: 5,
      });
      let rejected: unknown = null;
      const failed = failing.getPartnerDirectory(INTERNAL_DEMO_SCOPE).catch((error: unknown) => {
        rejected = error;
      });
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(200);
      await failed;
      expect(String(rejected)).toContain('getPartnerDirectory failed in transit (simulated)');
      expect(spy).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('wraps any provider, including the scaled book', async () => {
    const provider = new SimulatedRemoteProvider(new ScaleDataProvider(3), instant);
    const { data: page } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 4 },
    );
    expect(page.rows).toHaveLength(4);
    // The page is the whole answer however large the book behind it: the
    // total says 3×, the payload stays four rows.
    expect(page.totalCount).toBeGreaterThan(page.rows.length);
  });

  it('aborts during the delay without invoking the inner provider', async () => {
    vi.useFakeTimers();
    try {
      const inner = new MockDataProvider();
      const spy = vi.spyOn(inner, 'getForecastSummary');
      const provider = new SimulatedRemoteProvider(inner, {
        latencyMs: 100,
        failureRate: 0,
        seed: 5,
      });
      const controller = new AbortController();

      let rejected: unknown = null;
      const pending = provider
        .getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }, { signal: controller.signal })
        .catch((error: unknown) => {
          rejected = error;
        });
      expect(vi.getTimerCount()).toBe(1);

      // The abort lands while the wire wait is still running.
      await vi.advanceTimersByTimeAsync(20);
      controller.abort();
      await pending;

      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).name).toBe('AbortError');
      // The wire never completed, so the inner provider never ran.
      expect(spy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does no work at all for an already-aborted signal', async () => {
    vi.useFakeTimers();
    try {
      const inner = new MockDataProvider();
      const spy = vi.spyOn(inner, 'getPartnerDirectory');
      const provider = new SimulatedRemoteProvider(inner, {
        latencyMs: 100,
        failureRate: 0,
      });
      const controller = new AbortController();
      controller.abort();

      const rejected = await provider
        .getPartnerDirectory(INTERNAL_DEMO_SCOPE, { signal: controller.signal })
        .catch((error: unknown) => error);
      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).name).toBe('AbortError');
      expect(spy).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an aborted call consumes no failure-plan slot and no failure draw', async () => {
    vi.useFakeTimers();
    try {
      const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
        latencyMs: 100,
        failMethods: { getManagerDirectory: 1 },
      });
      const controller = new AbortController();

      // The first call is cancelled in transit; the plan slot must survive.
      const aborted = provider
        .getManagerDirectory(INTERNAL_DEMO_SCOPE, { signal: controller.signal })
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(10);
      controller.abort();
      const abortedError = await aborted;
      expect(abortedError).toBeInstanceOf(Error);
      expect((abortedError as Error).name).toBe('AbortError');

      // The plan is unspent: the next completed call is the one that fails…
      const second = provider
        .getManagerDirectory(INTERNAL_DEMO_SCOPE)
        .catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(100);
      expect(await second).toBeInstanceOf(Error);
      // …and the call after it succeeds, proving exactly one slot existed.
      const third = provider.getManagerDirectory(INTERNAL_DEMO_SCOPE);
      await vi.advanceTimersByTimeAsync(100);
      await expect(third).resolves.toMatchObject({ data: expect.any(Array) });
    } finally {
      vi.useRealTimers();
    }
  });

  it('forwards the caller’s signal to the inner provider once the wait completes', async () => {
    const inner = new MockDataProvider();
    const spy = vi.spyOn(inner, 'getPartnerDirectory');
    const provider = new SimulatedRemoteProvider(inner, instant);
    const controller = new AbortController();

    await provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE, { signal: controller.signal });

    expect(spy).toHaveBeenCalledWith(INTERNAL_DEMO_SCOPE, { signal: controller.signal });
    expect(controller.signal.aborted).toBe(false);
  });

  it('preserves trace context across the simulated network boundary', async () => {
    const inner = new MockDataProvider();
    const call = vi.spyOn(inner, 'getPartnerDirectory');
    const provider = new SimulatedRemoteProvider(inner, instant);
    const trace = {
      traceId: 'a'.repeat(32),
      spanId: 'b'.repeat(16),
      requestId: 'e2962c45-5c35-4b5a-b34d-5ea48e4ad00f',
      headers: {
        traceparent: `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,
        'x-request-id': 'e2962c45-5c35-4b5a-b34d-5ea48e4ad00f',
      },
    };

    await provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE, { trace });

    expect(call).toHaveBeenCalledWith(INTERNAL_DEMO_SCOPE, { trace });
  });
});
