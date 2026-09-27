import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDayShort,
  formatPct,
  formatTime,
  formatUsd,
  formatUsdCompact,
} from './format';

/**
 * The display layer's only job is to render the same string everywhere.
 *
 * These are literal expectations on purpose. `Intl` output moves with the ICU
 * build the runtime was compiled against, so a literal is what catches the
 * drift; asserting through the formatter itself would agree with any answer it
 * gave.
 */
describe('formatUsdCompact', () => {
  // Regression: the formatter set `maximumFractionDigits: 1` and nothing else,
  // which ICU 75 and earlier (Node 22, the version package.json requires and
  // CI runs) read as a minimum as well — the dashboard rendered "$250.0K" on
  // Node 22 and "$250K" on Node 24, from the same data. A KPI tile is not
  // allowed to depend on which ICU the browser shipped.
  it('drops the trailing zero on a whole compact unit', () => {
    expect(formatUsdCompact(250_000)).toBe('$250K');
    expect(formatUsdCompact(300_000)).toBe('$300K');
    expect(formatUsdCompact(12_000_000)).toBe('$12M');
  });

  it('keeps one decimal where it carries information', () => {
    expect(formatUsdCompact(1_500_000)).toBe('$1.5M');
    expect(formatUsdCompact(12_345_678)).toBe('$12.3M');
  });

  it('renders small amounts without a unit or a stray decimal', () => {
    expect(formatUsdCompact(0)).toBe('$0');
    expect(formatUsdCompact(999)).toBe('$999');
  });
});

describe('formatUsd', () => {
  it('renders whole dollars with separators', () => {
    expect(formatUsd(250_000)).toBe('$250,000');
    expect(formatUsd(0)).toBe('$0');
  });

  it('rounds to the nearest dollar rather than showing cents', () => {
    expect(formatUsd(1234.56)).toBe('$1,235');
  });
});

describe('formatPct', () => {
  it('renders a ratio as a whole percentage', () => {
    expect(formatPct(0.2)).toBe('20%');
    expect(formatPct(1.2)).toBe('120%');
    expect(formatPct(0)).toBe('0%');
  });
});

describe('date and time formatting', () => {
  // Every date in the data model is a UTC calendar date. Rendering in local
  // time would show anyone west of UTC the previous day, which silently moves
  // a registration across its SLA deadline.
  it('renders a UTC calendar date without shifting it', () => {
    expect(formatDate('2026-09-18T00:00:00.000Z')).toBe('Sep 18, 2026');
    expect(formatDayShort('2026-09-18T00:00:00.000Z')).toBe('Sep 18');
  });

  it('keeps a meeting on its UTC clock time', () => {
    expect(formatTime('2026-09-14T15:00:00.000Z')).toBe('15:00');
  });
});
