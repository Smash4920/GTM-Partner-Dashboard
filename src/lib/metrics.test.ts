import { describe, expect, it } from 'vitest';
import { CURRENT_FISCAL_QUARTER, FISCAL_PHASE_META, SNAPSHOT_DATE } from '../data/constants';
import type {
  ActivityMeeting,
  DealRegistration,
  ForecastCategory,
  MeetingClassification,
  Opportunity,
  Target,
  TeamUser,
} from '../data/types';
import {
  applyTeamRosterOverlays,
  categoryStageMismatches,
  closedWonForPhase,
  closedWonPriorYearForPhase,
  coverageState,
  currentWeekMeetings,
  daysLeftInQuarter,
  filterByPhase,
  filterRegistrationsByPhase,
  forecastCategoryOf,
  formatCoverage,
  openOpportunities,
  openPipeline,
  phaseForQuarter,
  phaseWindow,
  quarterlyClosedWonAndTarget,
  registrationsNewestFirst,
  remainingQuota,
  weeklyActivity,
  weeklyForecastRows,
  weeklyGoalProgress,
  weightedForecast,
  winRateForPhase,
} from './metrics';
import type { RecordedWeekTotals } from './metrics';

// ---- fixtures --------------------------------------------------------------

function opp(
  fields: Partial<Opportunity> & Pick<Opportunity, 'id' | 'expectedCloseDate'>,
): Opportunity {
  return {
    partnerId: 'p-01',
    accountName: 'Test Account',
    oppType: 'sell-with',
    stage: 'discovery',
    factoryAccountDirector: 'Maya Patel',
    forecastedRevenue: 10_000,
    createdAt: '2026-01-01T00:00:00Z',
    ...fields,
  };
}

function target(quarter: string, revenueTarget: number): Target {
  return { partnerId: 'p-01', quarter, revenueTarget };
}

function registration(submittedAt: string): DealRegistration {
  return {
    id: 'reg-0001',
    partnerId: 'p-01',
    accountName: 'Test Account',
    amount: 50_000,
    submittedAt,
    status: 'pending',
  };
}

/**
 * One recording instant's totals, zero-filled the way the provider's
 * aggregation emits them (see `src/data/mock/book.ts`). The metrics layer
 * never touches raw snapshot rows — even its tests receive history in this
 * folded shape.
 */
function recorded(
  takenAt: string,
  raw: Partial<Record<ForecastCategory, number>>,
): RecordedWeekTotals {
  return {
    takenAt,
    raw: { 'long-shot': 0, pipeline: 0, 'best-case': 0, commit: 0, ...raw },
  };
}

// ---- phase windows ---------------------------------------------------------

describe('phaseWindow', () => {
  it('truncates in-progress phases at the snapshot for closed activity only', () => {
    const q3 = phaseWindow('q3');
    expect(q3.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(q3.end.toISOString()).toBe('2026-09-18T00:00:00.000Z');
    expect(q3.pipelineEnd.toISOString()).toBe('2026-11-01T00:00:00.000Z');

    const fy = phaseWindow('fy');
    expect(fy.start.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(fy.end.toISOString()).toBe('2026-09-18T00:00:00.000Z');
    expect(fy.pipelineEnd.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });

  it('keeps complete quarters whole and leaves future quarters empty for closes', () => {
    for (const phase of ['q1', 'q2'] as const) {
      const window = phaseWindow(phase);
      expect(window.end).toEqual(window.pipelineEnd);
    }
    const q4 = phaseWindow('q4');
    expect(q4.pipelineEnd.toISOString()).toBe('2027-02-01T00:00:00.000Z');
    // Nothing can close in a future quarter: end < start yields an empty set.
    expect(q4.end.getTime()).toBeLessThan(q4.start.getTime());
  });
});

// ---- phase filtering -------------------------------------------------------

describe('filterByPhase', () => {
  it('keeps open pipeline scheduled after the snapshot but inside the phase', () => {
    const lateQ3 = opp({ id: 'a', expectedCloseDate: '2026-10-20T00:00:00Z' });
    const q4Deal = opp({ id: 'b', expectedCloseDate: '2026-12-15T00:00:00Z' });
    expect(filterByPhase([lateQ3], 'q3')).toEqual([lateQ3]);
    expect(filterByPhase([lateQ3], 'fy')).toEqual([lateQ3]);
    expect(filterByPhase([lateQ3], 'q4')).toEqual([]);
    expect(filterByPhase([q4Deal], 'q4')).toEqual([q4Deal]);
  });

  it('matches closed opportunities by actual close through the snapshot', () => {
    const closedInQ3 = opp({
      id: 'c',
      expectedCloseDate: '2026-10-20T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-08-10T00:00:00Z',
    });
    const closedInQ2 = opp({
      id: 'd',
      expectedCloseDate: '2026-08-10T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-06-10T00:00:00Z',
    });
    const priorYear = opp({
      id: 'e',
      expectedCloseDate: '2025-08-10T00:00:00Z',
      outcome: 'won',
      closedAt: '2025-08-10T00:00:00Z',
    });
    expect(filterByPhase([closedInQ3, closedInQ2, priorYear], 'q3')).toEqual([closedInQ3]);
    expect(filterByPhase([closedInQ3, closedInQ2, priorYear], 'fy')).toEqual([
      closedInQ3,
      closedInQ2,
    ]);
  });

  it('excludes pipeline expected to close outside the phase', () => {
    const q2Deal = opp({ id: 'f', expectedCloseDate: '2026-07-15T00:00:00Z' });
    expect(filterByPhase([q2Deal], 'q3')).toEqual([]);
  });
});

describe('filterRegistrationsByPhase', () => {
  it('filters registrations by submitted date within the phase window', () => {
    expect(filterRegistrationsByPhase([registration('2026-08-05T00:00:00Z')], 'q3')).toHaveLength(
      1,
    );
    expect(filterRegistrationsByPhase([registration('2026-05-05T00:00:00Z')], 'q3')).toHaveLength(
      0,
    );
  });
});

// ---- coverage and quota ----------------------------------------------------

describe('coverageState', () => {
  const targets = [target('FY27-Q3', 100_000)];
  const closedWon20k = opp({
    id: 'w',
    expectedCloseDate: '2026-08-05T00:00:00Z',
    outcome: 'won',
    closedAt: '2026-08-05T00:00:00Z',
    forecastedRevenue: 20_000,
  });

  it('counts open pipeline across the whole phase, not just through the snapshot', () => {
    const beforeSnapshot = opp({
      id: 'o1',
      expectedCloseDate: '2026-09-10T00:00:00Z',
      forecastedRevenue: 60_000,
    });
    const lateInPhase = opp({
      id: 'o2',
      expectedCloseDate: '2026-10-15T00:00:00Z',
      forecastedRevenue: 100_000,
    });
    const nextQuarter = opp({
      id: 'o3',
      expectedCloseDate: '2026-12-01T00:00:00Z',
      forecastedRevenue: 500_000,
    });

    // Remaining quota is 80k; Q3-scheduled open pipeline is 160k (the 500k
    // Q4 deal must not leak in), so coverage is 2x.
    expect(
      coverageState([closedWon20k, beforeSnapshot, lateInPhase, nextQuarter], targets, 'q3'),
    ).toEqual({ kind: 'coverage', value: 2 });
  });

  it('reports target-met once closed-won reaches the target, even with open pipeline left', () => {
    const closedWon = opp({
      id: 'w-met',
      expectedCloseDate: '2026-08-05T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-08-05T00:00:00Z',
      forecastedRevenue: 150_000,
    });
    const stillOpen = opp({
      id: 'o-open',
      expectedCloseDate: '2026-10-15T00:00:00Z',
      forecastedRevenue: 400_000,
    });
    // The zero remaining gap is a state, not a ratio: 400k of open pipeline
    // over a fully covered target must not render as a coverage figure.
    expect(coverageState([closedWon, stillOpen], targets, 'q3')).toEqual({ kind: 'target-met' });
    expect(formatCoverage(coverageState([closedWon, stillOpen], targets, 'q3'))).toBe('Target met');
  });

  it('reports no-target when the phase has no target rows for the scope', () => {
    expect(coverageState([closedWon20k], [], 'q3')).toEqual({ kind: 'no-target' });
    expect(formatCoverage(coverageState([closedWon20k], [], 'q3'))).toBe('No target');
  });

  it('reports no-target for a zero-value target row and a target in another quarter', () => {
    expect(coverageState([], [target('FY27-Q3', 0)], 'q3')).toEqual({ kind: 'no-target' });
    expect(coverageState([closedWon20k], [target('FY27-Q4', 900_000)], 'q3')).toEqual({
      kind: 'no-target',
    });
  });

  it('never produces Infinity or NaN', () => {
    for (const state of [
      coverageState([], [], 'q3'),
      coverageState([], [target('FY27-Q3', 0)], 'q3'),
      coverageState([closedWon20k], targets, 'q3'),
    ]) {
      expect(state.kind === 'coverage' ? Number.isFinite(state.value) : true).toBe(true);
      expect(formatCoverage(state)).not.toMatch(/Infinity|NaN/);
    }
  });

  it('formats the three states distinctly', () => {
    expect(formatCoverage({ kind: 'no-target' })).toBe('No target');
    expect(formatCoverage({ kind: 'target-met' })).toBe('Target met');
    expect(formatCoverage({ kind: 'coverage', value: 2.34 })).toBe('2.3x');
  });
});

describe('remainingQuota', () => {
  it('floors remaining quota at zero', () => {
    const closedWon = opp({
      id: 'w',
      expectedCloseDate: '2026-08-05T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-08-05T00:00:00Z',
      forecastedRevenue: 250_000,
    });
    expect(remainingQuota([closedWon], [target('FY27-Q3', 100_000)], 'q3')).toBe(0);
  });
});

// ---- prior-year deltas -----------------------------------------------------

describe('closedWonPriorYearForPhase', () => {
  it('compares in-progress phases against the same span one year earlier', () => {
    const inPriorQ3 = opp({
      id: 'p1',
      expectedCloseDate: '2025-09-01T00:00:00Z',
      outcome: 'won',
      closedAt: '2025-09-01T00:00:00Z',
      forecastedRevenue: 40_000,
    });
    const beforePriorWindow = opp({
      id: 'p2',
      expectedCloseDate: '2025-07-01T00:00:00Z',
      outcome: 'won',
      closedAt: '2025-07-31T00:00:00Z',
      forecastedRevenue: 999_999,
    });
    const afterPriorWindow = opp({
      id: 'p3',
      expectedCloseDate: '2025-09-19T00:00:00Z',
      outcome: 'won',
      closedAt: '2025-09-19T00:00:00Z',
      forecastedRevenue: 555_555,
    });
    expect(closedWonPriorYearForPhase([inPriorQ3, beforePriorWindow, afterPriorWindow], 'q3')).toBe(
      40_000,
    );
  });

  it('compares future phases against the full prior-year quarter', () => {
    const priorQ4 = opp({
      id: 'p4',
      expectedCloseDate: '2025-12-01T00:00:00Z',
      outcome: 'won',
      closedAt: '2025-12-01T00:00:00Z',
      forecastedRevenue: 30_000,
    });
    expect(closedWonPriorYearForPhase([priorQ4], 'q4')).toBe(30_000);
  });
});

// ---- closed-won and win rate ------------------------------------------------

describe('closedWonForPhase / winRateForPhase', () => {
  it('ignores hypothetical closes in a future quarter', () => {
    const futureClose = opp({
      id: 'x',
      expectedCloseDate: '2026-12-01T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-12-01T00:00:00Z',
      forecastedRevenue: 75_000,
    });
    expect(closedWonForPhase([futureClose], 'q4')).toBe(0);
    expect(winRateForPhase([futureClose], 'q4')).toBe(0);
  });

  it('counts closed-won and win rate within the snapshot-truncated window', () => {
    const won = opp({
      id: 'a',
      expectedCloseDate: '2026-08-05T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-08-05T00:00:00Z',
    });
    const lost = opp({
      id: 'b',
      expectedCloseDate: '2026-08-06T00:00:00Z',
      outcome: 'lost',
      closedAt: '2026-08-06T00:00:00Z',
    });
    const outsideQ3 = opp({
      id: 'c',
      expectedCloseDate: '2026-08-07T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-07-31T00:00:00Z',
      forecastedRevenue: 500_000,
    });
    const all = [won, lost, outsideQ3];
    expect(closedWonForPhase(all, 'q3')).toBe(10_000);
    expect(winRateForPhase(all, 'q3')).toBe(0.5);
  });
});

// ---- quarterly chart -------------------------------------------------------

describe('quarterlyClosedWonAndTarget', () => {
  it('buckets closed-won by fiscal quarter across the whole year', () => {
    const q1Win = opp({
      id: 'q1',
      expectedCloseDate: '2026-03-01T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-03-01T00:00:00Z',
      forecastedRevenue: 25_000,
    });
    const q2Win = opp({
      id: 'q2',
      expectedCloseDate: '2026-05-20T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-05-20T00:00:00Z',
      forecastedRevenue: 50_000,
    });
    const priorYearWin = opp({
      id: 'py',
      expectedCloseDate: '2025-03-01T00:00:00Z',
      outcome: 'won',
      closedAt: '2025-03-01T00:00:00Z',
      forecastedRevenue: 999_999,
    });
    const targets = [
      target('FY27-Q1', 100_000),
      target('FY27-Q1', 20_000),
      target('FY27-Q3', 80_000),
    ];

    const rows = quarterlyClosedWonAndTarget([q1Win, q2Win, priorYearWin], targets);
    expect(rows.map((row) => row.quarter)).toEqual(['FY27-Q1', 'FY27-Q2', 'FY27-Q3', 'FY27-Q4']);
    expect(rows[0]).toEqual({ quarter: 'FY27-Q1', closedWon: 25_000, target: 120_000 });
    expect(rows[1].closedWon).toBe(50_000);
    expect(rows[2].closedWon).toBe(0);
    // Prior-year wins never appear in FY27 quarters.
    expect(rows.every((row) => row.closedWon < 999_999)).toBe(true);
  });
});

// ---- forecasting helpers ----------------------------------------------------

describe('daysLeftInQuarter', () => {
  it('measures from the snapshot date to the quarter end', () => {
    // Snapshot 2026-09-18; FY27-Q3 ends 2026-11-01 → 44 days.
    expect(daysLeftInQuarter('FY27-Q3')).toBe(44);
    expect(daysLeftInQuarter('FY27-Q2')).toBe(0); // already over
  });
});

// ---- weekly goal / calendar -------------------------------------------------

function activity(
  fields: Partial<ActivityMeeting> & Pick<ActivityMeeting, 'id' | 'occurredAt'>,
): ActivityMeeting {
  return {
    partnerId: 'p-01',
    partnerManagerId: 'pm-01',
    type: 'partner-cadence',
    durationMinutes: 30,
    ...fields,
  };
}

describe('currentWeekMeetings', () => {
  it('returns only the manager’s meetings inside the snapshot week, sorted', () => {
    const inWeek = activity({ id: 'b', occurredAt: '2026-09-15T10:00:00Z' });
    const earlier = activity({ id: 'a', occurredAt: '2026-09-14T09:00:00Z' });
    const otherManager = activity({
      id: 'c',
      occurredAt: '2026-09-14T09:30:00Z',
      partnerManagerId: 'pm-02',
    });
    const lastWeek = activity({ id: 'd', occurredAt: '2026-09-07T09:00:00Z' });
    expect(currentWeekMeetings([otherManager, inWeek, earlier, lastWeek], 'pm-01')).toEqual([
      earlier,
      inWeek,
    ]);
  });
});

describe('weeklyGoalProgress', () => {
  const inWeek = [
    activity({ id: 'm1', occurredAt: '2026-09-15T09:00:00Z', type: 'partner-cadence' }),
    activity({ id: 'm2', occurredAt: '2026-09-16T10:00:00Z', type: 'pio-interlock' }),
  ];

  it('counts meetings and PIO interlocks against the weekly goals', () => {
    const progress = weeklyGoalProgress(inWeek, {});
    expect(progress).toEqual({ meetings: 2, meetingsGoal: 10, pioMeetings: 1, pioGoal: 3 });
  });

  it('lets manual classifications override partner and call type', () => {
    const progress = weeklyGoalProgress(inWeek, {
      m1: { partnerId: 'p-09', type: 'pio-interlock' },
    });
    expect(progress).toEqual({ meetings: 2, meetingsGoal: 10, pioMeetings: 2, pioGoal: 3 });
  });

  it('respects partner manager and partner scopes', () => {
    const mine = [
      ...inWeek,
      activity({
        id: 'm3',
        occurredAt: '2026-09-17T11:00:00Z',
        partnerManagerId: 'pm-02',
      }),
    ];
    expect(weeklyGoalProgress(mine, {}, 'pm-01').meetings).toBe(2);
    expect(weeklyGoalProgress(mine, {}, 'pm-01', new Set(['p-02'])).meetings).toBe(0);
    expect(
      weeklyGoalProgress(
        mine,
        { m1: { partnerId: 'p-02', type: 'partner-cadence' } },
        'pm-01',
        new Set(['p-02']),
      ).meetings,
    ).toBe(1);
  });

  it('resolves classified ownership before manager filtering — once across both managers', () => {
    // pm-01's call, reclassified onto a prospect in pm-02's book. The
    // classification owns the meeting now: the old manager's partner set
    // rejects it and the new manager's set counts it. Applying the raw
    // calendar attribution on top of the partner set would drop it from
    // BOTH scopes — the sum over the two managers must be exactly one.
    const call = activity({ id: 'mx', occurredAt: '2026-09-15T09:00:00Z' });
    const moved: Record<string, MeetingClassification> = {
      mx: { partnerId: 'prospect-b', type: 'pio-interlock' },
    };
    const a = weeklyGoalProgress([call], moved, 'pm-01', new Set(['p-01']));
    const b = weeklyGoalProgress([call], moved, 'pm-02', new Set(['p-02', 'prospect-b']));
    expect(a.meetings).toBe(0);
    expect(a.pioMeetings).toBe(0);
    expect(b.meetings).toBe(1);
    expect(b.pioMeetings).toBe(1);
    expect(a.meetings + b.meetings).toBe(1);
  });

  it('keeps an unclassified call in its raw manager’s partner scope alone', () => {
    const call = activity({ id: 'mx', occurredAt: '2026-09-15T09:00:00Z' });
    const a = weeklyGoalProgress([call], {}, 'pm-01', new Set(['p-01']));
    const b = weeklyGoalProgress([call], {}, 'pm-02', new Set(['p-02', 'prospect-b']));
    expect(a.meetings).toBe(1);
    expect(b.meetings).toBe(0);
    expect(a.meetings + b.meetings).toBe(1);
  });

  it('keeps raw-manager inclusion when no partner set scopes the query', () => {
    // Without a partner set the classification still retypes the call, but
    // membership follows the raw calendar attribution, unchanged.
    const call = activity({ id: 'mx', occurredAt: '2026-09-15T09:00:00Z' });
    const moved: Record<string, MeetingClassification> = {
      mx: { partnerId: 'p-02', type: 'pio-interlock' },
    };
    const a = weeklyGoalProgress([call], moved, 'pm-01');
    expect(a.meetings).toBe(1);
    expect(a.pioMeetings).toBe(1);
    expect(weeklyGoalProgress([call], moved, 'pm-02').meetings).toBe(0);
  });
});

describe('weeklyActivity', () => {
  // One call on pm-01's partner p-01, mid snapshot week (the last bucket).
  const call = activity({ id: 'mx', occurredAt: '2026-09-15T09:00:00Z', type: 'discovery' });
  const movedToProspectB: Record<string, MeetingClassification> = {
    mx: { partnerId: 'prospect-b', type: 'pio-interlock' },
  };

  it('scopes the week to the raw manager when no partner set is given', () => {
    const rows = weeklyActivity([call], 'pm-01');
    expect(rows[rows.length - 1].total).toBe(1);
    expect(weeklyActivity([call], 'pm-02')[rows.length - 1].total).toBe(0);
  });

  it('resolves classified ownership before manager filtering — once across both managers', () => {
    // The same cross-manager reclassification as the goal: zero buckets for
    // the old manager's scope, the call and its new type in the new one.
    const a = weeklyActivity([call], 'pm-01', new Set(['p-01']), movedToProspectB);
    const b = weeklyActivity([call], 'pm-02', new Set(['p-02', 'prospect-b']), movedToProspectB);
    expect(a[a.length - 1].total).toBe(0);
    expect(b[b.length - 1].total).toBe(1);
    expect(b[b.length - 1].byType['pio-interlock']).toBe(1);
    expect(a[a.length - 1].total + b[b.length - 1].total).toBe(1);
  });

  it('keeps an unclassified call in its raw manager’s partner scope alone', () => {
    const a = weeklyActivity([call], 'pm-01', new Set(['p-01']));
    const b = weeklyActivity([call], 'pm-02', new Set(['p-02', 'prospect-b']));
    expect(a[a.length - 1].total).toBe(1);
    expect(b[b.length - 1].total).toBe(0);
  });

  it('retypes the split without moving membership when no partner set is given', () => {
    const a = weeklyActivity([call], 'pm-01', undefined, movedToProspectB);
    expect(a[a.length - 1].total).toBe(1);
    expect(a[a.length - 1].byType['pio-interlock']).toBe(1);
    expect(weeklyActivity([call], 'pm-02', undefined, movedToProspectB)[a.length - 1].total).toBe(
      0,
    );
  });
});

// ---- forecast quality -------------------------------------------------------

describe('forecastCategoryOf', () => {
  it('derives the bucket from the stage when the opportunity has none', () => {
    expect(
      forecastCategoryOf(
        opp({ id: 'a', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'discovery' }),
      ),
    ).toBe('long-shot');
    expect(
      forecastCategoryOf(
        opp({ id: 'b', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'scope' }),
      ),
    ).toBe('pipeline');
    expect(
      forecastCategoryOf(
        opp({ id: 'c', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'tech-validation' }),
      ),
    ).toBe('best-case');
    expect(
      forecastCategoryOf(
        opp({ id: 'd', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'business-case' }),
      ),
    ).toBe('commit');
  });

  it('prefers an explicit category over the stage heuristic', () => {
    const explicit = opp({
      id: 'e',
      expectedCloseDate: '2026-09-30T00:00:00Z',
      stage: 'deal-desk-review',
      forecastCategory: 'long-shot',
    });
    expect(forecastCategoryOf(explicit)).toBe('long-shot');
  });
});

describe('weightedForecast', () => {
  it('applies each category weight to the open book', () => {
    const forecast = weightedForecast([
      opp({
        id: 'a',
        expectedCloseDate: '2026-09-30T00:00:00Z',
        forecastedRevenue: 100_000,
        forecastCategory: 'commit',
      }),
      opp({
        id: 'b',
        expectedCloseDate: '2026-09-30T00:00:00Z',
        forecastedRevenue: 40_000,
        forecastCategory: 'pipeline',
      }),
      opp({
        id: 'c',
        expectedCloseDate: '2026-09-30T00:00:00Z',
        forecastedRevenue: 20_000,
        forecastCategory: 'long-shot',
      }),
    ]);
    expect(forecast.total).toBe(102_000); // 90k + 10k + 2k
    const rows = Object.fromEntries(forecast.rows.map((row) => [row.category, row]));
    expect(rows.commit).toMatchObject({ value: 90_000, count: 1 });
    expect(rows.pipeline).toMatchObject({ value: 10_000, count: 1 });
    expect(rows['long-shot']).toMatchObject({ value: 2_000, count: 1 });
    expect(rows['best-case']).toMatchObject({ value: 0, count: 0 });
  });
});

describe('weeklyForecastRows', () => {
  it('spans the whole quarter in Monday-aligned buckets, stub days folded into week one', () => {
    const rows = weeklyForecastRows([], 'FY27-Q3');
    expect(rows).toHaveLength(13);
    // Q3 runs Aug 1 – Nov 1 and Aug 1 is a Saturday, so week one absorbs the
    // weekend stub and runs [Aug 1, Aug 10); Mondays carry the rest.
    expect(rows[0]).toMatchObject({
      weekStart: '2026-08-01T00:00:00.000Z',
      weekEnd: '2026-08-10T00:00:00.000Z',
    });
    expect(rows[1].weekStart).toBe('2026-08-10T00:00:00.000Z');
    expect(rows[rows.length - 1]).toMatchObject({
      weekStart: '2026-10-26T00:00:00.000Z',
      weekEnd: '2026-11-01T00:00:00.000Z',
    });
  });

  it('lights up one week at a time as the as-of date advances', () => {
    // Snapshot Sep 18 (Friday): the weeks through Sep 14 have begun.
    expect(weeklyForecastRows([], 'FY27-Q3').map((row) => row.hasStarted)).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    // In week 3 of the quarter, only weeks 1-3 carry points.
    const early = weeklyForecastRows([], 'FY27-Q3', new Date('2026-08-20T00:00:00Z'));
    expect(early.filter((row) => row.hasStarted)).toHaveLength(3);
    expect(early[2]).toMatchObject({ weekStart: '2026-08-17T00:00:00.000Z', hasStarted: true });
    expect(early[3].hasStarted).toBe(false);
  });

  it('matches the open pipeline and weighted forecast tiles at the latest started week', () => {
    const opps = [
      opp({ id: 'a', expectedCloseDate: '2026-09-01T00:00:00Z' }),
      opp({ id: 'b', expectedCloseDate: '2026-10-15T00:00:00Z', stage: 'deal-desk-review' }),
      opp({
        id: 'c',
        expectedCloseDate: '2026-09-10T00:00:00Z',
        outcome: 'won',
        closedAt: '2026-09-05T00:00:00Z',
      }),
    ];
    const started = weeklyForecastRows(opps, 'FY27-Q3').filter((row) => row.hasStarted);
    const latest = started[started.length - 1];
    const book = openOpportunities(filterByPhase(opps, 'q3'));
    expect(latest.total).toBe(openPipeline(book).value);
    expect(latest.weightedTotal).toBe(weightedForecast(book).total);
  });

  it('carries a deal only in the weeks it exists and is open', () => {
    const rows = weeklyForecastRows(
      [
        // Created Aug 5, won Sep 1: in the book between those dates only.
        opp({
          id: 'a',
          createdAt: '2026-08-05T00:00:00Z',
          expectedCloseDate: '2026-09-10T00:00:00Z',
          outcome: 'won',
          closedAt: '2026-09-01T00:00:00Z',
        }),
        // Scheduled to close outside the quarter: never in the in-quarter book.
        opp({ id: 'b', expectedCloseDate: '2026-11-15T00:00:00Z' }),
      ],
      'FY27-Q3',
    );
    // Weeks: Aug 1, Aug 10, Aug 17, Aug 24, Aug 31, ... — the deal is in the
    // book from its creation (Aug 5) until the week it closes (Sep 1).
    expect(rows.map((row) => row.total)).toEqual([
      10_000, 10_000, 10_000, 10_000, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it('weights each category bucket at its close probability', () => {
    const started = weeklyForecastRows(
      [
        opp({ id: 'a', expectedCloseDate: '2026-09-01T00:00:00Z', stage: 'deal-desk-review' }),
        opp({ id: 'b', expectedCloseDate: '2026-09-01T00:00:00Z', stage: 'discovery' }),
      ],
      'FY27-Q3',
    ).filter((row) => row.hasStarted);
    const latest = started[started.length - 1];
    expect(latest.raw.commit).toBe(10_000);
    expect(latest.weighted.commit).toBe(9_000);
    expect(latest.raw['long-shot']).toBe(10_000);
    expect(latest.weighted['long-shot']).toBe(1_000);
    expect(latest.total).toBe(20_000);
    expect(latest.weightedTotal).toBe(10_000);
  });

  it('freezes the in-progress week at the as-of date', () => {
    const opps = [
      opp({
        id: 'a',
        createdAt: '2026-08-22T00:00:00Z',
        expectedCloseDate: '2026-10-01T00:00:00Z',
      }),
    ];
    // Aug 20 sits inside the week of Aug 17: a deal created Aug 22 is not in
    // its state, but lands once the next week has begun.
    const asOfAug20 = weeklyForecastRows(opps, 'FY27-Q3', new Date('2026-08-20T00:00:00Z'));
    expect(asOfAug20[2]).toMatchObject({ weekStart: '2026-08-17T00:00:00.000Z', total: 0 });
    const asOfAug25 = weeklyForecastRows(opps, 'FY27-Q3', new Date('2026-08-25T00:00:00Z'));
    expect(asOfAug25[3]).toMatchObject({ weekStart: '2026-08-24T00:00:00.000Z', total: 10_000 });
  });

  it('leaves a future quarter with an empty axis', () => {
    const rows = weeklyForecastRows(
      [opp({ id: 'a', expectedCloseDate: '2026-12-01T00:00:00Z' })],
      'FY27-Q4',
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => !row.hasStarted && row.total === 0)).toBe(true);
  });
});

describe('weeklyForecastRows with recorded history', () => {
  // One deal's worth of history: a recording at every Monday of Q3 through
  // the snapshot week, already folded to per-category totals the way the
  // provider's aggregation emits them (the raw rows are provider-private).
  const mondays = [
    '2026-08-10',
    '2026-08-17',
    '2026-08-24',
    '2026-08-31',
    '2026-09-07',
    '2026-09-14',
  ].map((day) => `${day}T00:00:00.000Z`);

  const book = [opp({ id: 'a', expectedCloseDate: '2026-09-30T00:00:00Z' })];

  it('reads closed weeks from the recording rather than the current book', () => {
    // The deal was called Pipeline at $100k all quarter, and today reads
    // Commit at $500k. History must show what was recorded, not today.
    const history = mondays.map((takenAt) => recorded(takenAt, { pipeline: 100_000 }));
    const edited = [
      opp({
        id: 'a',
        expectedCloseDate: '2026-09-30T00:00:00Z',
        forecastedRevenue: 500_000,
        forecastCategory: 'commit',
      }),
    ];
    const rows = weeklyForecastRows(edited, 'FY27-Q3', SNAPSHOT_DATE, history);
    const recordedWeeks = rows.filter((row) => row.recordedAt !== undefined);
    expect(recordedWeeks).toHaveLength(6);
    for (const row of recordedWeeks) {
      expect(row.total).toBe(100_000);
      expect(row.raw.pipeline).toBe(100_000);
      expect(row.weightedTotal).toBe(25_000); // 100k × 25%, the call of the day
    }
  });

  it('keeps the in-progress week live, so it still matches the tiles', () => {
    const history = mondays.map((takenAt) => recorded(takenAt, { pipeline: 100_000 }));
    const rows = weeklyForecastRows(book, 'FY27-Q3', SNAPSHOT_DATE, history);
    // Snapshot Sep 18 sits inside the week of Sep 14, whose own recording is
    // its opening boundary, not a state inside it: that week stays live.
    const live = rows.filter((row) => row.hasStarted && row.recordedAt === undefined);
    expect(live).toHaveLength(1);
    expect(live[0].weekStart).toBe('2026-09-14T00:00:00.000Z');
    const open = openOpportunities(filterByPhase(book, 'q3'));
    expect(live[0].total).toBe(openPipeline(open).value);
    expect(live[0].weightedTotal).toBe(weightedForecast(open).total);
  });

  it('draws a recorded zero as a drop, not as a week to reconstruct', () => {
    // The aggregation reports 100k of pipeline for the first three Mondays
    // and zero after — the deal's recorded close slid into Q4, so it clipped
    // out of the later recordings (the raw-side clip is pinned in
    // mock/book.test.ts). Today the deal is a Q4 deal, so deriving from the
    // current book would hide it from every week and leave no drop behind.
    const history = mondays.map((takenAt, index) =>
      recorded(takenAt, index < 3 ? { pipeline: 100_000 } : {}),
    );
    const slipped = [opp({ id: 'a', expectedCloseDate: '2026-11-20T00:00:00Z' })];
    const totals = weeklyForecastRows(slipped, 'FY27-Q3', SNAPSHOT_DATE, history)
      .filter((row) => row.recordedAt !== undefined)
      .map((row) => row.total);
    expect(totals).toEqual([100_000, 100_000, 100_000, 0, 0, 0]);
  });

  it('falls back to the current book for weeks history does not cover', () => {
    // History starts in September, so August weeks have nothing recorded.
    const history = mondays.slice(4).map((takenAt) => recorded(takenAt, { pipeline: 100_000 }));
    const rows = weeklyForecastRows(book, 'FY27-Q3', SNAPSHOT_DATE, history);
    const august = rows.filter(
      (row) => row.hasStarted && new Date(row.weekStart) < new Date('2026-08-31T00:00:00Z'),
    );
    expect(august.length).toBeGreaterThan(0);
    for (const row of august) {
      expect(row.recordedAt).toBeUndefined();
      expect(row.total).toBe(10_000); // the fixture's current amount
    }
    expect(rows.filter((row) => row.recordedAt !== undefined)).toHaveLength(2);
  });

  it('ignores recordings outside the quarter being charted', () => {
    const history = [
      recorded('2026-07-06T00:00:00.000Z', { pipeline: 100_000 }),
      recorded('2026-11-09T00:00:00.000Z', { pipeline: 100_000 }),
    ];
    const rows = weeklyForecastRows(book, 'FY27-Q3', SNAPSHOT_DATE, history);
    expect(rows.every((row) => row.recordedAt === undefined)).toBe(true);
  });
});

describe('categoryStageMismatches', () => {
  it('splits calls that disagree with the stage by direction and sums their value', () => {
    // discovery implies long-shot, so calling commit is above stage.
    const optimistic = opp({
      id: 'a',
      expectedCloseDate: '2026-09-30T00:00:00Z',
      stage: 'discovery',
      forecastedRevenue: 100_000,
      forecastCategory: 'commit',
    });
    // deal-desk-review implies commit, so calling long-shot is below stage.
    const cautious = opp({
      id: 'b',
      expectedCloseDate: '2026-09-30T00:00:00Z',
      stage: 'deal-desk-review',
      forecastedRevenue: 40_000,
      forecastCategory: 'long-shot',
    });
    const agreeing = opp({
      id: 'c',
      expectedCloseDate: '2026-09-30T00:00:00Z',
      stage: 'scope',
      forecastedRevenue: 25_000,
      forecastCategory: 'pipeline',
    });

    const result = categoryStageMismatches([optimistic, cautious, agreeing]);

    expect(result.above).toHaveLength(1);
    expect(result.above[0]).toMatchObject({
      fromStage: 'long-shot',
      called: 'commit',
      direction: 'above',
    });
    expect(result.below).toHaveLength(1);
    expect(result.below[0]).toMatchObject({
      fromStage: 'commit',
      called: 'long-shot',
      direction: 'below',
    });
    expect(result.aboveValue).toBe(100_000);
    expect(result.belowValue).toBe(40_000);
  });

  it('treats a deal with no explicit category as agreeing with its stage', () => {
    // An unset category falls back to the stage heuristic, so it can never
    // register as a mismatch. Without this the whole book would look "called".
    const result = categoryStageMismatches([
      opp({ id: 'a', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'tech-validation' }),
    ]);
    expect(result.above).toHaveLength(0);
    expect(result.below).toHaveLength(0);
    expect(result.aboveValue).toBe(0);
    expect(result.belowValue).toBe(0);
  });
});

// ---- registration history order + roster overlays -------------------------

describe('registrationsNewestFirst', () => {
  it('orders newest submission first across every status, id breaking ties', () => {
    const rows = [
      { ...registration('2026-09-10T00:00:00Z'), id: 'reg-b', status: 'approved' as const },
      { ...registration('2026-09-17T00:00:00Z'), id: 'reg-a' },
      { ...registration('2026-09-10T00:00:00Z'), id: 'reg-a', status: 'rejected' as const },
      { ...registration('2026-09-01T00:00:00Z'), id: 'reg-c', status: 'rejected' as const },
    ];

    expect(registrationsNewestFirst(rows).map((row) => row.id)).toEqual([
      'reg-a', // Sep 17
      'reg-a', // Sep 10, id tiebreak
      'reg-b',
      'reg-c',
    ]);
    // The tiebreak is what makes the walk a total order: the cursor contract
    // needs "the same page twice means the same rows", and an unstable sort
    // over equal timestamps would not give it.
    expect(registrationsNewestFirst(rows)).toEqual(registrationsNewestFirst([...rows].reverse()));
  });

  it('does not mutate the input', () => {
    const rows = [registration('2026-09-10T00:00:00Z'), registration('2026-09-17T00:00:00Z')];
    const before = rows.map((row) => row.id);
    registrationsNewestFirst(rows);
    expect(rows.map((row) => row.id)).toEqual(before);
  });
});

describe('applyTeamRosterOverlays', () => {
  const user = (id: string): TeamUser => ({
    id,
    name: `User ${id}`,
    email: `${id}@factory.example`,
    role: 'deal-desk-ops',
    channels: ['email', 'in-app'],
    status: 'active',
    addedAt: '2026-09-01T00:00:00Z',
  });

  it('folds patches into the provider roster by id and appends session adds', () => {
    const result = applyTeamRosterOverlays(
      [user('user-a'), user('user-b')],
      { 'user-a': { status: 'suspended' } },
      [user('user-c')],
    );

    expect(result.map((entry) => entry.id)).toEqual(['user-a', 'user-b', 'user-c']);
    expect(result[0]!.status).toBe('suspended');
    expect(result[1]!.status).toBe('active');
  });

  it('ignores a patch naming a user the provider never served', () => {
    const result = applyTeamRosterOverlays([user('user-a')], {
      'user-ghost': { status: 'suspended' },
    });
    expect(result.map((entry) => entry.id)).toEqual(['user-a']);
    expect(result[0]!.status).toBe('active');
  });

  it('does not mutate the provider roster it was handed', () => {
    const roster = [user('user-a')];
    applyTeamRosterOverlays(roster, { 'user-a': { status: 'suspended' } });
    expect(roster[0]!.status).toBe('active');
  });
});

// ---- quarter → phase bridge ------------------------------------------------

describe('phaseForQuarter', () => {
  it('is the inverse of the phase → quarter mapping', () => {
    // The scoped contract is phrased in quarters, since that is the unit a
    // caller thinks in; every window in this file is a phase. One mapping, in
    // one place, so the two cannot drift.
    for (const phase of ['q1', 'q2', 'q3', 'q4'] as const) {
      expect(phaseForQuarter(FISCAL_PHASE_META[phase].quarter!)).toBe(phase);
    }
  });

  it('throws on a quarter the fiscal calendar does not define', () => {
    // A fallback to Q1 would answer a question about FY28-Q4 with FY27 Q1's
    // numbers, and a plausible wrong number is worse than a crash.
    expect(() => phaseForQuarter('FY28-Q1')).toThrowError(/FY28-Q1/);
    expect(() => phaseForQuarter('fy')).toThrowError(/fy/);
  });

  it('agrees with the phase whose window is the snapshot quarter', () => {
    const phase = phaseForQuarter(CURRENT_FISCAL_QUARTER);
    expect(phaseWindow(phase).targetQuarters).toEqual([CURRENT_FISCAL_QUARTER]);
  });
});
