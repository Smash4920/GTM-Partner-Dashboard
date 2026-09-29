import { afterEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_FISCAL_QUARTER, SNAPSHOT_DATE } from '../data/constants';
import type { DealRegistration, Opportunity, Partner, Target, TeamUser } from '../data/types';
import {
  approvedNotConverted,
  businessDaysBetween,
  businessDaysWaiting,
  calendarDaysBetween,
  closedWonForPhase,
  coverageState,
  daysLeftInQuarter,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  phaseWindow,
  registrationConversionTimes,
  registrationSlaAlerts,
  registrationSlaState,
  registrationsPastSla,
  remainingQuota,
} from './metrics';

// ---- fixtures --------------------------------------------------------------

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

function teamUser(fields: Partial<TeamUser> & Pick<TeamUser, 'id' | 'role'>): TeamUser {
  return {
    name: 'Alex Morgan',
    email: `${fields.id}@factory.ai`,
    status: 'active',
    channels: ['email'],
    addedAt: '2026-02-02T00:00:00Z',
    ...fields,
  };
}

// ---- deal-registration ops --------------------------------------------------

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
  it('counts the waiting counter in business days, not calendar days', () => {
    // Snapshot 2026-09-18 (Friday). A weekend submission separates the two
    // units: Sunday 09-06 is 12 calendar days back but only 10 working days.
    // The counter the UI shows sits next to a 5-business-day SLA and is
    // colored by it, so it has to be quoted in the same unit.
    const sunday = reg({ id: 'r-sun', submittedAt: '2026-09-06T00:00:00Z', status: 'pending' });
    expect(calendarDaysBetween(sunday.submittedAt, SNAPSHOT_DATE.toISOString())).toBe(12);
    expect(businessDaysWaiting(sunday)).toBe(10);
  });

  it('lapses exactly when the business-day counter reaches the SLA', () => {
    // The counter and the color read off the same scale: 4 working days is
    // inside, and the day it reaches 5 is the day it lapses.
    const monday = reg({ id: 'r-mon', submittedAt: '2026-09-14T00:00:00Z', status: 'pending' });
    const sunday = reg({ id: 'r-sun2', submittedAt: '2026-09-13T00:00:00Z', status: 'pending' });
    expect(businessDaysWaiting(monday)).toBe(4);
    expect(registrationSlaState(monday)).toBe('within-sla');
    expect(businessDaysWaiting(sunday)).toBe(5);
    expect(registrationSlaState(sunday)).toBe('past-sla');
  });

  it('flags submissions inside the 5-business-day window as within SLA', () => {
    // Snapshot 2026-09-18. Submitted Monday, four business days earlier.
    expect(
      registrationSlaState(
        reg({ id: 'r1', submittedAt: '2026-09-14T00:00:00Z', status: 'pending' }),
      ),
    ).toBe('within-sla');
  });

  it('flags submissions at or past 5 business days as past SLA', () => {
    expect(
      registrationSlaState(
        reg({ id: 'r2', submittedAt: '2026-09-07T00:00:00Z', status: 'pending' }),
      ),
    ).toBe('past-sla');
  });
});

describe('registrationsPastSla', () => {
  it('returns only pending registrations outside the SLA, oldest first', () => {
    const old = reg({ id: 'r1', submittedAt: '2026-09-01T00:00:00Z', status: 'pending' });
    const fresh = reg({ id: 'r2', submittedAt: '2026-09-17T00:00:00Z', status: 'pending' });
    const approved = reg({
      id: 'r3',
      submittedAt: '2026-09-01T00:00:00Z',
      status: 'approved',
      decisionAt: '2026-09-05T00:00:00Z',
    });
    expect(registrationsPastSla([approved, fresh, old])).toEqual([old]);
  });
});

describe('registrationSlaAlerts', () => {
  const manager = teamUser({ id: 'u-01', role: 'partner-manager', partnerManagerId: 'pm-01' });
  const dealDesk = teamUser({ id: 'u-02', role: 'deal-desk-ops' });
  const roster = [manager, dealDesk];

  // Snapshot 2026-09-18 (Friday). A Monday submission has 4 business days
  // behind it, which is one business day from the 5-business-day deadline.
  const warning = reg({ id: 'r-warning', submittedAt: '2026-09-14T00:00:00Z', status: 'pending' });
  const breached = reg({ id: 'r-breach', submittedAt: '2026-09-07T00:00:00Z', status: 'pending' });
  const inside = reg({ id: 'r-inside', submittedAt: '2026-09-17T00:00:00Z', status: 'pending' });

  it('flags the warning window a business day before the deadline', () => {
    const [alert] = registrationSlaAlerts([warning], [partner], roster);
    expect(alert.state).toBe('approaching');
    expect(alert.businessDaysWaiting).toBe(4);
    expect(alert.businessDaysRemaining).toBe(1);
    expect(alert.dueAt).toBe('2026-09-21T00:00:00.000Z');
  });

  it('flags registrations already past the SLA', () => {
    const [alert] = registrationSlaAlerts([breached], [partner], roster);
    expect(alert.state).toBe('breached');
    expect(alert.businessDaysRemaining).toBeLessThan(0);
    expect(alert.dueAt).toBe('2026-09-14T00:00:00.000Z');
  });

  it('leaves registrations still inside the SLA alone', () => {
    expect(registrationSlaAlerts([inside], [partner], roster)).toEqual([]);
  });

  it('ignores registrations that are no longer pending', () => {
    const approved = reg({
      id: 'r-approved',
      submittedAt: '2026-09-01T00:00:00Z',
      status: 'approved',
      decisionAt: '2026-09-03T00:00:00Z',
    });
    expect(registrationSlaAlerts([approved], [partner], roster)).toEqual([]);
  });

  it('routes to the aligned partner manager, and to the deal desk otherwise', () => {
    expect(registrationSlaAlerts([warning], [partner], roster)[0].owner?.id).toBe('u-01');
    // A manager without an alignment, or one whose access was revoked, cannot
    // own the alert: the deal desk catches it rather than nobody.
    expect(registrationSlaAlerts([warning], [partner], [dealDesk])[0].owner?.id).toBe('u-02');
    expect(
      registrationSlaAlerts(
        [warning],
        [partner],
        [{ ...manager, status: 'suspended' }, dealDesk],
      )[0].owner?.id,
    ).toBe('u-02');
  });

  it('keeps the first active manager aligned to a partner manager', () => {
    // A second user appended to the roster with the same alignment must not
    // silently take over the first one's alert queue.
    const second = teamUser({
      id: 'u-03',
      role: 'partner-manager',
      partnerManagerId: 'pm-01',
    });
    expect(registrationSlaAlerts([warning], [partner], [manager, second])[0].owner?.id).toBe(
      'u-01',
    );
  });

  it('still returns an alert with no owner when the roster is empty', () => {
    const [alert] = registrationSlaAlerts([warning], [partner], []);
    expect(alert.owner).toBeUndefined();
    expect(alert.state).toBe('approaching');
  });

  it('leads with the one-business-day-out warnings, then the most overdue registration', () => {
    const alerts = registrationSlaAlerts([warning, breached], [partner], roster);
    expect(alerts.map((alert) => alert.registration.id)).toEqual(['r-warning', 'r-breach']);
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
    // The approval hop is business days (the SLA's unit); the rest are
    // elapsed calendar days.
    expect(times.submittedToApprovedBusinessDays).toBe(4.3); // (4 + 4 + 5) / 3, weekends excluded
    expect(times.approvedToOpportunityCalendarDays).toBe(3); // (4 + 2) / 2
    expect(times.opportunityToWinCalendarDays).toBe(22); // only r1 won: Aug 10 → Sep 1
    expect(times.submittedToWinCalendarDays).toBe(31); // only r1 won: Aug 1 → Sep 1
  });

  it('measures the approval hop in business days, so weekends do not count against the SLA', () => {
    // Friday → Monday is 3 elapsed calendar days but only 1 business day.
    // Quoting the calendar figure beside a 5-business-day SLA would read a
    // compliant approval as more than half the budget spent.
    const friday = reg({
      id: 'r-fri',
      submittedAt: '2026-09-11T00:00:00Z', // Friday
      status: 'approved',
      decisionAt: '2026-09-14T00:00:00Z', // Monday
    });
    const times = registrationConversionTimes([friday], []);
    expect(calendarDaysBetween(friday.submittedAt, friday.decisionAt!)).toBe(3);
    expect(times.submittedToApprovedBusinessDays).toBe(1);
  });

  it('returns null hops when no registration reached them', () => {
    expect(
      registrationConversionTimes(
        [reg({ id: 'r4', submittedAt: '2026-09-01T00:00:00Z', status: 'pending' })],
        [],
      ),
    ).toEqual({
      submittedToApprovedBusinessDays: null,
      approvedToOpportunityCalendarDays: null,
      opportunityToWinCalendarDays: null,
      submittedToWinCalendarDays: null,
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

// ---- deterministic reporting time ------------------------------------------

describe('reporting time is the snapshot, not the wall clock (VAL-DATA-013)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes identical reports under two different wall clocks', () => {
    const targets = [target('FY27-Q3', 100_000)];
    const book = [
      opp({
        id: 'w',
        expectedCloseDate: '2026-08-05T00:00:00Z',
        outcome: 'won',
        closedAt: '2026-08-05T00:00:00Z',
        forecastedRevenue: 20_000,
      }),
      opp({ id: 'o1', expectedCloseDate: '2026-10-15T00:00:00Z', forecastedRevenue: 60_000 }),
    ];
    const pending = reg({
      id: 'r-pending',
      submittedAt: '2026-09-14T00:00:00Z',
      status: 'pending',
    });
    const approved = reg({
      id: 'r-approved',
      submittedAt: '2026-09-11T00:00:00Z', // Friday
      status: 'approved',
      decisionAt: '2026-09-14T00:00:00Z', // Monday
    });

    // One run of every snapshot-relative report a view renders.
    const report = () => ({
      coverage: coverageState(book, targets, 'q3'),
      remaining: remainingQuota(book, targets, 'q3'),
      closedWon: closedWonForPhase(book, 'q3'),
      daysLeft: daysLeftInQuarter(CURRENT_FISCAL_QUARTER),
      slaState: registrationSlaState(pending),
      waiting: businessDaysWaiting(pending),
      alerts: registrationSlaAlerts([pending], [partner], []),
      conversion: registrationConversionTimes([approved], []),
      phase: phaseWindow('q3'),
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T08:00:00Z'));
    const atSnapshotDay = report();
    vi.setSystemTime(new Date('2031-06-30T23:00:00Z'));
    const fiveYearsLater = report();

    // Wall-clock time moved by years; the reports did not move at all.
    expect(fiveYearsLater).toEqual(atSnapshotDay);
    expect(atSnapshotDay.coverage).toEqual({ kind: 'coverage', value: 0.75 });
    expect(atSnapshotDay.alerts[0]?.dueAt).toBe('2026-09-21T00:00:00.000Z');
    expect(atSnapshotDay.conversion.submittedToApprovedBusinessDays).toBe(1);
  });
});
