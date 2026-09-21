import { describe, expect, it } from 'vitest';
import type {
  DashboardData,
  DealRegistration,
  Opportunity,
  Partner,
  Target,
} from '../data/types';
import {
  closedWonForPhase,
  closedWonPriorYearForPhase,
  coverageRatio,
  filterByPhase,
  filterRegistrationsByPhase,
  formatCoverage,
  partnerLeaderboard,
  phaseWindow,
  quarterlyClosedWonAndTarget,
  remainingQuota,
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
