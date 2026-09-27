import { describe, expect, it } from 'vitest';
import {
  businessDaysAfter,
  businessDaysBefore,
  businessDaysBetween,
  fiscalQuarterOfDate,
  isBusinessDay,
  quarterWindow,
  shiftBusinessDays,
  startOfWeekUtc,
} from './fiscal';

describe('fiscalQuarterOfDate', () => {
  it('maps calendar dates onto the February-start fiscal year', () => {
    expect(fiscalQuarterOfDate('2026-02-01T00:00:00Z')).toBe('FY27-Q1');
    expect(fiscalQuarterOfDate('2026-04-30T23:59:59Z')).toBe('FY27-Q1');
    expect(fiscalQuarterOfDate('2026-05-01T00:00:00Z')).toBe('FY27-Q2');
    expect(fiscalQuarterOfDate('2026-07-31T00:00:00Z')).toBe('FY27-Q2');
    expect(fiscalQuarterOfDate('2026-08-01T00:00:00Z')).toBe('FY27-Q3');
    expect(fiscalQuarterOfDate('2026-10-31T00:00:00Z')).toBe('FY27-Q3');
    expect(fiscalQuarterOfDate('2026-11-01T00:00:00Z')).toBe('FY27-Q4');
    expect(fiscalQuarterOfDate('2027-01-31T00:00:00Z')).toBe('FY27-Q4');
    // January belongs to the previous fiscal year's Q4.
    expect(fiscalQuarterOfDate('2026-01-15T00:00:00Z')).toBe('FY26-Q4');
  });
});

describe('quarterWindow', () => {
  it('returns UTC [start, end) spans per quarter', () => {
    const q3 = quarterWindow('FY27-Q3');
    expect(q3.start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(q3.end.toISOString()).toBe('2026-11-01T00:00:00.000Z');

    // Q4 wraps across the calendar-year boundary into February.
    const q4 = quarterWindow('FY27-Q4');
    expect(q4.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(q4.end.toISOString()).toBe('2027-02-01T00:00:00.000Z');
  });
});

describe('startOfWeekUtc', () => {
  it('anchors activity weeks to the Monday of the snapshot week', () => {
    // The snapshot (2026-09-18) is a Friday; its week starts Monday 09-14.
    expect(startOfWeekUtc(new Date('2026-09-18T00:00:00Z')).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    );
    expect(startOfWeekUtc(new Date('2026-09-14T05:30:00Z')).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    );
    // Sunday belongs to the previous Monday.
    expect(startOfWeekUtc(new Date('2026-09-13T23:59:59Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });
});

describe('business days', () => {
  it('counts weekdays and skips weekends', () => {
    expect(isBusinessDay(new Date('2026-09-18T00:00:00Z'))).toBe(true);
    expect(isBusinessDay(new Date('2026-09-19T00:00:00Z'))).toBe(false); // Saturday
    expect(isBusinessDay(new Date('2026-09-20T00:00:00Z'))).toBe(false); // Sunday
    expect(businessDaysBetween('2026-09-18T00:00:00Z', '2026-09-18T00:00:00Z')).toBe(0);
    expect(businessDaysBetween('2026-09-11T00:00:00Z', '2026-09-14T00:00:00Z')).toBe(1);
    expect(businessDaysBetween('2026-09-14T00:00:00Z', '2026-09-18T00:00:00Z')).toBe(4);
    expect(businessDaysBetween('2026-09-14T00:00:00Z', '2026-09-21T00:00:00Z')).toBe(5);
  });

  it('walks forward and back by whole business days, skipping weekends', () => {
    // Five business days after a Monday is the next Monday.
    expect(businessDaysAfter('2026-09-14T00:00:00Z', 5).toISOString()).toBe(
      '2026-09-21T00:00:00.000Z',
    );
    // Walking back from a Friday lands on the Monday of that week.
    expect(businessDaysBefore('2026-09-18T00:00:00Z', 4).toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    );
    // A weekend start steps over it rather than landing on it.
    expect(businessDaysBefore('2026-09-21T00:00:00Z', 1).toISOString()).toBe(
      '2026-09-18T00:00:00.000Z',
    );
    expect(shiftBusinessDays('2026-09-18T00:00:00Z', 0).toISOString()).toBe(
      '2026-09-18T00:00:00.000Z',
    );
  });

  it('round-trips with businessDaysBetween', () => {
    for (const count of [1, 2, 3, 4, 5, 10]) {
      const from = '2026-09-14T00:00:00Z';
      expect(businessDaysBetween(from, businessDaysAfter(from, count).toISOString())).toBe(count);
      expect(businessDaysBetween(businessDaysBefore(from, count).toISOString(), from)).toBe(count);
    }
  });
});
