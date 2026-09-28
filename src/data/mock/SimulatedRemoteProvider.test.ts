import { describe, expect, it, vi } from 'vitest';
import { MockDataProvider } from './MockDataProvider';
import { ScaleDataProvider } from './ScaleDataProvider';
import { SimulatedRemoteProvider } from './SimulatedRemoteProvider';
import { CURRENT_FISCAL_QUARTER } from '../constants';
import { generateDashboardData } from './generate';

const quarter = CURRENT_FISCAL_QUARTER;
/** Fast and reliable: no waiting on a fake network in a unit test. */
const instant = { latencyMs: 0, failureRate: 0 };

describe('SimulatedRemoteProvider', () => {
  it('passes the answer through when the wire is clear', async () => {
    const provider = new SimulatedRemoteProvider(new MockDataProvider(), instant);
    await expect(provider.listPartners()).resolves.toHaveLength(25);
    await expect(provider.getForecastSummary({ quarter })).resolves.toMatchObject({
      openCount: expect.any(Number),
    });
  });

  it('fails a call with the method named, so the UI message is legible', async () => {
    const provider = new SimulatedRemoteProvider(new MockDataProvider(), {
      latencyMs: 0,
      failureRate: 1,
    });
    await expect(provider.getWeightedForecast({ quarter })).rejects.toThrow(
      'getWeightedForecast failed in transit (simulated)',
    );
    await expect(provider.listQuarterOpportunities({ quarter }, { limit: 5 })).rejects.toThrow(
      'listQuarterOpportunities failed in transit (simulated)',
    );
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
          await provider.getTargets().then(
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
    await provider.getTargets();
    // Jitter is 0.6–1.4× the base; only the floor is asserted, so the test
    // cannot flake on a slow machine.
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(20);
  });

  it('wraps any provider, including the scaled book', async () => {
    const provider = new SimulatedRemoteProvider(new ScaleDataProvider(3), instant);
    const page = await provider.listQuarterOpportunities({ quarter }, { limit: 4 });
    expect(page.rows).toHaveLength(4);
    // The roomy call comes back at 3× as well, which is and always was the
    // problem the scoped calls do not have.
    expect((await provider.listOpportunities()).length).toBe(
      generateDashboardData().opportunities.length * 3,
    );
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

    await provider.getPartnerDirectory(trace);

    expect(call).toHaveBeenCalledWith(trace);
  });
});
