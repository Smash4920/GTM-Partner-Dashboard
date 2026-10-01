import { describe, expect, it } from 'vitest';
import { weeklyRecordingTotals } from './book';
import type { PipelineSnapshot } from './book';

/**
 * The provider-private aggregation raw history passes through on its way
 * out of the seam: raw weekly snapshots in, one bounded per-category
 * totals bucket per recording instant out. The metrics layer's own suite
 * consumes these totals directly; this suite pins the fold itself.
 */

function snapshot(
  fields: Partial<PipelineSnapshot> & Pick<PipelineSnapshot, 'takenAt' | 'opportunityId'>,
): PipelineSnapshot {
  return {
    forecastedRevenue: 10_000,
    forecastCategory: 'pipeline',
    stage: 'scope',
    expectedCloseDate: '2026-09-30T00:00:00Z',
    ...fields,
  };
}

describe('weeklyRecordingTotals', () => {
  it('sums one instant across every deal recorded in it, per category', () => {
    const totals = weeklyRecordingTotals(
      [
        snapshot({
          takenAt: '2026-08-10T00:00:00.000Z',
          opportunityId: 'a',
          forecastedRevenue: 60_000,
        }),
        snapshot({
          takenAt: '2026-08-10T00:00:00.000Z',
          opportunityId: 'b',
          forecastedRevenue: 40_000,
          forecastCategory: 'commit',
        }),
        snapshot({
          takenAt: '2026-08-17T00:00:00.000Z',
          opportunityId: 'a',
          forecastedRevenue: 70_000,
        }),
      ],
      'FY27-Q3',
    );
    expect(totals).toEqual([
      {
        takenAt: '2026-08-10T00:00:00.000Z',
        raw: { 'long-shot': 0, pipeline: 60_000, 'best-case': 0, commit: 40_000 },
      },
      {
        takenAt: '2026-08-17T00:00:00.000Z',
        raw: { 'long-shot': 0, pipeline: 70_000, 'best-case': 0, commit: 0 },
      },
    ]);
  });

  it('clips a snapshot whose recorded close falls outside the quarter, so a slip shows as a drop', () => {
    // The deal read Q3 in the first recording and Q4 in the second. The
    // second instant still emits a bucket — zeroed — because a recorded
    // zero is the drop itself, not a missing recording to reconstruct.
    const totals = weeklyRecordingTotals(
      [
        snapshot({
          takenAt: '2026-08-10T00:00:00.000Z',
          opportunityId: 'a',
          forecastedRevenue: 100_000,
        }),
        snapshot({
          takenAt: '2026-08-17T00:00:00.000Z',
          opportunityId: 'a',
          forecastedRevenue: 100_000,
          expectedCloseDate: '2026-11-20T00:00:00Z',
        }),
      ],
      'FY27-Q3',
    );
    expect(totals.map((row) => row.takenAt)).toEqual([
      '2026-08-10T00:00:00.000Z',
      '2026-08-17T00:00:00.000Z',
    ]);
    expect(totals[0]!.raw.pipeline).toBe(100_000);
    expect(totals[1]!.raw.pipeline).toBe(0);
  });

  it('emits instants oldest first, however the rows were ordered', () => {
    const totals = weeklyRecordingTotals(
      [
        snapshot({ takenAt: '2026-08-17T00:00:00.000Z', opportunityId: 'a' }),
        snapshot({ takenAt: '2026-08-10T00:00:00.000Z', opportunityId: 'a' }),
      ],
      'FY27-Q3',
    );
    expect(totals.map((row) => row.takenAt)).toEqual([
      '2026-08-10T00:00:00.000Z',
      '2026-08-17T00:00:00.000Z',
    ]);
  });

  it('answers empty for a provider with no history', () => {
    expect(weeklyRecordingTotals([], 'FY27-Q3')).toEqual([]);
  });
});
