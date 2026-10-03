import { describe, expect, it } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import { MAX_SLA_ALERT_DIGEST, SlaAlertLimitError, TOP_LEADERBOARD_LIMIT } from '../DataProvider';
import type { PartnerLeaderboardEntry, PerformanceScope } from '../DataProvider';
import { NO_SESSION_EDITS } from '../sessionEdits';
import { makeOpportunity, makePartner, makeProviderBook } from '../../test/fixtures';
import { MockDataProvider } from './MockDataProvider';
import { generateDashboardData } from './generate';

/**
 * The bounded leaderboard contract. The old `getPartnerLeaderboard` returned
 * a roster-sized array; its two replacements never do:
 *
 * - `getTopPartnerLeaders` is the fixed-cap answer Home and the Partner View
 *   picker render: the leading TOP_LEADERBOARD_LIMIT partners plus the size
 *   of the field. The picker's combined Sell With + Allocate ranking is
 *   computed provider-side via `oppTypes` — the old client-side merge of two
 *   independently truncated boards could crown the wrong partner.
 * - `listPartnerLeaderboard` is the full ranking a page at a time, through
 *   the shared cursor contract: bounded pages, a stable total order, and
 *   cursors bound to the query and the data epoch.
 *
 * Both answers are cut from one provider-side ranking, so the top board and
 * the paged board can never disagree.
 */

const book = generateDashboardData();
const provider = new MockDataProvider(book);

/** Every row of the paged leaderboard, gathered a cursor at a time. */
async function walkLeaderboard(
  target: MockDataProvider,
  scope: PerformanceScope,
  limit: number,
): Promise<PartnerLeaderboardEntry[]> {
  const rows: PartnerLeaderboardEntry[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const { data } = await target.listPartnerLeaderboard(INTERNAL_DEMO_SCOPE, scope, {
      ...(cursor === undefined ? {} : { cursor }),
      limit,
    });
    rows.push(...data.rows);
    cursor = data.nextCursor;
    pages += 1;
    expect(pages).toBeLessThan(100);
  } while (cursor !== undefined);
  return rows;
}

describe('the bounded leaderboard answers', () => {
  it('caps the fixed top-leader answer at the exported limit and counts the whole field', async () => {
    // The cap is exactly ten, exported once, and the field count rides along
    // so "Top 10 of N" can never be a guess at N.
    expect(TOP_LEADERBOARD_LIMIT).toBe(10);
    expect(book.partners.length).toBeGreaterThan(TOP_LEADERBOARD_LIMIT);

    const { data } = await provider.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, { phase: 'fy' });
    expect(data.leaders).toHaveLength(TOP_LEADERBOARD_LIMIT);
    expect(data.totalPartners).toBe(book.partners.length);
  });

  it('cuts the top answer and the first page from the same ranking', async () => {
    const { data: top } = await provider.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, {
      phase: 'q3',
    });
    const { data: page } = await provider.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'q3' },
      {},
    );
    // A page with no stated limit is the shared default page, not the roster.
    expect(page.rows.length).toBeLessThanOrEqual(25);
    expect(page.totalCount).toBe(book.partners.length);
    expect(top.leaders).toEqual(page.rows.slice(0, TOP_LEADERBOARD_LIMIT));
  });

  it('walks the whole ranking in unique, bounded, deterministic pages', async () => {
    const walked = await walkLeaderboard(provider, { phase: 'fy' }, 7);
    const ids = walked.map((row) => row.partner.id);
    // Exhaustive without a roster-sized answer: every partner exactly once.
    expect(ids).toHaveLength(book.partners.length);
    expect(new Set(ids).size).toBe(book.partners.length);

    // Deterministic: a second identical walk returns the identical order.
    const again = await walkLeaderboard(provider, { phase: 'fy' }, 7);
    expect(again.map((row) => row.partner.id)).toEqual(ids);

    // The order is the ranking: closed-won descending, then open pipeline.
    for (let index = 1; index < walked.length; index += 1) {
      const previous = walked[index - 1]!;
      const current = walked[index]!;
      expect(
        previous.closedWonValue > current.closedWonValue ||
          (previous.closedWonValue === current.closedWonValue &&
            previous.openPipelineValue >= current.openPipelineValue),
      ).toBe(true);
    }
  });

  it('ranks session prospects alongside the roster and counts them in the field', async () => {
    const prospect = makePartner({ id: 'partner-prospect', name: 'Prospect Co' });
    const scope: PerformanceScope = { phase: 'fy', prospects: [prospect] };

    const { data: top } = await provider.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, scope);
    expect(top.totalPartners).toBe(book.partners.length + 1);

    const walked = await walkLeaderboard(provider, scope, 25);
    expect(walked).toHaveLength(book.partners.length + 1);
    const row = walked.find((entry) => entry.partner.id === 'partner-prospect');
    expect(row).toBeDefined();
    expect(row?.closedWonValue).toBe(0);
    expect(row?.openPipelineValue).toBe(0);
  });

  it('re-ranks when a session edit moves a win', async () => {
    const local = new MockDataProvider(
      makeProviderBook({
        partners: [
          makePartner({ id: 'partner-1', name: 'Northwind Systems' }),
          makePartner({ id: 'partner-2', name: 'Beacon Consulting' }),
        ],
        opportunities: [
          makeOpportunity({
            id: 'opp-p1-won',
            partnerId: 'partner-1',
            outcome: 'won',
            forecastedRevenue: 120_000,
            closedAt: '2026-08-12T00:00:00.000Z',
          }),
          makeOpportunity({
            id: 'opp-p2-won',
            partnerId: 'partner-2',
            outcome: 'won',
            forecastedRevenue: 100_000,
            closedAt: '2026-08-14T00:00:00.000Z',
          }),
        ],
      }),
    );

    const baseline = await local.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, { phase: 'fy' });
    expect(baseline.data.leaders.map((row) => row.partner.id)).toEqual(['partner-1', 'partner-2']);

    const edits = { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-p2-won': 200_000 } };
    const edited = await local.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, { phase: 'fy', edits });
    expect(edited.data.leaders.map((row) => row.partner.id)).toEqual(['partner-2', 'partner-1']);
    expect(edited.data.leaders[0]!.closedWonValue).toBe(200_000);

    // The paged board is cut from the same ranking the edit moved.
    const { data: page } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy', edits },
      {},
    );
    expect(page.rows.map((row) => row.partner.id)).toEqual(['partner-2', 'partner-1']);
  });

  it('scopes a partner audience to its own row, on both answers', async () => {
    const audience: DemoAccessScope = { audience: 'partner', partnerId: book.partners[0]!.id };

    const { data: top } = await provider.getTopPartnerLeaders(audience, { phase: 'fy' });
    expect(top.leaders.map((row) => row.partner.id)).toEqual([book.partners[0]!.id]);
    expect(top.totalPartners).toBe(1);

    const { data: page } = await provider.listPartnerLeaderboard(audience, { phase: 'fy' }, {});
    expect(page.rows.map((row) => row.partner.id)).toEqual([book.partners[0]!.id]);
    expect(page.totalCount).toBe(1);
  });

  describe('page-request validation', () => {
    it.each([
      ['zero', 0],
      ['negative', -5],
      ['fractional', 2.5],
      ['non-finite', Number.NaN],
      ['over the maximum', 101],
    ])('rejects a %s limit rather than clamping it', async (_label, limit) => {
      await expect(
        provider.listPartnerLeaderboard(INTERNAL_DEMO_SCOPE, { phase: 'fy' }, { limit }),
      ).rejects.toMatchObject({ name: 'PageQueryError', code: 'invalid-page-limit' });
    });

    it('rejects a cursor it did not mint', async () => {
      await expect(
        provider.listPartnerLeaderboard(INTERNAL_DEMO_SCOPE, { phase: 'fy' }, { cursor: 'forged' }),
      ).rejects.toMatchObject({ name: 'PageQueryError', code: 'invalid-cursor' });
    });

    it('rejects cursors minted under another phase or prospect membership as foreign', async () => {
      const { data: first } = await provider.listPartnerLeaderboard(
        INTERNAL_DEMO_SCOPE,
        { phase: 'fy' },
        { limit: 7 },
      );
      expect(first.nextCursor).toBeDefined();

      // The phase reorders the ranking, so last phase's cursor is foreign.
      await expect(
        provider.listPartnerLeaderboard(
          INTERNAL_DEMO_SCOPE,
          { phase: 'q3' },
          { limit: 7, cursor: first.nextCursor },
        ),
      ).rejects.toMatchObject({ name: 'PageQueryError', code: 'foreign-cursor' });

      // A prospect is a roster row: adding one changes membership, so the
      // pre-prospect cursor is foreign too.
      await expect(
        provider.listPartnerLeaderboard(
          INTERNAL_DEMO_SCOPE,
          {
            phase: 'fy',
            prospects: [makePartner({ id: 'partner-prospect', name: 'Prospect Co' })],
          },
          { limit: 7, cursor: first.nextCursor },
        ),
      ).rejects.toMatchObject({ name: 'PageQueryError', code: 'foreign-cursor' });
    });
  });
});

describe('leaderboard cursor identity across revenue edits', () => {
  /**
   * Three partners, one closed-won deal apiece, distinct values: at a
   * one-row page size a single revenue override can flip the ranking, and
   * every replayed cursor has a visible consequence.
   */
  const rankedProvider = () =>
    new MockDataProvider(
      makeProviderBook({
        partners: [
          makePartner({ id: 'partner-1', name: 'Northwind Systems' }),
          makePartner({ id: 'partner-2', name: 'Beacon Consulting' }),
          makePartner({ id: 'partner-3', name: 'Cascade Analytics' }),
        ],
        opportunities: [
          makeOpportunity({
            id: 'opp-p1-won',
            partnerId: 'partner-1',
            outcome: 'won',
            forecastedRevenue: 300_000,
            closedAt: '2026-08-12T00:00:00.000Z',
          }),
          makeOpportunity({
            id: 'opp-p2-won',
            partnerId: 'partner-2',
            outcome: 'won',
            forecastedRevenue: 200_000,
            closedAt: '2026-08-14T00:00:00.000Z',
          }),
          makeOpportunity({
            id: 'opp-p3-won',
            partnerId: 'partner-3',
            outcome: 'won',
            forecastedRevenue: 100_000,
            closedAt: '2026-08-16T00:00:00.000Z',
          }),
        ],
      }),
    );

  it('rejects a pre-edit cursor once a revenue edit re-ranks the board', async () => {
    const local = rankedProvider();
    const { data: first } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy' },
      { limit: 1 },
    );
    expect(first.rows.map((row) => row.partner.id)).toEqual(['partner-1']);
    expect(first.nextCursor).toBeDefined();

    // The override moves partner-3 from last to first...
    const edits = { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-p3-won': 900_000 } };
    const { data: reranked } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy', edits },
      { limit: 1 },
    );
    expect(reranked.rows.map((row) => row.partner.id)).toEqual(['partner-3']);

    // ...so the cursor minted before it is foreign, not a position in the
    // new order: replayed, it would serve the reranked page two — partner-3
    // twice, partner-1 never.
    await expect(
      local.listPartnerLeaderboard(
        INTERNAL_DEMO_SCOPE,
        { phase: 'fy', edits },
        { limit: 1, cursor: first.nextCursor },
      ),
    ).rejects.toMatchObject({ name: 'PageQueryError', code: 'foreign-cursor' });

    // A fresh post-edit walk is still exhaustive and unique, in the new
    // order.
    const walked = await walkLeaderboard(local, { phase: 'fy', edits }, 1);
    const ids = walked.map((row) => row.partner.id);
    expect(ids).toEqual(['partner-3', 'partner-1', 'partner-2']);
    expect(new Set(ids).size).toBe(3);
  });

  it('stales the cursor on any revenue edit, rank change or not', async () => {
    const local = rankedProvider();
    const { data: first } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy' },
      { limit: 1 },
    );
    // +10k to the leader changes no order — but the cursor's identity is the
    // order-affecting edit STATE, not the diff one edit happened to produce,
    // so the pre-edit token is still foreign.
    const edits = { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-p1-won': 310_000 } };
    await expect(
      local.listPartnerLeaderboard(
        INTERNAL_DEMO_SCOPE,
        { phase: 'fy', edits },
        { limit: 1, cursor: first.nextCursor },
      ),
    ).rejects.toMatchObject({ name: 'PageQueryError', code: 'foreign-cursor' });
  });

  it('keys the cursor on edit content, not object identity', async () => {
    const local = rankedProvider();
    const edits = {
      ...NO_SESSION_EDITS,
      revenueOverrides: { 'opp-p2-won': 250_000, 'opp-p3-won': 150_000 },
    };
    const { data: first } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy', edits },
      { limit: 1 },
    );
    expect(first.nextCursor).toBeDefined();
    // A rebuilt map with the same entries in another insertion order is the
    // same session state: it accepts the cursor the first spelling minted.
    const rebuilt = {
      ...NO_SESSION_EDITS,
      revenueOverrides: { 'opp-p3-won': 150_000, 'opp-p2-won': 250_000 },
    };
    const { data: replayed } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy', edits: rebuilt },
      { limit: 1, cursor: first.nextCursor },
    );
    expect(replayed.rows.map((row) => row.partner.id)).toEqual(['partner-2']);
  });

  it('keeps the cursor valid across content-only edits the ranking cannot feel', async () => {
    const local = rankedProvider();
    const { data: first } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy' },
      { limit: 1 },
    );
    expect(first.nextCursor).toBeDefined();
    // Notes, next steps, and forecast calls change what a row says, never
    // where it ranks — the hook does not refresh the board for them, so the
    // provider must not stale the cursor for them either.
    const { data: replayed } = await local.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      {
        phase: 'fy',
        edits: {
          ...NO_SESSION_EDITS,
          notes: { 'opp-p1-won': 'called twice' },
          nextSteps: { 'opp-p2-won': 'send the contract' },
          forecastCalls: { 'opp-p3-won': 'commit' },
        },
      },
      { limit: 1, cursor: first.nextCursor },
    );
    expect(replayed.rows.map((row) => row.partner.id)).toEqual(['partner-2']);
  });

  it('serves identical pages for identical edit state', async () => {
    const local = rankedProvider();
    const scope: PerformanceScope = {
      phase: 'fy',
      edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-p3-won': 900_000 } },
    };
    const { data: first } = await local.listPartnerLeaderboard(INTERNAL_DEMO_SCOPE, scope, {
      limit: 1,
    });
    const { data: again } = await local.listPartnerLeaderboard(INTERNAL_DEMO_SCOPE, scope, {
      limit: 1,
    });
    // The request is deterministic: same rows, same minted continuation.
    expect(again).toEqual(first);

    const pageTwo = () =>
      local.listPartnerLeaderboard(INTERNAL_DEMO_SCOPE, scope, {
        limit: 1,
        cursor: first.nextCursor,
      });
    const { data: replayedOnce } = await pageTwo();
    const { data: replayedTwice } = await pageTwo();
    // And a same-state cursor replay returns the same page both times.
    expect(replayedTwice).toEqual(replayedOnce);
    expect(replayedOnce.rows.map((row) => row.partner.id)).toEqual(['partner-1']);
  });
});

describe('the combined Sell With + Allocate ranking the picker used to merge client-side', () => {
  // Ten partners with a 100k Sell With win each, ten with a 100k Allocate
  // win each, and one with a 60k win of each. Every single-motion board
  // truncates the combined partner away at rank eleven; only a ranking
  // computed over both motions together can crown it. That partner also
  // holds a far larger Sell To win — internal-only revenue the picker's
  // ranking must never see.
  const partnerId = (prefix: string, index: number) =>
    `${prefix}-${String(index + 1).padStart(2, '0')}`;
  const combined = new MockDataProvider(
    makeProviderBook({
      partners: [
        ...Array.from({ length: 10 }, (_, index) =>
          makePartner({ id: partnerId('partner-sw', index), name: `Sell With ${index + 1}` }),
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          makePartner({ id: partnerId('partner-al', index), name: `Allocate ${index + 1}` }),
        ),
        makePartner({ id: 'partner-combined', name: 'Combined Motion' }),
      ],
      opportunities: [
        ...Array.from({ length: 10 }, (_, index) =>
          makeOpportunity({
            id: `opp-sw-${index}`,
            partnerId: partnerId('partner-sw', index),
            oppType: 'sell-with',
            outcome: 'won',
            forecastedRevenue: 100_000,
            closedAt: '2026-08-10T00:00:00.000Z',
          }),
        ),
        ...Array.from({ length: 10 }, (_, index) =>
          makeOpportunity({
            id: `opp-al-${index}`,
            partnerId: partnerId('partner-al', index),
            oppType: 'allocate',
            outcome: 'won',
            forecastedRevenue: 100_000,
            closedAt: '2026-08-10T00:00:00.000Z',
          }),
        ),
        makeOpportunity({
          id: 'opp-combined-sw',
          partnerId: 'partner-combined',
          oppType: 'sell-with',
          outcome: 'won',
          forecastedRevenue: 60_000,
          closedAt: '2026-08-11T00:00:00.000Z',
        }),
        makeOpportunity({
          id: 'opp-combined-al',
          partnerId: 'partner-combined',
          oppType: 'allocate',
          outcome: 'won',
          forecastedRevenue: 60_000,
          closedAt: '2026-08-11T00:00:00.000Z',
        }),
        makeOpportunity({
          id: 'opp-combined-sell-to',
          partnerId: 'partner-combined',
          oppType: 'sell-to',
          outcome: 'won',
          forecastedRevenue: 900_000,
          closedAt: '2026-08-11T00:00:00.000Z',
        }),
      ],
      registrations: [],
      targets: [],
      activities: [],
      certifications: [],
    }),
  );

  it('crowns the partner only a provider-side union can see', async () => {
    const { data } = await combined.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, {
      phase: 'fy',
      oppTypes: ['sell-with', 'allocate'],
    });
    expect(data.totalPartners).toBe(21);
    expect(data.leaders).toHaveLength(TOP_LEADERBOARD_LIMIT);
    // 60k + 60k beats every single-motion 100k — summed in the provider.
    expect(data.leaders[0]!.partner.id).toBe('partner-combined');
    expect(data.leaders[0]!.closedWonValue).toBe(120_000);
  });

  it('cannot be reproduced by merging two independently truncated boards', async () => {
    const { data: sellWith } = await combined.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, {
      phase: 'fy',
      oppType: 'sell-with',
    });
    const { data: allocate } = await combined.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, {
      phase: 'fy',
      oppType: 'allocate',
    });
    // Rank eleven on both single-motion boards: outside each cap, so a
    // client-side merge of the two capped answers never even learns it.
    expect(sellWith.leaders.some((row) => row.partner.id === 'partner-combined')).toBe(false);
    expect(allocate.leaders.some((row) => row.partner.id === 'partner-combined')).toBe(false);
  });

  it('keeps Sell To revenue out of the combined lens', async () => {
    const { data } = await combined.getTopPartnerLeaders(INTERNAL_DEMO_SCOPE, {
      phase: 'fy',
      oppTypes: ['sell-with', 'allocate'],
    });
    // 120k, not 1,020k: the internal-only Sell To win never entered the sum.
    expect(data.leaders[0]!.closedWonValue).toBe(120_000);
  });

  it('walks the paged board in the same combined order', async () => {
    const { data: page } = await combined.listPartnerLeaderboard(
      INTERNAL_DEMO_SCOPE,
      { phase: 'fy', oppTypes: ['sell-with', 'allocate'] },
      {},
    );
    expect(page.totalCount).toBe(21);
    expect(page.rows[0]!.partner.id).toBe('partner-combined');
    expect(page.rows[0]!.closedWonValue).toBe(120_000);
  });
});

describe('the SLA digest window bound', () => {
  it('exports exactly one maximum, and it is exactly eight', () => {
    expect(MAX_SLA_ALERT_DIGEST).toBe(8);
  });

  it.each([
    ['zero', 0],
    ['negative', -2],
    ['fractional', 4.5],
    ['NaN', Number.NaN],
    ['infinite', Number.POSITIVE_INFINITY],
    ['over the maximum', MAX_SLA_ALERT_DIGEST + 1],
  ])('rejects a %s maxAlerts rather than clamping it', async (_label, maxAlerts) => {
    const attempt = provider.getRegistrationSlaAlerts(INTERNAL_DEMO_SCOPE, {}, maxAlerts);
    await expect(attempt).rejects.toBeInstanceOf(SlaAlertLimitError);
    await expect(attempt).rejects.toMatchObject({
      name: 'SlaAlertLimitError',
      code: 'invalid-max-alerts',
    });
  });

  it('accepts the boundary windows: one, and the maximum itself', async () => {
    const { data: single } = await provider.getRegistrationSlaAlerts(INTERNAL_DEMO_SCOPE, {}, 1);
    expect(single.alerts.length).toBeLessThanOrEqual(1);

    const { data: full } = await provider.getRegistrationSlaAlerts(
      INTERNAL_DEMO_SCOPE,
      {},
      MAX_SLA_ALERT_DIGEST,
    );
    expect(full.alerts.length).toBeLessThanOrEqual(MAX_SLA_ALERT_DIGEST);
    // The window is a window: the counts still describe the whole queue.
    expect(full.totalCount).toBeGreaterThanOrEqual(full.alerts.length);
  });
});
