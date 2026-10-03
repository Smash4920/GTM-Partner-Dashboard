import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionCategory, ActionItem, Opportunity } from '../data/types';
import { latestPriorCloseDates } from '../data/mock/book';
import { generateDashboardData } from '../data/mock/generate';
import { makeMeeting, makeOpportunity, makePartner, makeRegistration } from '../test/fixtures';
import { compareActionItems, DEFAULT_ACTION_POLICY, deriveActionItems } from './actionRules';

const AS_OF = '2026-09-18T00:00:00.000Z';
const DAY = 86_400_000;
const day = (offset: number) => new Date(Date.parse(AS_OF) + offset * DAY).toISOString();

function derive(opportunities: Opportunity[], priorCloseDates = new Map<string, string>()) {
  return deriveActionItems({
    asOf: AS_OF,
    policy: DEFAULT_ACTION_POLICY,
    partners: [makePartner()],
    opportunities,
    registrations: [],
    activities: [],
    priorCloseDates,
  });
}

function reasons(items: ActionItem[], category: ActionCategory) {
  return items.flatMap((item) =>
    item.reasons
      .filter((reason) => reason.category === category)
      .map((reason) => ({ id: item.id, reason })),
  );
}

afterEach(() => vi.useRealTimers());

describe('deterministic action rules', () => {
  it('derives stale high-value opportunities at inclusive boundaries', () => {
    const base = makeOpportunity({
      forecastedRevenue: 400_000,
      lastActivityAt: day(-14),
      nextStep: 'Call',
    });
    const items = derive([
      base,
      { ...base, id: 'low', forecastedRevenue: 399_999 },
      { ...base, id: 'recent', lastActivityAt: day(-13) },
      { ...base, id: 'won', closedAt: day(-1), outcome: 'won' },
      { ...base, id: 'lost', outcome: 'lost' },
      { ...base, id: 'future', lastActivityAt: day(1) },
      { ...base, id: 'fallback', lastActivityAt: undefined, createdAt: day(-14) },
    ]);
    expect(reasons(items, 'stale-high-value').map(({ id }) => id)).toEqual([
      'opportunity:fallback',
      'opportunity:opp-1',
    ]);
    expect(reasons(items, 'stale-high-value').map(({ reason }) => reason.evidence)).toEqual([
      { basis: 'createdAt', baselineAt: day(-14), elapsedCalendarDays: 14 },
      { basis: 'lastActivityAt', baselineAt: day(-14), elapsedCalendarDays: 14 },
    ]);
    // Calendar-day boundaries are UTC dates, not elapsed 24-hour periods.
    expect(
      reasons(
        derive([{ ...base, lastActivityAt: '2026-09-04T23:59:59.000Z' }]),
        'stale-high-value',
      ),
    ).toHaveLength(1);
  });

  it('derives missing next steps and all qualifying causes', () => {
    const base = makeOpportunity({
      forecastedRevenue: 399_999,
      nextStep: ' \t\n',
      expectedCloseDate: day(60),
    });
    const items = derive([
      base,
      { ...base, id: 'far', expectedCloseDate: day(61) },
      { ...base, id: 'value', forecastedRevenue: 400_000, expectedCloseDate: day(61) },
      { ...base, id: 'overdue', expectedCloseDate: day(-1) },
      { ...base, id: 'all', expectedCloseDate: day(-1), forecastedRevenue: 400_000 },
      { ...base, id: 'filled', nextStep: 'Call owner' },
      { ...base, id: 'closed', closedAt: day(-1), outcome: 'lost' },
    ]);
    const missing = reasons(items, 'missing-next-step');
    expect(missing.map(({ id }) => id).sort()).toEqual([
      'opportunity:all',
      'opportunity:opp-1',
      'opportunity:overdue',
      'opportunity:value',
    ]);
    expect(missing.find(({ id }) => id === 'opportunity:all')!.reason.evidence).toEqual({
      causes: ['within-horizon', 'high-value', 'overdue'],
      daysUntilClose: -1,
    });
    expect(missing.find(({ id }) => id === 'opportunity:opp-1')!.reason.evidence).toEqual({
      causes: ['within-horizon'],
      daysUntilClose: 60,
    });
  });

  it('derives a close-date slip from latest prior evidence', () => {
    const base = makeOpportunity({ nextStep: 'Call', expectedCloseDate: day(7) });
    const dates = latestPriorCloseDates(
      [
        {
          takenAt: day(-7),
          opportunityId: base.id,
          expectedCloseDate: day(-30),
          forecastedRevenue: 1,
          forecastCategory: 'commit',
          stage: 'scope',
        },
        {
          takenAt: day(-1),
          opportunityId: base.id,
          expectedCloseDate: day(0),
          forecastedRevenue: 2,
          forecastCategory: 'pipeline',
          stage: 'discovery',
        },
        {
          takenAt: day(0),
          opportunityId: base.id,
          expectedCloseDate: day(7),
          forecastedRevenue: 3,
          forecastCategory: 'pipeline',
          stage: 'scope',
        },
      ],
      AS_OF,
    );
    const items = derive(
      [
        base,
        { ...base, id: 'six', expectedCloseDate: day(6) },
        { ...base, id: 'earlier', expectedCloseDate: day(-1) },
        { ...base, id: 'none' },
        { ...base, id: 'closed', closedAt: day(-1) },
      ],
      new Map([...dates, ['six', day(0)], ['earlier', day(0)], ['closed', day(0)]]),
    );
    const slips = reasons(items, 'close-date-slip');
    expect(slips).toHaveLength(1);
    expect(slips[0]!.reason.evidence).toEqual({
      priorCloseDate: day(0),
      currentCloseDate: day(7),
      deltaCalendarDays: 7,
    });
    expect(Object.keys(slips[0]!.reason.evidence).sort()).toEqual([
      'currentCloseDate',
      'deltaCalendarDays',
      'priorCloseDate',
    ]);
    expect(JSON.stringify(items)).not.toMatch(/takenAt|forecastCategory|forecastedRevenue|stage/);
  });

  it('derives partner-health deterioration from adjacent windows', () => {
    const partners = [makePartner()];
    // -56 excluded, -28 belongs only to prior, asOf included, future excluded.
    const activities = [-56, -55, -28, 0, 1].map((offset) =>
      makeMeeting({ id: `m${offset}`, occurredAt: day(offset) }),
    );
    const opportunities = [-56, -55, -28, 0, 1].map((offset) =>
      makeOpportunity({
        id: `o${offset}`,
        createdAt: day(offset),
        closedAt: day(offset),
        outcome: 'won',
        forecastedRevenue: 100,
      }),
    );
    const registrations = [-56, -55, -28, 0, 1].map((offset) =>
      makeRegistration({
        id: `r${offset}`,
        submittedAt: day(offset),
        status: 'approved',
      }),
    );
    const input = {
      asOf: AS_OF,
      policy: DEFAULT_ACTION_POLICY,
      partners,
      activities,
      opportunities,
      registrations,
    };
    const health = reasons(deriveActionItems(input), 'partner-health');
    expect(health).toHaveLength(1);
    expect(health[0]!.reason.evidence).toEqual({
      priorWindow: { startExclusive: day(-56), endInclusive: day(-28) },
      currentWindow: { startExclusive: day(-28), endInclusive: day(0) },
      drivers: [
        { driver: 'partner-meetings', prior: 2, current: 1, unit: 'meetings' },
        { driver: 'opportunities-created', prior: 2, current: 1, unit: 'opportunities' },
        { driver: 'registrations-submitted', prior: 2, current: 1, unit: 'registrations' },
        { driver: 'closed-won-revenue', prior: 200, current: 100, unit: 'USD' },
      ],
    });
    expect(
      reasons(
        deriveActionItems({ ...input, activities: [], opportunities: [], registrations: [] }),
        'partner-health',
      ),
    ).toEqual([]);
    expect(
      reasons(
        deriveActionItems({ ...input, opportunities: [], registrations: [] }),
        'partner-health',
      ),
    ).toEqual([]);
    expect(
      reasons(deriveActionItems({ ...input, opportunities: [] }), 'partner-health'),
    ).toHaveLength(1);
    const equalMeetings = activities.concat(makeMeeting({ id: 'equal', occurredAt: day(-1) }));
    expect(
      reasons(
        deriveActionItems({ ...input, activities: equalMeetings, opportunities: [] }),
        'partner-health',
      ),
    ).toEqual([]);
    expect(
      reasons(
        deriveActionItems({
          ...input,
          policy: {
            ...DEFAULT_ACTION_POLICY,
            healthWindowDays: 14,
            minimumDeterioratingDrivers: 1,
          },
        }),
        'partner-health',
      ),
    ).toEqual([]);
  });

  it('uses five UTC weekdays with exact one-business-day warning and due-day breach', () => {
    const registration = makeRegistration({ submittedAt: '2026-09-11T19:00:00.000Z' }); // Friday
    const input = {
      policy: DEFAULT_ACTION_POLICY,
      partners: [],
      opportunities: [],
      activities: [],
      registrations: [registration],
    };
    const at = (asOf: string) => deriveActionItems({ ...input, asOf });
    expect(at('2026-09-13T00:00:00.000Z')).toEqual([]); // Sunday
    expect(at('2026-09-16T00:00:00.000Z')).toEqual([]); // Wednesday: two days
    const warning = at('2026-09-17T00:00:00.000Z')[0]!;
    expect(warning.id).toBe('registration:reg-1');
    expect(warning.reasons[0]!.evidence).toEqual({
      state: 'warning',
      submittedAt: registration.submittedAt,
      dueAt: day(0),
      businessDaysWaiting: 4,
      businessDaysRemaining: 1,
    });
    expect(at(AS_OF)[0]!.reasons[0]!.evidence).toMatchObject({
      state: 'breach',
      businessDaysRemaining: 0,
    });
    expect(at(day(3))[0]!.reasons[0]!.evidence).toMatchObject({
      state: 'breach',
      businessDaysRemaining: -1,
    });
    expect(at(day(1))[0]!.reasons[0]!.evidence).toMatchObject({
      state: 'breach',
      businessDaysRemaining: 0,
    });
    expect(
      deriveActionItems({
        ...input,
        asOf: AS_OF,
        registrations: [
          { ...registration, status: 'approved' },
          { ...registration, status: 'rejected' },
        ],
      }),
    ).toEqual([]);
    const mondayDue = { ...registration, submittedAt: '2026-09-14T00:00:00.000Z' };
    expect(deriveActionItems({ ...input, asOf: AS_OF, registrations: [mondayDue] })[0]!.dueAt).toBe(
      day(3),
    );
    expect(
      deriveActionItems({ ...input, asOf: day(1), registrations: [mondayDue] })[0]!.reasons[0]!
        .evidence,
    ).toMatchObject({ state: 'warning', businessDaysRemaining: 1 });
  });

  it('separates provider as-of time from action time', () => {
    const input = {
      asOf: AS_OF,
      policy: DEFAULT_ACTION_POLICY,
      partners: [makePartner()],
      opportunities: [
        makeOpportunity({
          forecastedRevenue: 500_000,
          lastActivityAt: day(-20),
          createdAt: day(-40),
        }),
      ],
      activities: [makeMeeting({ occurredAt: day(-40) })],
      registrations: [makeRegistration({ submittedAt: day(-40) })],
      priorCloseDates: new Map([['opp-1', day(7)]]),
    };
    vi.useFakeTimers();
    vi.setSystemTime('2026-01-01T10:00:00.000Z');
    const first = deriveActionItems(input);
    expect(
      new Set(first.flatMap((item) => item.reasons.map((reason) => reason.category))).size,
    ).toBe(5);
    vi.setSystemTime('2030-01-01T11:00:00.000Z');
    expect(deriveActionItems(input)).toEqual(first);
    // Runtime action records are owned by the workflow/notification modules;
    // the reporting projection intentionally accepts no runtime clock.
  });

  it('merges reasons into stable entity action items', () => {
    const opportunities = [
      makeOpportunity({
        id: 'z',
        forecastedRevenue: 400_000,
        lastActivityAt: day(-14),
        expectedCloseDate: day(7),
      }),
      makeOpportunity({ id: 'a', nextStep: 'Call' }),
    ];
    const input = {
      asOf: AS_OF,
      policy: DEFAULT_ACTION_POLICY,
      partners: [makePartner()],
      opportunities,
      activities: [makeMeeting({ occurredAt: day(-40) })],
      registrations: [makeRegistration({ submittedAt: day(-40) })],
      priorCloseDates: new Map([
        ['z', day(0)],
        ['a', day(0)],
      ]),
    };
    const frozen = JSON.stringify(input);
    const result = deriveActionItems(input);
    expect(
      result.find((item) => item.id === 'opportunity:z')!.reasons.map((reason) => reason.category),
    ).toEqual(['stale-high-value', 'missing-next-step', 'close-date-slip']);
    expect(new Set(result.map((item) => item.id)).size).toBe(result.length);
    expect(result.map((item) => item.id)).toContain('partner:partner-1');
    expect(
      deriveActionItems({
        ...input,
        partners: [...input.partners].reverse(),
        opportunities: [...opportunities].reverse(),
        registrations: [...input.registrations].reverse(),
        activities: [...input.activities].reverse(),
        priorCloseDates: new Map([...input.priorCloseDates].reverse()),
      }),
    ).toEqual(result);
    expect(JSON.stringify(input)).toBe(frozen);
    // OR category matching selects the merged row once, never one row per reason.
    expect(
      result.filter((item) =>
        item.reasons.some((reason) =>
          ['stale-high-value', 'missing-next-step'].includes(reason.category),
        ),
      ),
    ).toHaveLength(1);
  });

  it('orders severity, due date with missing last, exposure, then stable ID', () => {
    const base: ActionItem = {
      id: 'a',
      entityId: 'a',
      entityKind: 'partner',
      partnerId: 'p',
      reasons: [],
      severity: 'medium',
      exposure: 100,
    };
    const rows = [
      { ...base, id: 'z', severity: 'critical' as const },
      { ...base, id: 'missing', severity: 'high' as const, exposure: 1_000 },
      { ...base, id: 'b', severity: 'high' as const, dueAt: day(0) },
      { ...base, id: 'a', severity: 'high' as const, dueAt: day(0) },
      { ...base, id: 'larger', severity: 'high' as const, dueAt: day(0), exposure: 200 },
      { ...base, id: 'earlier', severity: 'high' as const, dueAt: day(-1), exposure: 1 },
      base,
    ];
    expect([...rows].sort(compareActionItems).map((item) => item.id)).toEqual([
      'z',
      'earlier',
      'larger',
      'a',
      'b',
      'missing',
      'a',
    ]);
    expect(compareActionItems(base, base)).toBe(0);
  });

  it('uses configured thresholds without mutating frozen canonical input', () => {
    const opportunity = Object.freeze(
      makeOpportunity({
        forecastedRevenue: 200_000,
        lastActivityAt: day(-7),
        expectedCloseDate: day(3),
      }),
    );
    const input = Object.freeze({
      asOf: AS_OF,
      policy: Object.freeze({
        ...DEFAULT_ACTION_POLICY,
        highValueAmount: 200_000,
        staleCalendarDays: 7,
        missingNextStepHorizonDays: 3,
        closeSlipCalendarDays: 3,
      }),
      partners: Object.freeze([Object.freeze(makePartner())]),
      opportunities: Object.freeze([opportunity]),
      registrations: Object.freeze([]),
      activities: Object.freeze([]),
      priorCloseDates: new Map([['opp-1', day(0)]]),
    });
    expect(deriveActionItems(input)[0]!.reasons.map((reason) => reason.category)).toEqual([
      'stale-high-value',
      'missing-next-step',
      'close-date-slip',
    ]);
    expect(deriveActionItems(input)).toEqual(deriveActionItems(input));
  });

  it('uses only recorded partner events and stable fractional revenue sums', () => {
    const opportunities = [0.1, 0.2, 0.3].map((forecastedRevenue, index) =>
      makeOpportunity({
        id: `won-${index}`,
        createdAt: day(-80),
        closedAt: day(-40),
        outcome: 'won',
        forecastedRevenue,
      }),
    );
    opportunities.push(
      makeOpportunity({
        id: 'lost',
        createdAt: day(-80),
        closedAt: day(-40),
        outcome: 'lost',
        forecastedRevenue: 100,
      }),
      makeOpportunity({
        id: 'missing-close',
        createdAt: day(-80),
        outcome: 'won',
        forecastedRevenue: 100,
      }),
      makeOpportunity({
        id: 'other-partner',
        partnerId: 'other',
        createdAt: day(-40),
        closedAt: day(-40),
        outcome: 'won',
        forecastedRevenue: 100,
      }),
    );
    const input = {
      asOf: AS_OF,
      policy: { ...DEFAULT_ACTION_POLICY, minimumDeterioratingDrivers: 1 },
      partners: [makePartner()],
      opportunities,
      registrations: [],
      activities: [makeMeeting({ partnerId: 'other', occurredAt: day(-40) })],
    };
    const result = deriveActionItems(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.reasons[0]!.evidence).toMatchObject({
      drivers: [
        { driver: 'closed-won-revenue', prior: 0.6000000000000001, current: 0, unit: 'USD' },
      ],
    });
    expect(deriveActionItems({ ...input, opportunities: [...opportunities].reverse() })).toEqual(
      result,
    );
  });

  it('derives all five categories from unchanged deterministic mock evidence', () => {
    const book = generateDashboardData();
    const items = deriveActionItems({
      asOf: AS_OF,
      policy: DEFAULT_ACTION_POLICY,
      ...book,
      priorCloseDates: latestPriorCloseDates(book.snapshots, AS_OF),
    });
    expect(
      [...new Set(items.flatMap((item) => item.reasons.map((reason) => reason.category)))].sort(),
    ).toEqual([
      'close-date-slip',
      'missing-next-step',
      'partner-health',
      'registration-sla',
      'stale-high-value',
    ]);
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});
