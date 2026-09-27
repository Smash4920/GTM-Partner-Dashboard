const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

// `minimumFractionDigits: 0` is load-bearing, not redundant. Without it the
// compact output depends on the ICU build: ICU 75 and earlier (Node 22, which
// package.json requires and CI runs) treat `maximumFractionDigits: 1` as a
// minimum too and render "$250.0K", "$999.0" and "$0.0", while ICU 76+
// (Node 24) drops the trailing zero and renders "$250K". Pinning the minimum
// gives one answer everywhere, and it is the intended one.
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

const pct = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

// All dates in the data model are UTC calendar dates, so render in UTC:
// without this, anyone west of UTC sees every date shifted one day early.
const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatUsd(value: number): string {
  return usd.format(value);
}

export function formatUsdCompact(value: number): string {
  return usdCompact.format(value);
}

export function formatPct(value: number): string {
  return pct.format(value);
}

export function formatDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}

// Week buckets on charts: month + day, no year.
const dayShortFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

export function formatDayShort(iso: string): string {
  return dayShortFmt.format(new Date(iso));
}

// Meetings keep their UTC clock time for the calendar grid; no timezone math.
const timeFmt = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'UTC',
});

export function formatTime(iso: string): string {
  return timeFmt.format(new Date(iso));
}
