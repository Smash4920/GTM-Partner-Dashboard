import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { CURRENT_FISCAL_QUARTER } from './constants';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import { isPageQueryError } from './pagination';
import type { PageQueryError } from './pagination';
import { useWeeklySeries } from './useForecastQueries';
import { MockDataProvider } from './mock/MockDataProvider';
import { ScaleDataProvider } from './mock/ScaleDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
import { generateDashboardData } from './mock/generate';

/**
 * VAL-DATA-011: raw weekly pipeline snapshots are provider-private.
 *
 * Weekly history is ~87% of the payload at production volume, so the seam's
 * rule is absolute: no public provider result, hook state, component prop,
 * export, telemetry envelope, or error detail carries a raw snapshot row or
 * a raw snapshot collection. History crosses the seam exactly one way — as
 * a handful of bounded weekly buckets — and close-slip evidence, when the
 * Action Center lands it, may carry only the latest prior date and the
 * delta. A manager-level historical series stays unavailable: a snapshot
 * row does not record whose book a deal was in, and reconstructing one from
 * today's ownership would rewrite history.
 *
 * Three kinds of proof live here:
 *
 * 1. A static scan: the snapshot row type may be named only where history
 *    legitimately lives — the domain model, the metrics specification that
 *    consumes it, the mock generators that fabricate it, and this test. A
 *    view, component, hook, contract, or telemetry module that names it
 *    fails the suite.
 * 2. A runtime walk: every provider method's answer — both audiences, full
 *    page walks, metadata envelopes included — is recursively inspected for
 *    the snapshot shape, and the weekly series is checked for per-deal
 *    references and boundedness at 1× and 100×.
 * 3. Failure paths: typed page errors and simulated transport failures are
 *    serialized and inspected the same way.
 */

const quarter = CURRENT_FISCAL_QUARTER;
const book = generateDashboardData();
const provider = new MockDataProvider(book);
const partnerScope: DemoAccessScope = { audience: 'partner', partnerId: book.partners[0]!.id };

// ---- the shape that must never cross --------------------------------------

const SNAPSHOT_ROW_FIELDS = [
  'takenAt',
  'opportunityId',
  'forecastedRevenue',
  'forecastCategory',
  'stage',
  'expectedCloseDate',
] as const;

/** True for an object carrying the full raw snapshot row shape. */
function looksLikeSnapshotRow(value: Record<string, unknown>): boolean {
  return SNAPSHOT_ROW_FIELDS.every((field) => field in value);
}

/**
 * Recursive scan of anything that crossed the seam. Reports the raw row
 * shape wherever it sits in the graph, and any property whose name is a
 * raw-history collection.
 */
function collectRawHistory(value: unknown, at: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectRawHistory(item, `${at}[${index}]`, hits));
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  if (looksLikeSnapshotRow(record)) hits.push(`${at}: raw snapshot row`);
  for (const [key, nested] of Object.entries(record)) {
    if ((key === 'snapshots' || key === 'pipelineSnapshots') && Array.isArray(nested)) {
      hits.push(`${at}.${key}: raw snapshot collection`);
    }
    collectRawHistory(nested, `${at}.${key}`, hits);
  }
}

function expectNoRawHistory(value: unknown, label: string): void {
  const hits: string[] = [];
  collectRawHistory(value, label, hits);
  expect(hits).toEqual([]);
}

/** Every answer the provider can give one audience, envelopes included. */
async function collectAllAnswers(access: DemoAccessScope): Promise<unknown[]> {
  const answers: unknown[] = [
    await provider.listPartnerManagers(access),
    await provider.listPartners(access),
    await provider.listRegistrations(access),
    await provider.listOpportunities(access),
    await provider.getTargets(access),
    await provider.listActivities(access),
    await provider.listCertifications(access),
    await provider.listTeamUsers(access),
    await provider.getForecastSummary(access, { quarter }),
    await provider.getWeightedForecast(access, { quarter }),
    await provider.getForecastQuality(access, { quarter }, 3),
    await provider.getManagerForecastGroups(access, { quarter }),
    await provider.getWeeklyForecastSeries(access, { quarter }),
    await provider.getPartnerDirectory(access),
    await provider.getPerformanceSummary(access, { phase: 'q3' }),
    await provider.getRegistrationFunnel(access, { phase: 'q3' }),
    await provider.getStageBreakdown(access, { phase: 'q3' }),
    await provider.getTypeBreakdown(access, { phase: 'q3' }),
    await provider.getQuarterlyRevenueTrend(access, {}),
    await provider.getWeeklyActivitySeries(access, {}),
    await provider.getWeeklyGoalProgress(access, {}),
    await provider.getRegistrationOpsSummary(access, {}),
    await provider.getPartnerLeaderboard(access, { phase: 'q3' }),
    await provider.getManagerDirectory(access),
    await provider.getPartnerRoster(access, {}),
    await provider.getPartnerCertification(access, {}),
    await provider.listScopedOpportunities(access, { phase: 'q3' }, { limit: 50 }),
    await provider.listPendingRegistrations(access, {}, { limit: 50 }),
    await provider.listUnconvertedRegistrations(access, {}, { limit: 50 }),
    await provider.listDuplicateRegistrationGroups(access, {}, { limit: 50 }),
    await provider.listRecentRegistrations(access, {}, { limit: 50 }),
    await provider.getTeamRoster(access, {}),
    await provider.getRegistrationSlaAlerts(access, {}, 8),
    await provider.listWeeklyClassificationMeetings(
      access,
      { partnerManagerId: book.partnerManagers[0]!.id },
      { limit: 50 },
    ),
  ];
  // The row query, walked to exhaustion rather than sampled: every page is
  // part of the public surface.
  let cursor: string | undefined;
  let pages = 0;
  do {
    const result = await provider.listQuarterOpportunities(
      access,
      { quarter },
      { ...(cursor ? { cursor } : {}), limit: 7 },
    );
    answers.push(result);
    cursor = result.data.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(200);
  } while (cursor !== undefined);
  return answers;
}

// ---- 1. the static boundary ------------------------------------------------

describe('static boundary', () => {
  // Vitest runs from the repository root, so src/ is a stable relative path.
  const SRC_ROOT = path.join(process.cwd(), 'src');

  /**
   * Where the snapshot row type may be named, relative to src/: the domain
   * model that defines it, the metrics specification that consumes it, the
   * mock generators that fabricate it, and this suite. Everything else —
   * views, components, hooks, contracts, telemetry — proves the boundary by
   * never naming it at all.
   */
  const ALLOWED_REFERENCES = new Set([
    'data/types.ts',
    'lib/metrics.ts',
    'lib/metrics.test.ts',
    'data/mock/generate.ts',
    'data/mock/ScaleDataProvider.ts',
    'data/rawSnapshotBoundary.test.ts',
  ]);

  function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...collectSourceFiles(full));
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
    return files;
  }

  it('keeps the snapshot row type named only where history legitimately lives', () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const relative = path.relative(SRC_ROOT, file);
      if (
        /\bPipelineSnapshot\b/.test(readFileSync(file, 'utf8')) &&
        !ALLOWED_REFERENCES.has(relative)
      ) {
        offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('exposes no history or manager-series method on the provider contract', () => {
    // The closed method inventory: raw history left the contract when
    // listPipelineSnapshots() was removed, and a manager historical series
    // may not return until historical ownership exists (the deferred
    // Forecast Quality trend). Any new method is caught here first.
    expect('listPipelineSnapshots' in provider).toBe(false);
    const historyMethods = DATA_PROVIDER_METHODS.filter((method) =>
      /snapshot|history|weekly/i.test(method),
    );
    // The forecast series is the only history-bearing method; the two weekly
    // activity aggregates are bounded eight-week buckets over the meeting
    // collection, and the classification calendar is a bounded one-week page
    // of meeting rows — all three are pinned here so nothing raw-bearing can
    // join this list quietly.
    expect(historyMethods).toEqual([
      'getWeeklyForecastSeries',
      'getWeeklyActivitySeries',
      'getWeeklyGoalProgress',
      'listWeeklyClassificationMeetings',
    ]);
    const managerHistory = DATA_PROVIDER_METHODS.filter(
      (method) => /manager/i.test(method) && /series|history|weekly/i.test(method),
    );
    expect(managerHistory).toEqual([]);
  });
});

// ---- 2. the runtime boundary -----------------------------------------------

describe('runtime boundary', () => {
  it('guards a real boundary: the provider holds raw rows the tests can count', () => {
    // Without this the recursive scans below could pass vacuously over a
    // book that had no history to leak.
    expect(book.snapshots.length).toBeGreaterThan(1_000);
  });

  it('no internal-audience answer carries a raw snapshot, through every page', async () => {
    const answers = await collectAllAnswers(INTERNAL_DEMO_SCOPE);
    // More answers than methods: the internal walk spans several pages.
    expect(answers.length).toBeGreaterThan(DATA_PROVIDER_METHODS.length);
    expectNoRawHistory(answers, 'internal');
  });

  it('no partner-audience answer carries a raw snapshot, through every page', async () => {
    const answers = await collectAllAnswers(partnerScope);
    expect(answers.length).toBeGreaterThanOrEqual(DATA_PROVIDER_METHODS.length);
    expectNoRawHistory(answers, 'partner');
  });

  it('weekly history crosses as bounded buckets with no per-deal references', async () => {
    for (const access of [INTERNAL_DEMO_SCOPE, partnerScope]) {
      const { data: weeks } = await provider.getWeeklyForecastSeries(access, { quarter });
      // Fourteen-ish weeks of a quarter, not thousands of rows; the bound
      // holds because a quarter has a bounded number of weeks, whatever the
      // book weighs.
      expect(weeks.length).toBeLessThan(20);
      // A bucket is an aggregate: no opportunity id, no row references.
      expect(JSON.stringify(weeks)).not.toContain('opportunityId');
    }
  });

  it('hook state carries the same boundary: series and pages are bucket/row shaped', async () => {
    const { result } = renderHook(() =>
      useWeeklySeries(provider, INTERNAL_DEMO_SCOPE, { quarter }),
    );
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data!.length).toBeLessThan(20);
    expectNoRawHistory(result.current, 'useWeeklySeries');
  });

  it('stays bounded at 100× volume: buckets and pages, never rows of history', async () => {
    const scaled = new ScaleDataProvider(100, book);
    expect(scaled.size.snapshots).toBeGreaterThan(100_000);

    const { data: weeks } = await scaled.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    expect(weeks.length).toBeLessThan(20);
    expect(JSON.stringify(weeks)).not.toContain('opportunityId');

    const { data: page } = await scaled.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 25 },
    );
    expect(page.rows.length).toBeLessThanOrEqual(25);
    expect(page.totalCount).toBeGreaterThan(page.rows.length);
    expectNoRawHistory(page, 'scaled-page');
  });
});

// ---- 3. failure paths --------------------------------------------------------

describe('failure paths', () => {
  it('typed page errors carry no row data, snapshot or otherwise', async () => {
    const invalidLimit = await provider
      .listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { limit: 0 })
      .catch((caught: unknown) => caught);
    expect(isPageQueryError(invalidLimit)).toBe(true);

    const { data: first } = await provider.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 7 },
    );
    const foreignCursor = await provider
      .listQuarterOpportunities(
        INTERNAL_DEMO_SCOPE,
        { quarter, partnerManagerId: book.partnerManagers[0]!.id },
        { cursor: first.nextCursor, limit: 7 },
      )
      .catch((caught: unknown) => caught);
    expect(isPageQueryError(foreignCursor)).toBe(true);

    for (const error of [invalidLimit, foreignCursor]) {
      const serialized = JSON.stringify({
        name: (error as Error).name,
        code: (error as PageQueryError).code,
        message: (error as Error).message,
      });
      expect(serialized).not.toContain('takenAt');
      expect(serialized).not.toContain(book.opportunities[0]!.id);
    }
  });

  it('simulated transport failures carry no provider data either', async () => {
    const remote = new SimulatedRemoteProvider(new MockDataProvider(book), {
      latencyMs: 0,
      failFirstCalls: 1,
    });
    const failure = await remote
      .getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, { quarter })
      .catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(Error);
    const serialized = JSON.stringify({
      name: (failure as Error).name,
      message: (failure as Error).message,
    });
    expect(serialized).not.toContain('takenAt');
    expect(serialized).not.toContain('opportunityId');
  });
});
