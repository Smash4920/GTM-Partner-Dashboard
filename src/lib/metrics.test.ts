import { describe, expect, it } from 'vitest';
import type {
  ActivityMeeting,
  DashboardData,
  DealRegistration,
  Opportunity,
  Partner,
  Target,
} from '../data/types';
import {
  approvedNotConverted,
  businessDaysBetween,
  categoryStageMismatches,
  closedWonForPhase,
  closedWonPriorYearForPhase,
  coverageRatio,
  currentWeekMeetings,
  daysLeftInQuarter,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  filterByPhase,
  filterRegistrationsByPhase,
  forecastCategoryOf,
  formatCoverage,
  partnerLeaderboard,
  phaseWindow,
  quarterlyClosedWonAndTarget,
  registrationConversionTimes,
  registrationSlaState,
  registrationsPastSla,
  remainingQuota,
  weeklyGoalProgress,
  weightedForecast,
  winRateForPhase,
} from './metrics';

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

const partner: Partner = {
  id: 'p-01',
  name: 'Northwind Solutions',
  type: 'reseller',
  tier: 'gold',
  region: 'na',
  accountManager: 'Dana Reyes',
  partnerManagerId: 'pm-01',
  joinedAt: '2024-01-01T00:00:00Z',
};

function dashboard(overrides: Partial<DashboardData>): DashboardData {
  return {
    partnerManagers: [],
    partners: [],
    registrations: [],
    opportunities: [],
    targets: [],
    activities: [],
    certifications: [],
    ...overrides,
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
    expect(filterRegistrationsByPhase([registration('2026-08-05T00:00:00Z')], 'q3')).toHaveLength(1);
    expect(filterRegistrationsByPhase([registration('2026-05-05T00:00:00Z')], 'q3')).toHaveLength(0);
  });
});

// ---- coverage and quota ----------------------------------------------------

describe('coverageRatio', () => {
  const targets = [target('FY27-Q3', 100_000)];

  it('counts open pipeline across the whole phase, not just through the snapshot', () => {
    const closedWon = opp({
      id: 'w',
      expectedCloseDate: '2026-08-05T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-08-05T00:00:00Z',
      forecastedRevenue: 20_000,
    });
    const beforeSnapshot = opp({ id: 'o1', expectedCloseDate: '2026-09-10T00:00:00Z', forecastedRevenue: 60_000 });
    const lateInPhase = opp({ id: 'o2', expectedCloseDate: '2026-10-15T00:00:00Z', forecastedRevenue: 100_000 });
    const nextQuarter = opp({ id: 'o3', expectedCloseDate: '2026-12-01T00:00:00Z', forecastedRevenue: 500_000 });

    // Remaining quota is 80k; Q3-scheduled open pipeline is 160k (the 500k
    // Q4 deal must not leak in), so coverage is 2x.
    expect(coverageRatio([closedWon, beforeSnapshot, lateInPhase, nextQuarter], targets, 'q3')).toBe(2);
  });

  it('returns null when the phase target is already met', () => {
    const closedWon = opp({
      id: 'w',
      expectedCloseDate: '2026-08-05T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-08-05T00:00:00Z',
      forecastedRevenue: 150_000,
    });
    expect(coverageRatio([closedWon], targets, 'q3')).toBeNull();
    expect(formatCoverage(coverageRatio([closedWon], targets, 'q3'))).toBe('Target met');
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

// ---- leaderboard ------------------------------------------------------------

describe('partnerLeaderboard', () => {
  it('ranks partners by closed-won for the selected phase', () => {
    const data = dashboard({
      partners: [partner, { ...partner, id: 'p-02', name: 'Second Partner' }],
      opportunities: [
        opp({
          id: 'a',
          partnerId: 'p-01',
          expectedCloseDate: '2026-08-05T00:00:00Z',
          outcome: 'won',
          closedAt: '2026-08-05T00:00:00Z',
          forecastedRevenue: 10,
        }),
        opp({
          id: 'b',
          partnerId: 'p-02',
          expectedCloseDate: '2026-05-05T00:00:00Z',
          outcome: 'won',
          closedAt: '2026-05-05T00:00:00Z',
          forecastedRevenue: 20,
        }),
      ],
    });

    const q3 = partnerLeaderboard(data, 'all', undefined, 'q3');
    expect(q3[0]?.partner.id).toBe('p-01');
    expect(q3[0]?.closedWonValue).toBe(10);

    const q2 = partnerLeaderboard(data, 'all', undefined, 'q2');
    expect(q2[0]?.partner.id).toBe('p-02');
    expect(q2[0]?.closedWonValue).toBe(20);
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
      weeklyGoalProgress(mine, { m1: { partnerId: 'p-02', type: 'partner-cadence' } }, 'pm-01', new Set(['p-02'])).meetings,
    ).toBe(1);
  });
});

// ---- forecast quality -------------------------------------------------------

describe('forecastCategoryOf', () => {
  it('derives the bucket from the stage when the opportunity has none', () => {
    expect(forecastCategoryOf(opp({ id: 'a', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'discovery' }))).toBe('long-shot');
    expect(forecastCategoryOf(opp({ id: 'b', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'scope' }))).toBe('pipeline');
    expect(forecastCategoryOf(opp({ id: 'c', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'tech-validation' }))).toBe('best-case');
    expect(forecastCategoryOf(opp({ id: 'd', expectedCloseDate: '2026-09-30T00:00:00Z', stage: 'business-case' }))).toBe('commit');
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
      opp({ id: 'a', expectedCloseDate: '2026-09-30T00:00:00Z', forecastedRevenue: 100_000, forecastCategory: 'commit' }),
      opp({ id: 'b', expectedCloseDate: '2026-09-30T00:00:00Z', forecastedRevenue: 40_000, forecastCategory: 'pipeline' }),
      opp({ id: 'c', expectedCloseDate: '2026-09-30T00:00:00Z', forecastedRevenue: 20_000, forecastCategory: 'long-shot' }),
    ]);
    expect(forecast.total).toBe(102_000); // 90k + 10k + 2k
    const rows = Object.fromEntries(forecast.rows.map((row) => [row.category, row]));
    expect(rows.commit).toMatchObject({ value: 90_000, count: 1 });
    expect(rows.pipeline).toMatchObject({ value: 10_000, count: 1 });
    expect(rows['long-shot']).toMatchObject({ value: 2_000, count: 1 });
    expect(rows['best-case']).toMatchObject({ value: 0, count: 0 });
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

// ---- deal-registration ops --------------------------------------------------

function reg(
  fields: Partial<DealRegistration> & Pick<DealRegistration, 'id' | 'submittedAt' | 'status'>,
): DealRegistration {
  return {
    partnerId: 'p-01',
    accountName: 'Test Account',
    amount: 50_000,
    ...fields,
  };
}

describe('businessDaysBetween', () => {
  it('counts UTC weekdays excluding the start day', () => {
    expect(businessDaysBetween('2026-09-18T00:00:00Z', '2026-09-18T00:00:00Z')).toBe(0);
    // Friday → Monday is 1 business day.
    expect(businessDaysBetween('2026-09-11T00:00:00Z', '2026-09-14T00:00:00Z')).toBe(1);
    // Monday → Friday same week is 4.
    expect(businessDaysBetween('2026-09-14T00:00:00Z', '2026-09-18T00:00:00Z')).toBe(4);
    // Monday → next Monday is 5 (Tue–Fri + Mon).
    expect(businessDaysBetween('2026-09-14T00:00:00Z', '2026-09-21T00:00:00Z')).toBe(5);
  });
});

describe('registrationSlaState', () => {
  it('flags submissions inside the 5-business-day window as within SLA', () => {
    // Snapshot 2026-09-18. Submitted Monday, four business days earlier.
    expect(registrationSlaState(reg({ id: 'r1', submittedAt: '2026-09-14T00:00:00Z', status: 'pending' }))).toBe('within-sla');
  });

  it('flags submissions at or past 5 business days as past SLA', () => {
    expect(registrationSlaState(reg({ id: 'r2', submittedAt: '2026-09-07T00:00:00Z', status: 'pending' }))).toBe('past-sla');
  });
});

describe('registrationsPastSla', () => {
  it('returns only pending registrations outside the SLA, oldest first', () => {
    const old = reg({ id: 'r1', submittedAt: '2026-09-01T00:00:00Z', status: 'pending' });
    const fresh = reg({ id: 'r2', submittedAt: '2026-09-17T00:00:00Z', status: 'pending' });
    const approved = reg({ id: 'r3', submittedAt: '2026-09-01T00:00:00Z', status: 'approved', decisionAt: '2026-09-05T00:00:00Z' });
    expect(registrationsPastSla([approved, fresh, old])).toEqual([old]);
  });
});

describe('approvedNotConverted and exclusivityLapsed', () => {
  const lapsed = reg({
    id: 'r1',
    submittedAt: '2026-06-01T00:00:00Z',
    status: 'approved',
    decisionAt: '2026-07-01T00:00:00Z',
  });
  const inWindow = reg({
    id: 'r2',
    submittedAt: '2026-08-15T00:00:00Z',
    status: 'approved',
    decisionAt: '2026-08-20T00:00:00Z',
  });
  const converted = reg({
    id: 'r3',
    submittedAt: '2026-07-01T00:00:00Z',
    status: 'approved',
    decisionAt: '2026-07-05T00:00:00Z',
    convertedTo: 'opp-1',
  });
  const pending = reg({ id: 'r4', submittedAt: '2026-09-15T00:00:00Z', status: 'pending' });

  it('keeps only approved registrations without an opportunity, oldest decision first', () => {
    const leaking = approvedNotConverted([converted, pending, inWindow, lapsed]);
    expect(leaking.map((item) => item.id)).toEqual(['r1', 'r2']);
  });

  it('flags exclusivity only past the 60-day window from approval', () => {
    expect(exclusivityLapsed(lapsed)).toBe(true);
    expect(exclusivityLapsed(inWindow)).toBe(false);
    expect(exclusivityLapsed(converted)).toBe(false);
    expect(exclusivityLapsed(pending)).toBe(false);
  });
});

describe('registrationConversionTimes', () => {
  const registrations = [
    reg({
      id: 'r1',
      submittedAt: '2026-08-01T00:00:00Z',
      status: 'approved',
      decisionAt: '2026-08-06T00:00:00Z',
      convertedTo: 'o-1',
    }),
    reg({
      id: 'r2',
      submittedAt: '2026-08-15T00:00:00Z',
      status: 'approved',
      decisionAt: '2026-08-20T00:00:00Z',
      convertedTo: 'o-2',
    }),
    reg({
      id: 'r3',
      submittedAt: '2026-08-25T00:00:00Z',
      status: 'approved',
      decisionAt: '2026-09-01T00:00:00Z',
    }),
  ];
  const opportunities = [
    opp({
      id: 'o-1',
      partnerId: 'p-01',
      expectedCloseDate: '2026-09-30T00:00:00Z',
      createdAt: '2026-08-10T00:00:00Z',
      outcome: 'won',
      closedAt: '2026-09-01T00:00:00Z',
    }),
    opp({
      id: 'o-2',
      partnerId: 'p-01',
      expectedCloseDate: '2026-09-30T00:00:00Z',
      createdAt: '2026-08-22T00:00:00Z',
      outcome: 'lost',
      closedAt: '2026-08-25T00:00:00Z',
    }),
  ];

  it('averages each hop only over the registrations that reached it', () => {
    const times = registrationConversionTimes(registrations, opportunities);
    expect(times.submittedToApproved).toBe(5.7); // (5 + 5 + 7) / 3
    expect(times.approvedToOpportunity).toBe(3); // (4 + 2) / 2
    expect(times.opportunityToWin).toBe(22); // only r1 won: Aug 10 → Sep 1
    expect(times.submittedToWin).toBe(31); // only r1 won: Aug 1 → Sep 1
  });

  it('returns null hops when no registration reached them', () => {
    expect(
      registrationConversionTimes([reg({ id: 'r4', submittedAt: '2026-09-01T00:00:00Z', status: 'pending' })], []),
    ).toEqual({
      submittedToApproved: null,
      approvedToOpportunity: null,
      opportunityToWin: null,
      submittedToWin: null,
    });
  });
});

describe('duplicateRegistrationGroups', () => {
  const secondPartner: Partner = { ...partner, id: 'p-02', name: 'Second Partner' };
  const regs = [
    reg({
      id: 'r1',
      partnerId: 'p-01',
      accountName: 'Shared Client',
      submittedAt: '2026-03-01T00:00:00Z',
      status: 'approved',
      decisionAt: '2026-03-05T00:00:00Z',
    }),
    reg({
      id: 'r2',
      partnerId: 'p-02',
      accountName: 'Shared Client',
      submittedAt: '2026-04-01T00:00:00Z',
      status: 'approved',
      decisionAt: '2026-04-05T00:00:00Z',
    }),
    reg({
      id: 'r3',
      partnerId: 'p-01',
      accountName: 'Solo Client',
      submittedAt: '2026-03-01T00:00:00Z',
      status: 'pending',
    }),
    reg({
      id: 'r4',
      partnerId: 'p-01',
      accountName: 'Same Partner Twice',
      submittedAt: '2026-02-01T00:00:00Z',
      status: 'pending',
    }),
    reg({
      id: 'r5',
      partnerId: 'p-01',
      accountName: 'Same Partner Twice',
      submittedAt: '2026-02-10T00:00:00Z',
      status: 'pending',
    }),
  ];

  it('groups only clients registered by two or more distinct partners', () => {
    const groups = duplicateRegistrationGroups(regs, [partner, secondPartner]);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.accountName).toBe('Shared Client');
    expect(group.distinctPartners).toBe(2);
    expect(group.firstSubmitted.id).toBe('r1');
    expect(group.registrations.map((item) => item.id)).toEqual(['r1', 'r2']);
  });
});
