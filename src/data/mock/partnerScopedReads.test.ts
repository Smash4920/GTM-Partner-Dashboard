import { describe, expect, it } from 'vitest';
import { createFailSafeEvaluator } from '../../lib/featureFlags';
import {
  applyTeamRosterOverlays,
  registrationSlaAlerts,
  registrationsNewestFirst,
} from '../../lib/metrics';
import { applyDemoAccessScope, INTERNAL_DEMO_SCOPE } from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import { MockDataProvider } from './MockDataProvider';
import { generateDashboardData } from './generate';
import { makeTeamUser } from '../../test/fixtures';

/**
 * The VAL-CROSS-004 conformance suite: the scoped reads Partner View and
 * Data Connections migrated onto, checked against the metrics layer the way
 * `MockDataProvider.test.ts` checks the older queries. The row-boundary
 * assertions are equalities against the scoped book, not spot checks — a
 * partner-audience answer is computed from that partner's rows alone, so
 * the whole answer is the boundary proof. The flag matrix at the end pins
 * the other half of the claim: no local flag state can move that boundary.
 *
 * Split out of `MockDataProvider.test.ts` to keep that file under the
 * repository's 1,200-line source limit; both files share the same
 * conformance-suite role.
 */
const book = generateDashboardData();
const provider = new MockDataProvider(book);

describe('Partner View and Data Connections scoped reads (VAL-CROSS-004)', () => {
  const partnerScope: DemoAccessScope = {
    audience: 'partner',
    partnerId: book.partners[0]!.id,
  };

  it('serves registration history newest-first, exactly what the metrics layer orders', async () => {
    const expected = registrationsNewestFirst(book.registrations);
    expect(expected.length).toBeGreaterThan(25);

    const { data } = await provider.listRecentRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 25 });
    expect(data.rows).toEqual(expected.slice(0, 25));
    expect(data.totalCount).toBe(expected.length);
    // Every status is in the history, not only the pending queue.
    const statuses = new Set(data.rows.map((row) => row.status));
    expect(statuses.size).toBeGreaterThan(1);
  });

  it('walks registration history exhaustively by cursor, with no duplicates or gaps', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const { data } = await provider.listRecentRegistrations(
        INTERNAL_DEMO_SCOPE,
        {},
        { ...(cursor ? { cursor } : {}), limit: 7 },
      );
      seen.push(...data.rows.map((row) => row.id));
      cursor = data.nextCursor;
      pages += 1;
      expect(pages).toBeLessThan(200);
    } while (cursor !== undefined);

    expect(seen).toEqual(registrationsNewestFirst(book.registrations).map((row) => row.id));
  });

  it('scopes registration history to the partner audience before any row is read', async () => {
    const partner = book.partners.find((candidate) =>
      book.registrations.some((row) => row.partnerId === candidate.id),
    );
    if (!partner) throw new Error('fixture has no partner with a registration');
    const audience: DemoAccessScope = { audience: 'partner', partnerId: partner.id };

    const expected = registrationsNewestFirst(applyDemoAccessScope(book, audience).registrations);
    expect(expected.length).toBeGreaterThan(0);
    const { data } = await provider.listRecentRegistrations(audience, {}, { limit: 50 });

    expect(data.rows).toEqual(expected);
    expect(data.totalCount).toBe(expected.length);
    // The boundary in one line: no Sell To deal's registration, no conflict
    // row, no other partner's submission — equality against the scoped book
    // says it for the seed; the scoped fixture above pins the row ids.
    expect(data.rows.every((row) => row.partnerId === partner.id)).toBe(true);
  });

  it('serves the internal roster as loaded, with the session overlays applied on top', async () => {
    const { data: raw } = await provider.getTeamRoster(INTERNAL_DEMO_SCOPE, {});
    expect(raw).toEqual(book.teamUsers);

    const patched = book.teamUsers[0]!;
    const added = makeTeamUser({ id: 'user-session', name: 'Session Add' });
    const { data: overlaid } = await provider.getTeamRoster(INTERNAL_DEMO_SCOPE, {
      overrides: { [patched.id]: { status: 'suspended' } },
      added: [added],
    });
    expect(overlaid.map((user) => user.id)).toEqual([
      ...book.teamUsers.map((user) => user.id),
      'user-session',
    ]);
    expect(overlaid.find((user) => user.id === patched.id)?.status).toBe('suspended');
  });

  it('serves a partner audience no roster — the session’s overlays fall with it', async () => {
    const { data } = await provider.getTeamRoster(partnerScope, {
      overrides: { [book.teamUsers[0]!.id]: { status: 'suspended' } },
      added: [makeTeamUser({ id: 'user-session' })],
    });
    expect(data).toEqual([]);
  });

  it('answers the SLA digest the notification rule computes over the scoped queue', async () => {
    const expected = registrationSlaAlerts(book.registrations, book.partners, book.teamUsers);
    expect(expected.length).toBeGreaterThan(4);

    const { data } = await provider.getRegistrationSlaAlerts(INTERNAL_DEMO_SCOPE, {}, 4);
    // Bounded like getForecastQuality: the window is the top of the queue,
    // the counts size the whole of it.
    expect(data.alerts).toEqual(expected.slice(0, 4));
    expect(data.totalCount).toBe(expected.length);
    expect(data.approachingCount).toBe(
      expected.filter((alert) => alert.state === 'approaching').length,
    );
    expect(data.ownedCount).toBe(expected.filter((alert) => alert.owner !== undefined).length);
    const expectedByOwner: Record<string, number> = {};
    for (const alert of expected) {
      if (alert.owner === undefined) continue;
      expectedByOwner[alert.owner.id] = (expectedByOwner[alert.owner.id] ?? 0) + 1;
    }
    expect(data.alertCountByOwner).toEqual(expectedByOwner);
  });

  it('resolves alert owners against the overlaid roster, not the raw directory', async () => {
    const baseline = registrationSlaAlerts(book.registrations, book.partners, book.teamUsers);
    const owned = baseline.find((alert) => alert.owner !== undefined);
    if (!owned?.owner) throw new Error('fixture has no owned alert');
    const ownerId = owned.owner.id;

    const overlaid = applyTeamRosterOverlays(book.teamUsers, {
      [ownerId]: { status: 'suspended' },
    });
    const expected = registrationSlaAlerts(book.registrations, book.partners, overlaid);
    const { data } = await provider.getRegistrationSlaAlerts(
      INTERNAL_DEMO_SCOPE,
      { overrides: { [ownerId]: { status: 'suspended' } } },
      50,
    );
    // The override is already visible in who owns what: the answer is the
    // rule's answer over the overlaid roster, not the raw directory's.
    expect(data.alerts.every((alert) => alert.owner?.id !== ownerId)).toBe(true);
    expect(data.totalCount).toBe(baseline.length);
    expect(data.alerts).toEqual(expected);
    expect(data.ownedCount).toBe(expected.filter((alert) => alert.owner !== undefined).length);
  });

  it('computes a partner audience’s alerts from its own conflict-free queue, ownerless', async () => {
    const scopedBookFor = (partnerId: string) =>
      applyDemoAccessScope(book, { audience: 'partner', partnerId });
    const partner = book.partners.find((candidate) => {
      const scoped = scopedBookFor(candidate.id);
      return registrationSlaAlerts(scoped.registrations, scoped.partners, []).length > 0;
    });
    if (!partner) throw new Error('fixture has no partner with an SLA alert');
    const audience: DemoAccessScope = { audience: 'partner', partnerId: partner.id };
    const scoped = scopedBookFor(partner.id);
    const expected = registrationSlaAlerts(scoped.registrations, scoped.partners, []);

    const { data } = await provider.getRegistrationSlaAlerts(audience, {}, 50);
    expect(data.alerts).toEqual(expected);
    expect(data.totalCount).toBe(expected.length);
    expect(data.ownedCount).toBe(0);
    expect(data.alertCountByOwner).toEqual({});
  });
});

describe('VAL-CROSS-004: no flag state can move the partner row boundary', () => {
  /**
   * The scoped answers Partner View renders, replayed across every state the
   * fail-safe flag evaluator can settle into. The evaluator takes no scope,
   * role, or partner input and the provider takes no flag, so the only way a
   * flag could move a partner's rows is through shared mutable state neither
   * side declares. Walking the whole state matrix and demanding identical
   * answers is what pins that absence. The scope layer's own matrix (in
   * accessScope.test.ts, VAL-DATA-004) covers the scoping functions; this
   * one covers the queries the partner portal actually reads.
   */
  const outcomes = [
    { kind: 'value', enabled: true, via: 'environment-override' },
    { kind: 'value', enabled: false, via: 'environment-override' },
    { kind: 'unavailable' }, // cold start
    { kind: 'malformed' },
    { kind: 'timeout' },
    { kind: 'unavailable' }, // past the cache bound: stale, safe default
    { kind: 'value', enabled: true, via: 'environment-override' }, // recovered
  ] as const;

  it('serves byte-identical partner answers across every evaluator state', async () => {
    const partner = book.partners.find((candidate) =>
      book.opportunities.some((opp) => opp.partnerId === candidate.id && opp.oppType !== 'sell-to'),
    );
    if (!partner) throw new Error('fixture has no partner with a visible deal');
    const audience: DemoAccessScope = { audience: 'partner', partnerId: partner.id };

    const partnerViewAnswers = async () =>
      JSON.stringify([
        await provider.getPerformanceSummary(audience, { phase: 'fy' }),
        await provider.getStageBreakdown(audience, { phase: 'fy' }),
        await provider.getTypeBreakdown(audience, { phase: 'fy' }),
        await provider.getQuarterlyRevenueTrend(audience, { partnerId: partner.id }),
        await provider.getPartnerCertification(audience, { partnerId: partner.id }),
        await provider.getRegistrationOpsSummary(audience, { partnerId: partner.id }),
        await provider.listScopedOpportunities(audience, { phase: 'fy' }, { limit: 25 }),
        await provider.listPendingRegistrations(audience, {}, { limit: 25 }),
        await provider.listUnconvertedRegistrations(audience, {}, { limit: 25 }),
        await provider.listRecentRegistrations(audience, {}, { limit: 25 }),
        await provider.getTeamRoster(audience, {}),
        await provider.getRegistrationSlaAlerts(audience, {}, 8),
      ]);

    const queue = [...outcomes];
    let now = 0;
    const evaluator = createFailSafeEvaluator(() => queue.shift() ?? { kind: 'unavailable' }, {
      now: () => now,
      maxCacheAgeMs: 100,
    });

    const baseline = await partnerViewAnswers();
    for (let step = 0; step < outcomes.length; step += 1) {
      const evaluation = evaluator.evaluate('productionRequirements');
      now += 150; // past the cache bound, so later failures go stale
      expect(evaluation.enabled === true || evaluation.enabled === false).toBe(true);
      expect(await partnerViewAnswers()).toBe(baseline);
    }
  });
});
