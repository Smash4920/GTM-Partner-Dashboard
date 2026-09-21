/**
 * Fiscal calendar rules shared by the metrics layer and the mock generator.
 *
 * The fiscal year starts in February: FY27 runs Feb 2026 – Jan 2027, so
 * Q1 = Feb–Apr, Q2 = May–Jul, Q3 = Aug–Oct, Q4 = Nov–Jan. Keeping one
 * definition of each rule here means the generator and the metrics cannot
 * drift apart when the snapshot or fiscal year moves.
 */

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
