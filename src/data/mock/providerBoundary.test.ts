import { describe, expect, it } from 'vitest';
import { CURRENT_FISCAL_QUARTER } from '../constants';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import { isPageQueryError } from '../pagination';
import type { PageQueryError } from '../pagination';
import { MockDataProvider } from './MockDataProvider';
import { ScaleDataProvider } from './ScaleDataProvider';
import { makeOpportunity, makePartner, makeProviderBook } from '../../test/fixtures';

/**
 * Round-1 provider-boundary proofs, on a book small enough to check by
 * hand:
 *
 * - Weekly history narrows with EVERY narrowed access scope. Two managers
 *   with disjoint books record disjoint snapshot rows; a manager-narrowed
 *   internal audience must see its own recorded weeks, never the org's —
 *   the partner audience was already pinned, the internal manager scope
 *   was the leak.
 * - A business-scope manager selection alone cannot invent that narrowing:
 *   under the org-wide access scope the series stays org-wide (the one
 *   documented exception, because a snapshot row does not record whose
 *   book a deal was in).
 * - A cursor is a capability of the provider INSTANCE that minted it:
 *   replayed against a second instance over the same book, or against the
 *   scaled provider over byte-identical data and epoch, it is a typed
 *   `invalid-cursor`, and a re-encoded forgery is rejected the same way.
 */

const quarter = CURRENT_FISCAL_QUARTER; // FY27-Q3

/**
 * pm-1 owns partner-1/opp-1 ($100k recorded, closing in-quarter); pm-2 owns
 * partner-2/opp-2 ($7k recorded, closing in-quarter). No shared partners,
 * no shared deals: any blend in an answer is a leak.
 */
const book = makeProviderBook({
  partnerManagers: [
    { id: 'pm-1', name: 'J. Alvarez' },
    { id: 'pm-2', name: 'R. Diaz' },
  ],
  partners: [
    makePartner({ id: 'partner-1', partnerManagerId: 'pm-1' }),
    makePartner({ id: 'partner-2', partnerManagerId: 'pm-2' }),
  ],
  opportunities: [
    makeOpportunity({
      id: 'opp-1',
      partnerId: 'partner-1',
      forecastedRevenue: 100_000,
      createdAt: '2026-08-03T00:00:00.000Z',
      expectedCloseDate: '2026-09-30T00:00:00.000Z',
    }),
    makeOpportunity({
      id: 'opp-2',
      partnerId: 'partner-2',
      forecastedRevenue: 7_000,
      createdAt: '2026-08-03T00:00:00.000Z',
      expectedCloseDate: '2026-09-30T00:00:00.000Z',
    }),
  ],
  snapshots: [
    // Recorded at the first bucket's close (the week of Aug 1–Aug 10).
    {
      takenAt: '2026-08-10T00:00:00.000Z',
      opportunityId: 'opp-1',
      forecastedRevenue: 100_000,
      forecastCategory: 'pipeline',
      stage: 'scope',
      expectedCloseDate: '2026-09-30T00:00:00.000Z',
    },
    {
      takenAt: '2026-08-10T00:00:00.000Z',
      opportunityId: 'opp-2',
      forecastedRevenue: 7_000,
      forecastCategory: 'pipeline',
      stage: 'scope',
      expectedCloseDate: '2026-09-30T00:00:00.000Z',
    },
  ],
});

const provider = new MockDataProvider(book);

/** The first (recorded) week's bucket of the quarter series. */
async function firstRecordedWeek(access: DemoAccessScope, partnerManagerId?: string) {
  const { data: weeks } = await provider.getWeeklyForecastSeries(access, {
    quarter,
    ...(partnerManagerId === undefined ? {} : { partnerManagerId }),
  });
  const recorded = weeks.find((week) => week.recordedAt !== undefined);
  if (recorded === undefined) throw new Error('expected the first week to come from a recording');
  return recorded;
}

describe('weekly history follows the access scope, not just the audience', () => {
  it('serves one internal manager only their own recorded history', async () => {
    const first = await firstRecordedWeek({ audience: 'internal', partnerManagerId: 'pm-1' });
    expect(first.total).toBe(100_000);

    const second = await firstRecordedWeek({ audience: 'internal', partnerManagerId: 'pm-2' });
    expect(second.total).toBe(7_000);
  });

  it('keeps the org-wide access scope whole: every recording, both managers', async () => {
    const org = await firstRecordedWeek(INTERNAL_DEMO_SCOPE);
    expect(org.total).toBe(107_000);
  });

  it('serves a partner audience its own recorded history only', async () => {
    const first = await firstRecordedWeek({ audience: 'partner', partnerId: 'partner-1' });
    expect(first.total).toBe(100_000);
    const second = await firstRecordedWeek({ audience: 'partner', partnerId: 'partner-2' });
    expect(second.total).toBe(7_000);
  });

  it('does not let a business-scope manager selection invent historical ownership', async () => {
    // The documented exception, pinned from the other side: under org-wide
    // ACCESS, ForecastScope.partnerManagerId filters the live tiles but the
    // recorded weeks stay org-wide — a snapshot row cannot say whose book
    // the deal was in, so the manager series would otherwise draw a cliff
    // that never happened.
    const selected = await firstRecordedWeek(INTERNAL_DEMO_SCOPE, 'pm-2');
    expect(selected.total).toBe(107_000);
    const { data: withSelection } = await provider.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter,
      partnerManagerId: 'pm-2',
    });
    const { data: orgWide } = await provider.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter,
    });
    expect(withSelection).toEqual(orgWide);
  });

  it('treats an unknown manager as an empty book, never as the org', async () => {
    const { data: weeks } = await provider.getWeeklyForecastSeries(
      { audience: 'internal', partnerManagerId: 'pm-nobody' },
      { quarter },
    );
    // No visible opportunities means no visible recordings: every week is
    // reconstructed from the (empty) scoped book, and nothing leaks.
    expect(weeks.every((week) => week.recordedAt === undefined)).toBe(true);
    expect(weeks.every((week) => week.total === 0)).toBe(true);
  });
});

describe('cursors are bound to the provider instance', () => {
  async function firstPageCursor(source: MockDataProvider): Promise<string> {
    const { data: page } = await source.listQuarterOpportunities(
      INTERNAL_DEMO_SCOPE,
      { quarter },
      { limit: 1 },
    );
    if (page.nextCursor === undefined) throw new Error('expected a continuation');
    return page.nextCursor;
  }

  async function rejectionOf(target: MockDataProvider, cursor: string): Promise<PageQueryError> {
    const error = await target
      .listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { cursor, limit: 1 })
      .catch((caught: unknown) => caught);
    expect(isPageQueryError(error)).toBe(true);
    return error as PageQueryError;
  }

  it('rejects a cursor replayed against a second instance over the same book', async () => {
    const another = new MockDataProvider(book);
    const error = await rejectionOf(another, await firstPageCursor(provider));
    expect(error.code).toBe('invalid-cursor');
  });

  it('rejects a cursor replayed against the scaled provider over identical data', async () => {
    // Scale 1 is byte-identical data with the same epoch and the same query
    // keys: only the instance differs, and that is enough.
    const scaled = new ScaleDataProvider(1, book);
    const error = await rejectionOf(scaled, await firstPageCursor(provider));
    expect(error.code).toBe('invalid-cursor');
  });

  it('rejects a re-encoded cursor whose offset was rewritten', async () => {
    const cursor = await firstPageCursor(provider);
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as Record<
      string,
      unknown
    >;
    // Rewind to the first page: a caller who already consumed it gets the
    // rows twice — exactly the harm the seal exists to price out.
    const forged = btoa(JSON.stringify({ ...payload, o: 0 }))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '');
    const error = await rejectionOf(provider, forged);
    expect(error.code).toBe('invalid-cursor');
  });

  it('still walks its own cursor to exhaustion', async () => {
    // The binding costs the honest caller nothing.
    const ids = new Set<string>();
    let cursor: string | undefined;
    do {
      const { data: page } = await provider.listQuarterOpportunities(
        INTERNAL_DEMO_SCOPE,
        { quarter },
        { ...(cursor ? { cursor } : {}), limit: 1 },
      );
      for (const row of page.rows) ids.add(row.id);
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(ids).toEqual(new Set(['opp-1', 'opp-2']));
  });
});
