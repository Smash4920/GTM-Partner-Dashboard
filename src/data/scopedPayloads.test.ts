import { describe, expect, it } from 'vitest';
import { CURRENT_FISCAL_QUARTER } from './constants';
import { phaseForQuarter } from '../lib/metrics';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { ScaleDataProvider } from './mock/ScaleDataProvider';
import { generateDashboardData } from './mock/generate';

/**
 * VAL-DATA-010: scaled data changes values without changing response bounds.
 *
 * The contract's whole claim, pinned as a comparison between the same
 * queries at 1× (MockDataProvider) and 100× (ScaleDataProvider):
 *
 * - Aggregates keep a fixed shape: identical key structure, identical bucket
 *   and row counts, identical serialized size up to the digits the larger
 *   values add. Nothing about an aggregate's size may depend on the book.
 * - Dimension directories (partners) scale exactly 100× and stay disjoint —
 *   the scaled book is 100 semantic copies, not one muddled book.
 * - Row collections stay paginated: a page is 25 rows while the book holds
 *   tens of thousands, Load-more appends one unique page, and the page
 *   total is exactly 100× the 1× total.
 * - Figures scale exactly: the 100× answer carries 100× the value, so the
 *   demo is a different answer, not a bigger payload of the same one.
 *
 * The performance half of the assertion is the suite-level ratchet
 * (`npm run test:performance`): every call below runs inside it.
 */

const quarter = CURRENT_FISCAL_QUARTER;
const phase = phaseForQuarter(quarter);

const base = generateDashboardData();
const one = new MockDataProvider(base);
const hundred = new ScaleDataProvider(100, base);

/** Aggregates: fixed shape and size at any volume, so compared field by field. */
const AGGREGATES: [
  string,
  (provider: DataProvider, access: DemoAccessScope) => Promise<unknown>,
][] = [
  ['getForecastSummary', (p, a) => p.getForecastSummary(a, { quarter }).then((r) => r.data)],
  ['getWeightedForecast', (p, a) => p.getWeightedForecast(a, { quarter }).then((r) => r.data)],
  ['getForecastQuality', (p, a) => p.getForecastQuality(a, { quarter }, 6).then((r) => r.data)],
  [
    'getManagerForecastGroups',
    (p, a) => p.getManagerForecastGroups(a, { quarter }).then((r) => r.data),
  ],
  [
    'getWeeklyForecastSeries',
    (p, a) => p.getWeeklyForecastSeries(a, { quarter }).then((r) => r.data),
  ],
  ['getPerformanceSummary', (p, a) => p.getPerformanceSummary(a, { phase }).then((r) => r.data)],
  ['getRegistrationFunnel', (p, a) => p.getRegistrationFunnel(a, { phase }).then((r) => r.data)],
  ['getStageBreakdown', (p, a) => p.getStageBreakdown(a, { phase }).then((r) => r.data)],
  ['getTypeBreakdown', (p, a) => p.getTypeBreakdown(a, { phase }).then((r) => r.data)],
  ['getQuarterlyRevenueTrend', (p, a) => p.getQuarterlyRevenueTrend(a, {}).then((r) => r.data)],
  ['getWeeklyActivitySeries', (p, a) => p.getWeeklyActivitySeries(a, {}).then((r) => r.data)],
  ['getWeeklyGoalProgress', (p, a) => p.getWeeklyGoalProgress(a, {}).then((r) => r.data)],
  ['getRegistrationOpsSummary', (p, a) => p.getRegistrationOpsSummary(a, {}).then((r) => r.data)],
  ['getManagerDirectory', (p, a) => p.getManagerDirectory(a).then((r) => r.data)],
  ['getTeamRoster', (p, a) => p.getTeamRoster(a, {}).then((r) => r.data)],
  ['getRegistrationSlaAlerts', (p, a) => p.getRegistrationSlaAlerts(a, {}, 8).then((r) => r.data)],
  [
    'getPartnerCertification',
    (p, a) => p.getPartnerCertification(a, { partnerId: base.partners[0]!.id }).then((r) => r.data),
  ],
];

/** Dimension directories: they scale with the book, exactly 100×, never more. */
const DIRECTORIES: [string, (provider: DataProvider) => Promise<unknown[]>][] = [
  ['getPartnerDirectory', (p) => p.getPartnerDirectory(INTERNAL_DEMO_SCOPE).then((r) => r.data)],
  ['getPartnerRoster', (p) => p.getPartnerRoster(INTERNAL_DEMO_SCOPE, {}).then((r) => r.data)],
  [
    'getPartnerLeaderboard',
    (p) => p.getPartnerLeaderboard(INTERNAL_DEMO_SCOPE, { phase }).then((r) => r.data),
  ],
];

/** Row collections: only ever a page, whatever the book weighs. */
const ROW_PAGES: [
  string,
  (
    provider: DataProvider,
    page: { limit: number; cursor?: string },
  ) => Promise<{
    rows: unknown[];
    nextCursor?: string;
    totalCount: number;
  }>,
][] = [
  [
    'listQuarterOpportunities',
    (p, page) =>
      p.listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, page).then((r) => r.data),
  ],
  [
    'listScopedOpportunities',
    (p, page) =>
      p.listScopedOpportunities(INTERNAL_DEMO_SCOPE, { phase }, page).then((r) => r.data),
  ],
  [
    'listPendingRegistrations',
    (p, page) => p.listPendingRegistrations(INTERNAL_DEMO_SCOPE, {}, page).then((r) => r.data),
  ],
  [
    'listUnconvertedRegistrations',
    (p, page) => p.listUnconvertedRegistrations(INTERNAL_DEMO_SCOPE, {}, page).then((r) => r.data),
  ],
  [
    'listDuplicateRegistrationGroups',
    (p, page) =>
      p.listDuplicateRegistrationGroups(INTERNAL_DEMO_SCOPE, {}, page).then((r) => r.data),
  ],
  [
    'listRecentRegistrations',
    (p, page) => p.listRecentRegistrations(INTERNAL_DEMO_SCOPE, {}, page).then((r) => r.data),
  ],
  [
    'listWeeklyClassificationMeetings',
    (p, page) =>
      p
        .listWeeklyClassificationMeetings(
          INTERNAL_DEMO_SCOPE,
          { partnerManagerId: base.partnerManagers[0]!.id },
          page,
        )
        .then((r) => r.data),
  ],
];

/**
 * The shape of an answer: same keys, same nesting, same primitive types,
 * arrays reduced to their element shape. Two answers with equal shapes and
 * equal array lengths carry the same fields — the "response bounds" of the
 * assertion's name.
 */
function shapeOf(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length === 0 ? ['empty'] : [shapeOf(value[0])];
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => [key, shapeOf(nested)] as [string, unknown])
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }
  return typeof value;
}

/** Count of number leaves — the headroom digits legitimately add at 100×. */
function countNumbers(value: unknown): number {
  if (typeof value === 'number') return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countNumbers(item), 0);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce((sum, item) => sum + countNumbers(item), 0);
  }
  return 0;
}

/** Count of string leaves — copy labels (`~99`, ` · copy 100`) add ≤ 12 bytes each. */
function countStrings(value: unknown): number {
  if (typeof value === 'string') return 1;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countStrings(item), 0);
  if (value !== null && typeof value === 'object') {
    return Object.values(value).reduce((sum, item) => sum + countStrings(item), 0);
  }
  return 0;
}

describe('VAL-DATA-010: response bounds at 1× and 100×', () => {
  it('confirms the books differ by exactly 100×, so the comparisons below are non-vacuous', () => {
    expect(hundred.size.partners).toBe(base.partners.length * 100);
    expect(hundred.size.opportunities).toBe(base.opportunities.length * 100);
    expect(hundred.size.snapshots).toBe(base.snapshots.length * 100);
  });

  it.each(AGGREGATES)('%s keeps a fixed shape and size at 100×', async (method, call) => {
    const atOne = await call(one, INTERNAL_DEMO_SCOPE);
    const atHundred = await call(hundred, INTERNAL_DEMO_SCOPE);

    // Same fields, same structure, same bucket counts.
    expect(shapeOf(atHundred), method).toEqual(shapeOf(atOne));
    if (Array.isArray(atOne)) {
      expect((atHundred as unknown[]).length, method).toBe(atOne.length);
    }

    // Serialized size is fixed up to the extra characters the 100× book
    // legitimately adds: a number multiplied by 100 gains at most two digits
    // (three asserted, with room to spare), and a copied row's id or account
    // name gains at most a twelve-character copy label. Any new field or
    // bucket would blow straight past the cap.
    const baseBytes = JSON.stringify(atOne).length;
    const scaledBytes = JSON.stringify(atHundred).length;
    // Row-bearing samples are the exception: their membership is capped but
    // not pinned, and copy labels re-sort which rows make the cut, so their
    // bound is an absolute byte cap rather than digit arithmetic.
    const SAMPLE_CAP_BYTES: Record<string, number> = {
      getForecastQuality: 4_096,
      getRegistrationSlaAlerts: 8_192,
    };
    const sampleCap = SAMPLE_CAP_BYTES[method];
    if (sampleCap === undefined) {
      expect(scaledBytes, method).toBeLessThanOrEqual(
        baseBytes + 3 * countNumbers(atOne) + 12 * countStrings(atOne) + 16,
      );
    } else {
      expect(scaledBytes, method).toBeLessThanOrEqual(sampleCap);
      expect(baseBytes, method).toBeLessThanOrEqual(sampleCap);
    }

    // Bounded samples stay inside their caps at both scales: the bound is
    // the contract, not the count a 1× book happened to produce.
    if (method === 'getForecastQuality') {
      const sample = (atHundred as { sample: unknown[] }).sample;
      expect(sample.length).toBeLessThanOrEqual(12);
      expect((atOne as { sample: unknown[] }).sample.length).toBeLessThanOrEqual(12);
    }
    if (method === 'getRegistrationSlaAlerts') {
      const alerts = (atHundred as { alerts: unknown[] }).alerts;
      expect(alerts.length).toBeLessThanOrEqual(8);
      expect((atOne as { alerts: unknown[] }).alerts.length).toBeLessThanOrEqual(8);
    }
  });

  it.each(DIRECTORIES)(
    '%s scales to exactly 100 disjoint copies, no more',
    async (method, call) => {
      const atOne = await call(one);
      const atHundred = await call(hundred);

      expect(atHundred.length, method).toBe(atOne.length * 100);
      // 100 semantic copies: every row is distinct, and each carries the same
      // shape as the 1× rows.
      const ids = atHundred.map((row) =>
        JSON.stringify(
          (row as { id?: unknown; partner?: { id?: unknown } }).id ??
            (row as { partner?: { id?: unknown } }).partner?.id,
        ),
      );
      expect(new Set(ids).size, method).toBe(atHundred.length);
      expect(shapeOf(atHundred[0]), method).toEqual(shapeOf(atOne[0]));
    },
  );

  it.each(ROW_PAGES)(
    '%s stays a bounded page while its total scales 100×',
    async (method, call) => {
      const atOne = await call(one, { limit: 25 });
      const atHundred = await call(hundred, { limit: 25 });

      // The page is the whole answer however large the book: no route receives
      // all fact rows, at either scale.
      expect(atHundred.rows.length, method).toBeLessThanOrEqual(25);
      expect(atHundred.totalCount, method).toBe(atOne.totalCount * 100);
      expect(atHundred.totalCount, method).toBeGreaterThan(atHundred.rows.length);
    },
  );

  it('appends exactly one unique page per Load 25 more, at 100×', async () => {
    // The interaction the views expose, at the scale that used to break them.
    const first = await hundred.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 25 },
    );
    expect(first.data.nextCursor).toBeDefined();
    const second = await hundred.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 25, cursor: first.data.nextCursor },
    );

    expect(first.data.rows).toHaveLength(25);
    expect(second.data.rows).toHaveLength(25);
    const seen = new Set(first.data.rows.map((row) => row.id));
    // One unique page: no overlap with what is already on screen.
    expect(second.data.rows.every((row) => !seen.has(row.id))).toBe(true);
    expect(new Set(second.data.rows.map((row) => row.id)).size).toBe(25);
  });

  it('scales figures exactly 100× — different values, identical answer shape', async () => {
    const atOne = (await one.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter })).data;
    const atHundred = (await hundred.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter })).data;

    expect(atHundred.openCount).toBe(atOne.openCount * 100);
    expect(atHundred.openPipelineValue).toBe(atOne.openPipelineValue * 100);
    expect(atHundred.closedWon).toBe(atOne.closedWon * 100);
    expect(atHundred.target).toBe(atOne.target * 100);
    // The calendar is not the book: scale cannot move it.
    expect(atHundred.daysLeftInQuarter).toBe(atOne.daysLeftInQuarter);

    // Provenance stays honest at both scales: the envelope says which book
    // answered, and both speak for the same deterministic as-of instant.
    const metaOne = (await one.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter })).meta;
    const metaHundred = (await hundred.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter })).meta;
    expect(metaOne.providerId).toBe('local');
    expect(metaHundred.providerId).toBe('scaled');
    expect(metaHundred.asOf).toBe(metaOne.asOf);
  });

  it('keeps partner-audience answers scoped to one copy at 100×', async () => {
    // The audience boundary is part of the bound: a partner's answers at 100×
    // are computed from its own copy alone, and name nobody else's.
    const partnerScope: DemoAccessScope = {
      audience: 'partner',
      partnerId: base.partners[0]!.id,
    };
    const { data: summary } = await hundred.getForecastSummary(partnerScope, { quarter });
    const { data: summaryAtOne } = await one.getForecastSummary(partnerScope, { quarter });
    expect(summary.openCount).toBe(summaryAtOne.openCount);
    expect(summary.openPipelineValue).toBe(summaryAtOne.openPipelineValue);

    const { data: weeks } = await hundred.getWeeklyForecastSeries(partnerScope, { quarter });
    const { data: weeksAtOne } = await one.getWeeklyForecastSeries(partnerScope, { quarter });
    expect(weeks).toEqual(weeksAtOne);
  });
});
