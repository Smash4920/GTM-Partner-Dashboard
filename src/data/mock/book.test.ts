import { describe, expect, it } from 'vitest';
import { latestPriorCloseDates, weeklyRecordingTotals } from './book';
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

describe('latestPriorCloseDates', () => {
  const asOf = '2026-09-18T00:00:00.000Z';

  it('keeps only the latest strictly prior close date per opportunity, independent of order', () => {
    const records = [
      snapshot({
        takenAt: '2026-08-10T00:00:00.000Z',
        opportunityId: 'a',
        expectedCloseDate: '2026-08-31T00:00:00.000Z',
      }),
      snapshot({
        takenAt: '2026-09-14T00:00:00.000Z',
        opportunityId: 'a',
        expectedCloseDate: '2026-10-01T00:00:00.000Z',
      }),
      snapshot({
        takenAt: '2026-09-07T00:00:00.000Z',
        opportunityId: 'b',
        expectedCloseDate: '2026-11-01T00:00:00.000Z',
      }),
      snapshot({ takenAt: asOf, opportunityId: 'a' }),
      snapshot({ takenAt: '2026-09-21T00:00:00.000Z', opportunityId: 'a' }),
      snapshot({ takenAt: asOf, opportunityId: 'equal-only' }),
      snapshot({ takenAt: '2026-09-21T00:00:00.000Z', opportunityId: 'future-only' }),
    ];
    const expected = new Map([
      ['a', '2026-10-01T00:00:00.000Z'],
      ['b', '2026-11-01T00:00:00.000Z'],
    ]);
    expect(latestPriorCloseDates(records, asOf)).toEqual(expected);
    expect(latestPriorCloseDates([...records].reverse(), asOf)).toEqual(expected);
    // The projection retains no recording timestamps, revenue, stage, or older dates.
    expect([...latestPriorCloseDates(records, asOf)]).toEqual([...expected]);
  });

  it('compares recording instants rather than timestamp spelling', () => {
    const records = [
      snapshot({ takenAt: '2026-09-17T20:00:00-04:00', opportunityId: 'equal' }),
      snapshot({ takenAt: '2026-09-17T23:00:00.000Z', opportunityId: 'prior' }),
    ];
    expect([...latestPriorCloseDates(records, asOf).keys()]).toEqual(['prior']);
  });

  it('breaks conflicting duplicate instants by lexicographically greatest close date', () => {
    const records = ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'].map(
      (expectedCloseDate) =>
        snapshot({
          takenAt: '2026-09-14T00:00:00.000Z',
          opportunityId: 'a',
          expectedCloseDate,
        }),
    );
    const expected = new Map([['a', '2026-11-01T00:00:00.000Z']]);
    expect(latestPriorCloseDates(records, asOf)).toEqual(expected);
    expect(latestPriorCloseDates([...records].reverse(), asOf)).toEqual(expected);
  });

  it('returns no evidence without prior history', () => {
    expect(latestPriorCloseDates([], asOf)).toEqual(new Map());
  });
});

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
