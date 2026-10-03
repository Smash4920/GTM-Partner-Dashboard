import { describe, expect, it } from 'vitest';

import { createFailSafeEvaluator, type FlagSourceOutcome } from '../lib/featureFlags';
import {
  makeMeeting,
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTarget,
  makeTeamUser,
} from '../test/fixtures';
import {
  applyDemoAccessScope,
  demoScopeKey,
  INTERNAL_DEMO_SCOPE,
  scopeOpportunities,
  scopeRegistrations,
} from './accessScope';
import type { DemoAccessScope } from './accessScope';

/**
 * The demo access scope, pinned: what each audience sees, and — VAL-DATA-004
 * — proof that no feature-flag state can change it. The scope is a pure
 * function of the book and the scope value; the flag evaluator has no scope,
 * role, or partner input at all, so the only way a flag could move a row set
 * is if the scoping functions read one. They take no flag, no clock, and no
 * global state, which is what the matrix below demonstrates end to end.
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
    makeOpportunity({ id: 'opp-1', partnerId: 'partner-1' }),
    makeOpportunity({ id: 'opp-2', partnerId: 'partner-1', oppType: 'sell-to' }),
    makeOpportunity({ id: 'opp-3', partnerId: 'partner-2' }),
  ],
  registrations: [
    makeRegistration({ id: 'reg-1', partnerId: 'partner-1', accountName: 'Acme Freight' }),
    makeRegistration({ id: 'reg-2', partnerId: 'partner-2', accountName: 'Acme Freight' }),
    makeRegistration({ id: 'reg-3', partnerId: 'partner-1', accountName: 'Globex' }),
  ],
  targets: [makeTarget({ partnerId: 'partner-1' }), makeTarget({ partnerId: 'partner-2' })],
  activities: [
    makeMeeting({ id: 'meeting-1', partnerId: 'partner-1', partnerManagerId: 'pm-1' }),
    makeMeeting({ id: 'meeting-2', partnerId: 'partner-2', partnerManagerId: 'pm-2' }),
  ],
  certifications: [
    {
      partnerId: 'partner-1',
      partnerStrategistsCertified: 1,
      partnerStrategistsGoal: 2,
      partnerEngineersCertified: 1,
      partnerEngineersGoal: 2,
    },
    {
      partnerId: 'partner-2',
      partnerStrategistsCertified: 0,
      partnerStrategistsGoal: 1,
      partnerEngineersCertified: 0,
      partnerEngineersGoal: 1,
    },
  ],
  teamUsers: [makeTeamUser()],
});

const PARTNER_ONE: DemoAccessScope = { audience: 'partner', partnerId: 'partner-1' };

describe('applyDemoAccessScope', () => {
  it('internal org-wide scope returns every collection in full', () => {
    const scoped = applyDemoAccessScope(book, INTERNAL_DEMO_SCOPE);
    expect(scoped.partners).toHaveLength(2);
    expect(scoped.opportunities.map((opp) => opp.id)).toEqual(['opp-1', 'opp-2', 'opp-3']);
    expect(scoped.registrations).toHaveLength(3);
    expect(scoped.targets).toHaveLength(2);
    expect(scoped.activities).toHaveLength(2);
    expect(scoped.certifications).toHaveLength(2);
    expect(scoped.partnerManagers).toHaveLength(2);
    expect(scoped.teamUsers).toHaveLength(1);
  });

  it('internal manager scope narrows partner-linked collections to their book', () => {
    const scoped = applyDemoAccessScope(book, { audience: 'internal', partnerManagerId: 'pm-1' });
    expect(scoped.partners.map((partner) => partner.id)).toEqual(['partner-1']);
    expect(scoped.opportunities.map((opp) => opp.id)).toEqual(['opp-1', 'opp-2']);
    expect(scoped.registrations.map((reg) => reg.id)).toEqual(['reg-1', 'reg-3']);
    expect(scoped.targets.map((target) => target.partnerId)).toEqual(['partner-1']);
    expect(scoped.activities.map((meeting) => meeting.id)).toEqual(['meeting-1']);
    expect(scoped.certifications.map((cert) => cert.partnerId)).toEqual(['partner-1']);
    expect(scoped.partnerManagers.map((manager) => manager.id)).toEqual(['pm-1']);
    // The notification roster is org operations, not one manager's book.
    expect(scoped.teamUsers).toHaveLength(1);
  });

  it('partner scope keeps the partner’s rows and drops Sell To, conflicts, and directories', () => {
    const scoped = applyDemoAccessScope(book, PARTNER_ONE);
    expect(scoped.partners.map((partner) => partner.id)).toEqual(['partner-1']);
    // opp-2 is Sell To: the partner is the customer there, so it never shows.
    expect(scoped.opportunities.map((opp) => opp.id)).toEqual(['opp-1']);
    // reg-1 conflicts with reg-2 (partner-2 registered the same account):
    // both sides drop, the conflict stays an internal matter.
    expect(scoped.registrations.map((reg) => reg.id)).toEqual(['reg-3']);
    expect(scoped.targets.map((target) => target.partnerId)).toEqual(['partner-1']);
    expect(scoped.activities.map((meeting) => meeting.id)).toEqual(['meeting-1']);
    expect(scoped.certifications.map((cert) => cert.partnerId)).toEqual(['partner-1']);
    // The directories are internal data: no manager list, no roster.
    expect(scoped.partnerManagers).toEqual([]);
    expect(scoped.teamUsers).toEqual([]);
  });

  it('a scope naming an unknown partner returns empty collections, never the book', () => {
    const scoped = applyDemoAccessScope(book, { audience: 'partner', partnerId: 'partner-absent' });
    expect(scoped.partners).toEqual([]);
    expect(scoped.opportunities).toEqual([]);
    expect(scoped.registrations).toEqual([]);
    expect(scoped.targets).toEqual([]);
    expect(scoped.activities).toEqual([]);
    expect(scoped.certifications).toEqual([]);
  });

  it('is pure: no input is mutated and results are fresh arrays', () => {
    const before = JSON.stringify(book);
    const scoped = applyDemoAccessScope(book, PARTNER_ONE);
    expect(JSON.stringify(book)).toBe(before);
    expect(scoped.partners).not.toBe(book.partners);
    expect(scoped.opportunities).not.toBe(book.opportunities);
    expect(applyDemoAccessScope(book, PARTNER_ONE)).toEqual(scoped);
  });
});

describe('demoScopeKey', () => {
  it('serializes the scope to a primitive identity', () => {
    expect(demoScopeKey(INTERNAL_DEMO_SCOPE)).toBe('internal:org');
    expect(demoScopeKey({ audience: 'internal', partnerManagerId: 'pm-1' })).toBe('internal:pm-1');
    expect(demoScopeKey(PARTNER_ONE)).toBe('partner:partner-1');
  });
});

describe('VAL-DATA-004: no flag state can change the scope or its row sets', () => {
  const FRESH_ON: FlagSourceOutcome = { kind: 'value', enabled: true, via: 'environment-override' };
  const FRESH_OFF: FlagSourceOutcome = {
    kind: 'value',
    enabled: false,
    via: 'environment-override',
  };

  /**
   * Every evaluator state the fail-safe wrapper can settle into: fresh on,
   * fresh off, cold start (no value, empty cache), malformed, timeout,
   * unavailable past the cache bound (stale), and recovery back to fresh.
   */
  function outcomes(): FlagSourceOutcome[] {
    return [
      FRESH_ON,
      FRESH_OFF,
      { kind: 'unavailable' }, // cold start: nothing cached yet
      { kind: 'malformed' },
      { kind: 'timeout' },
      { kind: 'unavailable' }, // past the bound below: stale, safe default
      FRESH_ON, // recovered
    ];
  }

  it('preserves the exact scope and row ids across every evaluator state', () => {
    const queue = outcomes();
    let now = 0;
    const evaluator = createFailSafeEvaluator(() => queue.shift() ?? { kind: 'unavailable' }, {
      now: () => now,
      maxCacheAgeMs: 100,
    });
    const scope: DemoAccessScope = { ...PARTNER_ONE };

    const visibleIds = () => ({
      opportunities: scopeOpportunities(book.opportunities, book.partners, scope).map(
        (opp) => opp.id,
      ),
      registrations: scopeRegistrations(book.registrations, book.partners, scope).map(
        (reg) => reg.id,
      ),
      whole: applyDemoAccessScope(book, scope).opportunities.map((opp) => opp.id),
    });
    const baseline = visibleIds();
    const scopeBefore = JSON.stringify(scope);

    for (let step = 0; step < 7; step += 1) {
      const evaluation = evaluator.evaluate('productionRequirements');
      now += 150; // past the cache bound, so later failures go stale

      expect(visibleIds()).toEqual(baseline);
      expect(JSON.stringify(scope)).toBe(scopeBefore);
      expect(evaluation.enabled === true || evaluation.enabled === false).toBe(true);
      // The evaluation itself carries nothing a scope could be smuggled in on.
      expect(evaluation).not.toHaveProperty('role');
      expect(evaluation).not.toHaveProperty('scope');
      expect(evaluation).not.toHaveProperty('partnerId');
    }
    expect(baseline.opportunities).toEqual(['opp-1']);
    expect(baseline.registrations).toEqual(['reg-3']);
  });
});
