import { describe, expect, it } from 'vitest';
import { MetricsRegistry } from './metrics';

describe('MetricsRegistry counters', () => {
  it('counts per name and attribute set, and totals across attribute sets', () => {
    const registry = new MetricsRegistry();

    registry.increment('provider.call');
    registry.increment('provider.call', { method: 'listPartners', status: 'ok' });
    registry.increment('provider.call', { method: 'listPartners', status: 'ok' });
    registry.increment('provider.call', { method: 'listPartners', status: 'error' });
    registry.increment('telemetry.error', { category: 'provider' });

    expect(registry.counterTotal('provider.call')).toBe(4);
    expect(registry.counterTotal('telemetry.error')).toBe(1);
    expect(registry.counterTotal('never.recorded')).toBe(0);
  });

  it('treats differently-ordered attributes as the same series', () => {
    const registry = new MetricsRegistry();

    registry.increment('provider.call', { method: 'getTargets', status: 'ok' });
    registry.increment('provider.call', { status: 'ok', method: 'getTargets' });

    const deltas = registry.drainCounterDeltas();

    expect(deltas).toEqual([
      { name: 'provider.call', attributes: { method: 'getTargets', status: 'ok' }, delta: 2 },
    ]);
  });

  it('drains increments once, and omits series that did not move', () => {
    const registry = new MetricsRegistry();
    registry.increment('provider.call', { method: 'getTargets' });
    registry.increment('provider.call', { method: 'getTargets' });

    const firstDrain = registry.drainCounterDeltas();
    const secondDrain = registry.drainCounterDeltas();

    expect(firstDrain[0]?.delta).toBe(2);
    expect(secondDrain).toEqual([]);
    // The total survives draining: drains are reporting intervals, not resets.
    expect(registry.counterTotal('provider.call')).toBe(2);
  });
});

describe('MetricsRegistry durations', () => {
  it('keeps count, total, and bounds per name, across attribute sets', () => {
    const registry = new MetricsRegistry();

    registry.recordDuration('provider.call.duration', 40, { method: 'listPartners' });
    registry.recordDuration('provider.call.duration', 120, { method: 'getForecastSummary' });
    registry.recordDuration('provider.call.duration', 60, { method: 'listPartners' });

    expect(registry.durationSnapshot('provider.call.duration')).toEqual({
      count: 3,
      totalMs: 220,
      minMs: 40,
      maxMs: 120,
    });
    expect(registry.durationSnapshot('nothing')).toBeNull();
  });

  it('ignores durations that are not finite non-negative numbers', () => {
    const registry = new MetricsRegistry();

    registry.recordDuration('provider.call.duration', Number.NaN);
    registry.recordDuration('provider.call.duration', -5);
    registry.recordDuration('provider.call.duration', 12);

    expect(registry.durationSnapshot('provider.call.duration')).toEqual({
      count: 1,
      totalMs: 12,
      minMs: 12,
      maxMs: 12,
    });
  });

  it('drains only the values recorded since the previous drain', () => {
    const registry = new MetricsRegistry();
    registry.recordDuration('provider.call.duration', 10, { method: 'getTargets' });

    expect(registry.drainDurationDeltas()).toEqual([
      {
        name: 'provider.call.duration',
        attributes: { method: 'getTargets' },
        count: 1,
        totalMs: 10,
        minMs: 10,
        maxMs: 10,
      },
    ]);

    registry.recordDuration('provider.call.duration', 30, { method: 'getTargets' });
    const second = registry.drainDurationDeltas();

    expect(second[0]).toMatchObject({ count: 1, totalMs: 30, minMs: 30, maxMs: 30 });
  });
});
