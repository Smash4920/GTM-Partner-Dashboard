import { describe, expect, it } from 'vitest';
import { makeProviderBook } from '../test/fixtures';
import { CURRENT_FISCAL_QUARTER } from './constants';
import type { DataProvider } from './DataProvider';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { SimulatedRemoteProvider } from './mock/SimulatedRemoteProvider';
import { TracedDataProvider } from './TracedDataProvider';
import { INTERNAL_DEMO_SCOPE } from './accessScope';

/**
 * Wrapper conformance sweep: every method on the contract must cross both
 * seam wrappers — the tracing decorator and the simulated remote — without
 * changing the answer. The cancellation sweep in MockDataProvider.test.ts
 * owns the failure side of this table; this one owns the success side, so a
 * wrapper that drops, reorders, or rewrites an answer (or a method a wrapper
 * forgot to forward) fails here rather than in a route.
 *
 * The simulated remote stamps its own provider identity into the metadata —
 * that rewrite is its job and is pinned separately — so the comparison is on
 * the answer data, which must arrive byte-identical.
 */
const quarter = CURRENT_FISCAL_QUARTER;

/** Every contract method, invoked with a valid minimal argument list. */
const CALLS: Record<string, (provider: DataProvider) => Promise<unknown>> = {
  listPartnerManagers: (p) => p.listPartnerManagers(INTERNAL_DEMO_SCOPE),
  listPartners: (p) => p.listPartners(INTERNAL_DEMO_SCOPE),
  listRegistrations: (p) => p.listRegistrations(INTERNAL_DEMO_SCOPE),
  listOpportunities: (p) => p.listOpportunities(INTERNAL_DEMO_SCOPE),
  getTargets: (p) => p.getTargets(INTERNAL_DEMO_SCOPE),
  listActivities: (p) => p.listActivities(INTERNAL_DEMO_SCOPE),
  listCertifications: (p) => p.listCertifications(INTERNAL_DEMO_SCOPE),
  listTeamUsers: (p) => p.listTeamUsers(INTERNAL_DEMO_SCOPE),
  getForecastSummary: (p) => p.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter }),
  getWeightedForecast: (p) => p.getWeightedForecast(INTERNAL_DEMO_SCOPE, { quarter }),
  getForecastQuality: (p) => p.getForecastQuality(INTERNAL_DEMO_SCOPE, { quarter }, 3),
  getManagerForecastGroups: (p) => p.getManagerForecastGroups(INTERNAL_DEMO_SCOPE, { quarter }),
  getWeeklyForecastSeries: (p) => p.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, { quarter }),
  listQuarterOpportunities: (p) =>
    p.listQuarterOpportunities(INTERNAL_DEMO_SCOPE, { quarter }, { limit: 5 }),
  getPartnerDirectory: (p) => p.getPartnerDirectory(INTERNAL_DEMO_SCOPE),
  getPerformanceSummary: (p) => p.getPerformanceSummary(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
  getRegistrationFunnel: (p) => p.getRegistrationFunnel(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
  getStageBreakdown: (p) => p.getStageBreakdown(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
  getTypeBreakdown: (p) => p.getTypeBreakdown(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
  getQuarterlyRevenueTrend: (p) => p.getQuarterlyRevenueTrend(INTERNAL_DEMO_SCOPE, {}),
  getWeeklyActivitySeries: (p) => p.getWeeklyActivitySeries(INTERNAL_DEMO_SCOPE, {}),
  getWeeklyGoalProgress: (p) => p.getWeeklyGoalProgress(INTERNAL_DEMO_SCOPE, {}),
  getRegistrationOpsSummary: (p) => p.getRegistrationOpsSummary(INTERNAL_DEMO_SCOPE, {}),
  getPartnerLeaderboard: (p) => p.getPartnerLeaderboard(INTERNAL_DEMO_SCOPE, { phase: 'q3' }),
  getManagerDirectory: (p) => p.getManagerDirectory(INTERNAL_DEMO_SCOPE),
  getPartnerRoster: (p) => p.getPartnerRoster(INTERNAL_DEMO_SCOPE, {}),
  getPartnerCertification: (p) => p.getPartnerCertification(INTERNAL_DEMO_SCOPE, {}),
  listScopedOpportunities: (p) =>
    p.listScopedOpportunities(INTERNAL_DEMO_SCOPE, { phase: 'q3' }, { limit: 5 }),
  listPendingRegistrations: (p) => p.listPendingRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 5 }),
  listUnconvertedRegistrations: (p) =>
    p.listUnconvertedRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 5 }),
  listDuplicateRegistrationGroups: (p) =>
    p.listDuplicateRegistrationGroups(INTERNAL_DEMO_SCOPE, {}, { limit: 5 }),
  listRecentRegistrations: (p) => p.listRecentRegistrations(INTERNAL_DEMO_SCOPE, {}, { limit: 5 }),
  getTeamRoster: (p) => p.getTeamRoster(INTERNAL_DEMO_SCOPE, {}),
  getRegistrationSlaAlerts: (p) => p.getRegistrationSlaAlerts(INTERNAL_DEMO_SCOPE, {}, 8),
  listWeeklyClassificationMeetings: (p) =>
    p.listWeeklyClassificationMeetings(INTERNAL_DEMO_SCOPE, { partnerManagerId: 'pm-1' }, {
      limit: 5,
    }),
};

// The table and the contract inventory must stay in lockstep: a method added
// to one but not the other fails here, by design.
expect(Object.keys(CALLS).sort()).toEqual([...DATA_PROVIDER_METHODS].sort());

/** The answer payload each method returns from the plain mock. */
async function referenceAnswers(inner: DataProvider): Promise<Record<string, unknown>> {
  const answers: Record<string, unknown> = {};
  for (const [method, call] of Object.entries(CALLS)) {
    const result = (await call(inner)) as { data: unknown } | unknown[];
    // Legacy methods answer with bare collections; scoped ones envelope data.
    answers[method] = Array.isArray(result) ? result : result.data;
  }
  return answers;
}

describe('provider wrappers forward the whole contract untouched', () => {
  it('TracedDataProvider returns every method’s answer unchanged', async () => {
    const inner = new MockDataProvider(makeProviderBook());
    const expected = await referenceAnswers(inner);
    const traced = new TracedDataProvider(inner);

    for (const [method, call] of Object.entries(CALLS)) {
      const result = (await call(traced)) as { data: unknown } | unknown[];
      const payload = Array.isArray(result) ? result : result.data;
      expect(payload, method).toEqual(expected[method]);
    }
  });

  it('SimulatedRemoteProvider returns every method’s answer data unchanged', async () => {
    const inner = new MockDataProvider(makeProviderBook());
    const expected = await referenceAnswers(inner);
    const remote = new SimulatedRemoteProvider(inner, {
      latencyMs: 0,
      failureRate: 0,
      providerId: 'remote',
    });

    for (const [method, call] of Object.entries(CALLS)) {
      const result = (await call(remote)) as
        | { data: unknown; meta: { providerId: string } }
        | unknown[];
      // The legacy side answers with bare collections — no envelope to stamp.
      if (!Array.isArray(result)) {
        expect(result.data, method).toEqual(expected[method]);
        // The wire identity rewrite is the one sanctioned difference.
        expect(result.meta.providerId, method).toBe('remote');
      } else {
        expect(result, method).toEqual(expected[method]);
      }
    }
  });
});
