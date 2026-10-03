import { describe, expect, it } from 'vitest';

import { makeProviderBook } from '../test/fixtures';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { DATA_PROVIDER_CONTEXT_SLOTS, DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { DEFAULT_ACTION_POLICY } from '../lib/actionPolicy';

/**
 * VAL-DATA-003: the demo access scope is a required, first parameter of every
 * data-bearing provider method — there is no unscoped path across the seam.
 * TypeScript enforces the signature at compile time (the `@ts-expect-error`
 * cases below fail the build the day one of them stops being an error); the
 * runtime cases pin the fail-closed behavior for anything that bypasses the
 * compiler, and the inventory pins the method set itself so a new
 * data-bearing method cannot appear without this suite noticing.
 */

const quarter = 'FY27-Q3';

/** Every method on the contract, exercised with no access scope at all. */
function unscopedCalls(provider: DataProvider): (() => Promise<unknown>)[] {
  const missing = undefined as unknown as DemoAccessScope;
  return [
    () => provider.getForecastSummary(missing, { quarter }),
    () => provider.getWeightedForecast(missing, { quarter }),
    () => provider.getForecastQuality(missing, { quarter }, 3),
    () => provider.getManagerForecastGroups(missing, { quarter }),
    () => provider.getWeeklyForecastSeries(missing, { quarter }),
    () => provider.listQuarterOpportunities(missing, { quarter }, { limit: 5 }),
    () => provider.getPartnerDirectory(missing),
    () => provider.getPerformanceSummary(missing, { phase: 'q3' }),
    () => provider.getRegistrationFunnel(missing, { phase: 'q3' }),
    () => provider.getStageBreakdown(missing, { phase: 'q3' }),
    () => provider.getTypeBreakdown(missing, { phase: 'q3' }),
    () => provider.getQuarterlyRevenueTrend(missing, {}),
    () => provider.getWeeklyActivitySeries(missing, {}),
    () => provider.getWeeklyGoalProgress(missing, {}),
    () => provider.getRegistrationOpsSummary(missing, {}),
    () => provider.getTopPartnerLeaders(missing, { phase: 'q3' }),
    () => provider.listPartnerLeaderboard(missing, { phase: 'q3' }, { limit: 5 }),
    () => provider.getManagerDirectory(missing),
    () => provider.getPartnerRoster(missing, {}),
    () => provider.getPartnerCertification(missing, {}),
    () => provider.listScopedOpportunities(missing, { phase: 'q3' }, { limit: 5 }),
    () => provider.listPendingRegistrations(missing, {}, { limit: 5 }),
    () => provider.listUnconvertedRegistrations(missing, {}, { limit: 5 }),
    () => provider.listDuplicateRegistrationGroups(missing, {}, { limit: 5 }),
    () => provider.listRecentRegistrations(missing, {}, { limit: 5 }),
    () => provider.getTeamRoster(missing, {}),
    () => provider.getRegistrationSlaAlerts(missing, {}, 8),
    () =>
      provider.listWeeklyClassificationMeetings(
        missing,
        { partnerManagerId: 'pm-1' },
        { limit: 5 },
      ),
    () => provider.getActionCenterSummary(missing, { policy: DEFAULT_ACTION_POLICY }),
    () => provider.listActionItems(missing, { policy: DEFAULT_ACTION_POLICY }, {}),
  ];
}

describe('DataProvider demo access scope (VAL-DATA-003)', () => {
  it('preserves the complete seam method order and trailing context slots', () => {
    const slots = {
      getActionCenterSummary: 2,
      listActionItems: 3,
      getForecastSummary: 2,
      getWeightedForecast: 2,
      getForecastQuality: 3,
      getManagerForecastGroups: 2,
      getWeeklyForecastSeries: 2,
      listQuarterOpportunities: 3,
      getPartnerDirectory: 1,
      getPerformanceSummary: 2,
      getRegistrationFunnel: 2,
      getStageBreakdown: 2,
      getTypeBreakdown: 2,
      getQuarterlyRevenueTrend: 2,
      getWeeklyActivitySeries: 2,
      getWeeklyGoalProgress: 2,
      getRegistrationOpsSummary: 2,
      getTopPartnerLeaders: 2,
      listPartnerLeaderboard: 3,
      getManagerDirectory: 1,
      getPartnerRoster: 2,
      getPartnerCertification: 2,
      listScopedOpportunities: 3,
      listPendingRegistrations: 3,
      listUnconvertedRegistrations: 3,
      listDuplicateRegistrationGroups: 3,
      listRecentRegistrations: 3,
      getTeamRoster: 2,
      getRegistrationSlaAlerts: 3,
      listWeeklyClassificationMeetings: 3,
    };
    expect(DATA_PROVIDER_CONTEXT_SLOTS).toStrictEqual(slots);
    expect(DATA_PROVIDER_METHODS).toStrictEqual(Object.keys(slots));
  });

  it('keeps a closed inventory: exactly these thirty data-bearing methods exist', () => {
    expect([...DATA_PROVIDER_METHODS].sort()).toEqual([
      'getActionCenterSummary',
      'getForecastQuality',
      'getForecastSummary',
      'getManagerDirectory',
      'getManagerForecastGroups',
      'getPartnerCertification',
      'getPartnerDirectory',
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getRegistrationOpsSummary',
      'getRegistrationSlaAlerts',
      'getStageBreakdown',
      'getTeamRoster',
      'getTopPartnerLeaders',
      'getTypeBreakdown',
      'getWeeklyActivitySeries',
      'getWeeklyForecastSeries',
      'getWeeklyGoalProgress',
      'getWeightedForecast',
      'listActionItems',
      'listDuplicateRegistrationGroups',
      'listPartnerLeaderboard',
      'listPendingRegistrations',
      'listQuarterOpportunities',
      'listRecentRegistrations',
      'listScopedOpportunities',
      'listUnconvertedRegistrations',
      'listWeeklyClassificationMeetings',
    ]);
  });

  it('rejects every method at the type level when the scope is missing or malformed', () => {
    const provider: DataProvider = new MockDataProvider(makeProviderBook());

    // Each case is wrapped in a lambda that is never invoked: the point is
    // the compile error, and an executed scope-less call belongs to the
    // fail-closed runtime test below.
    // @ts-expect-error the access scope is required, not optional
    void (() => provider.getPartnerRoster({}));
    // @ts-expect-error the access scope is required, not optional
    void (() => provider.getForecastSummary({ quarter }));
    // @ts-expect-error the access scope is required, not optional
    void (() => provider.getPartnerDirectory());
    // @ts-expect-error Action Center requires the access scope first
    void (() => provider.getActionCenterSummary({ policy: DEFAULT_ACTION_POLICY }));
    // @ts-expect-error a partner scope must name the selected partner
    const missingPartner: DemoAccessScope = { audience: 'partner' };
    void (() => provider.listActionItems(missingPartner, { policy: DEFAULT_ACTION_POLICY }, {}));
    // @ts-expect-error the audience is a closed set; there is no guest audience
    void (() => provider.getPartnerRoster({ audience: 'guest' }, {}));
    // @ts-expect-error a partner-audience scope must name its partner
    void (() => provider.getForecastSummary({ audience: 'partner' }, { quarter }));
    // @ts-expect-error an internal scope cannot claim a partner id
    const badScope: DemoAccessScope = { audience: 'internal', partnerId: 'partner-1' };
    void badScope;
    // A well-formed scope type-checks: the constant itself is the proof.
    const scope: DemoAccessScope = INTERNAL_DEMO_SCOPE;
    expect(scope.audience).toBe('internal');
  });

  it('fails closed at runtime: a scope-less call rejects rather than answering unscoped', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const calls = unscopedCalls(provider);
    expect(calls).toHaveLength(DATA_PROVIDER_METHODS.length);
    for (const [index, call] of calls.entries()) {
      await expect(call(), DATA_PROVIDER_METHODS[index]).rejects.toThrow();
    }
  });

  it('accepts a partner scope on every method without rejecting', async () => {
    const provider = new MockDataProvider(makeProviderBook());
    const scope: DemoAccessScope = { audience: 'partner', partnerId: 'partner-1' };
    const results = await Promise.all([
      provider.getForecastSummary(scope, { quarter }),
      provider.getWeightedForecast(scope, { quarter }),
      provider.getForecastQuality(scope, { quarter }, 3),
      provider.getManagerForecastGroups(scope, { quarter }),
      provider.getWeeklyForecastSeries(scope, { quarter }),
      provider.listQuarterOpportunities(scope, { quarter }, { limit: 5 }),
      provider.getPartnerDirectory(scope),
      provider.getPerformanceSummary(scope, { phase: 'q3' }),
      provider.getRegistrationFunnel(scope, { phase: 'q3' }),
      provider.getStageBreakdown(scope, { phase: 'q3' }),
      provider.getTypeBreakdown(scope, { phase: 'q3' }),
      provider.getQuarterlyRevenueTrend(scope, {}),
      provider.getWeeklyActivitySeries(scope, {}),
      provider.getWeeklyGoalProgress(scope, {}),
      provider.getRegistrationOpsSummary(scope, {}),
      provider.getTopPartnerLeaders(scope, { phase: 'q3' }),
      provider.listPartnerLeaderboard(scope, { phase: 'q3' }, { limit: 5 }),
      provider.getManagerDirectory(scope),
      provider.getPartnerRoster(scope, {}),
      provider.getPartnerCertification(scope, {}),
      provider.listScopedOpportunities(scope, { phase: 'q3' }, { limit: 5 }),
      provider.listPendingRegistrations(scope, {}, { limit: 5 }),
      provider.listUnconvertedRegistrations(scope, {}, { limit: 5 }),
      provider.listDuplicateRegistrationGroups(scope, {}, { limit: 5 }),
      provider.listRecentRegistrations(scope, {}, { limit: 5 }),
      provider.getTeamRoster(scope, {}),
      provider.getRegistrationSlaAlerts(scope, {}, 8),
      provider.listWeeklyClassificationMeetings(scope, { partnerManagerId: 'pm-1' }, { limit: 5 }),
      provider.getActionCenterSummary(scope, { policy: DEFAULT_ACTION_POLICY }),
      provider.listActionItems(scope, { policy: DEFAULT_ACTION_POLICY }, {}),
    ]);
    expect(results).toHaveLength(DATA_PROVIDER_METHODS.length);
  });
});
