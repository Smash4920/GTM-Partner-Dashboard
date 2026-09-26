/**
 * Fiscal calendar rules shared by the metrics layer and the mock generator.
 *
 * The fiscal year starts in February: FY27 runs Feb 2026 – Jan 2027, so
 * Q1 = Feb–Apr, Q2 = May–Jul, Q3 = Aug–Oct, Q4 = Nov–Jan. Keeping one
 * definition of each rule here means the generator and the metrics cannot
 * drift apart when the snapshot or fiscal year moves.
 */

const DAY = 86_400_000;

/** Fiscal quarter label (e.g. 'FY27-Q3') for a UTC calendar date. */
export function fiscalQuarterOfDate(iso: string): string {
  const date = new Date(iso);
  const month = date.getUTCMonth();
  const fiscalYear = month === 0 ? date.getUTCFullYear() : date.getUTCFullYear() + 1;
  const quarter = month === 0 || month === 10 || month === 11
    ? 4
    : month >= 1 && month <= 3
      ? 1
      : month >= 4 && month <= 6
        ? 2
        : 3;
  return `FY${String(fiscalYear).slice(-2)}-Q${quarter}`;
}

/** UTC [start, end) window of a fiscal quarter label such as 'FY27-Q3'. */
export function quarterWindow(quarter: string): { start: Date; end: Date } {
  const [, fiscalYearText, quarterText] = quarter.match(/^FY(\d+)-Q(\d)$/) ?? [];
  const fiscalYear = Number(fiscalYearText);
  const q = Number(quarterText);
  const calendarStartYear = 2000 + fiscalYear - 1;
  const start = new Date(Date.UTC(calendarStartYear, 1 + (q - 1) * 3, 1));
  const end =
    q === 4
      ? new Date(Date.UTC(calendarStartYear + 1, 1, 1))
      : new Date(Date.UTC(calendarStartYear, 1 + q * 3, 1));
  return { start, end };
}

/** Monday on or before the date, at UTC midnight. */
export function startOfWeekUtc(date: Date): Date {
  const copy = new Date(date);
  const daysSinceMonday = (copy.getUTCDay() + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - daysSinceMonday);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/**
 * Business-day rules, shared by the metrics layer and the mock generator.
 *
 * A business day is a UTC weekday (Mon–Fri). Holidays are not modeled yet;
 * when they enter the fiscal calendar this predicate is the one place to teach
 * them to, so the SLA counters and the seeded working dates cannot drift apart.
 */
export function isBusinessDay(date: Date): boolean {
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6;
}

/** The UTC calendar day of an ISO instant, at midnight. */
function utcDay(iso: string | Date): Date {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Weekdays (Mon–Fri, UTC) strictly after `fromIso` through `toIso`. Counting
 * from Monday to the following Monday is 5, not 7, and a same-day comparison
 * is 0.
 */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  let days = 0;
  for (
    let timestamp = utcDay(fromIso).getTime() + DAY;
    timestamp <= utcDay(toIso).getTime();
    timestamp += DAY
  ) {
    if (isBusinessDay(new Date(timestamp))) days += 1;
  }
  return days;
}

/**
 * The UTC day that sits `count` business days away from `iso`: stepping one
 * weekday at a time (backwards for a negative count) and skipping weekends, so
 * `businessDaysBetween(iso, shiftBusinessDays(iso, n)) === n`. Used both to
 * seed working dates relative to the snapshot and to date an SLA deadline
 * forward from a submission.
 */
export function shiftBusinessDays(iso: string | Date, count: number): Date {
  const cursor = utcDay(iso);
  const step = count < 0 ? -1 : 1;
  for (let remaining = Math.abs(count); remaining > 0; remaining -= 1) {
    do {
      cursor.setUTCDate(cursor.getUTCDate() + step);
    } while (!isBusinessDay(cursor));
  }
  return cursor;
}

/** The UTC day `count` business days before `iso`. */
export function businessDaysBefore(iso: string | Date, count: number): Date {
  return shiftBusinessDays(iso, -count);
}

/** The UTC day `count` business days after `iso`. */
export function businessDaysAfter(iso: string | Date, count: number): Date {
  return shiftBusinessDays(iso, count);
}
