const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const pct = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 0,
});

const dateFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
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
