import { describe, expect, it } from 'vitest';
import { DEFAULT_ACTION_POLICY, deriveActionItems } from '../../lib/actionRules';
import {
  makeMeeting,
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTeamUser,
} from '../../test/fixtures';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import { ACTION_CATEGORIES, actionCenterScopeKey } from '../actionCenter';
import type { ActionCenterScope } from '../actionCenter';
import { SNAPSHOT_DATE } from '../constants';
import { NO_SESSION_EDITS } from '../sessionEdits';
import type { ActionItem, ActionPolicy } from '../types';
import { latestPriorCloseDates } from './book';
import { createSimulatedRemoteProvider } from './createSimulatedRemoteProvider';
import { generateDashboardData } from './generate';
import { MockDataProvider } from './MockDataProvider';

const scope: ActionCenterScope = { policy: DEFAULT_ACTION_POLICY };
const fixture = makeProviderBook({
  partners: [makePartner(), makePartner({ id: 'partner-2', partnerManagerId: 'pm-2' })],
  teamUsers: [
    makeTeamUser({ id: 'manager-z' }),
    makeTeamUser({ id: 'manager-a' }),
    makeTeamUser({ id: 'lead', role: 'partnership-lead', partnerManagerId: undefined }),
    makeTeamUser({ id: 'desk', role: 'deal-desk-ops', partnerManagerId: undefined }),
  ],
  opportunities: [
    makeOpportunity({ id: 'merged', forecastedRevenue: 500_000 }),
    makeOpportunity({ id: 'step', partnerId: 'partner-2' }),
    makeOpportunity({ id: 'hidden', oppType: 'sell-to', forecastedRevenue: 700_000 }),
  ],
  registrations: [
    makeRegistration({ id: 'breach', accountName: 'Unique', submittedAt: '2026-09-01' }),
    makeRegistration({ id: 'conflict', accountName: 'Conflict', submittedAt: '2026-09-01' }),
    makeRegistration({
      id: 'other-conflict',
      partnerId: 'partner-2',
      accountName: 'Conflict',
      submittedAt: '2026-09-01',
    }),
  ],
  activities: [],
  snapshots: [
    {
      opportunityId: 'merged',
      takenAt: '2026-09-14',
      expectedCloseDate: '2026-10-01',
      forecastedRevenue: 500_000,
      forecastCategory: 'pipeline',
      stage: 'scope',
    },
  ],
});

async function walk(provider: MockDataProvider, access: DemoAccessScope, input = scope) {
  const rows: ActionItem[] = [];
  let cursor: string | undefined;
  do {
    const result = await provider.listActionItems(access, input, { cursor });
    expect(result.data.rows.length).toBeLessThanOrEqual(25);
    rows.push(...result.data.rows);
    cursor = result.data.nextCursor;
  } while (cursor !== undefined);
  return rows;
}

describe('Action Center provider conformance', () => {
  it('counts unique filtered entities across the full result and preserves merged reasons (VAL-ACT-010)', async () => {
    const provider = new MockDataProvider(fixture);
    const filtered: ActionCenterScope = {
      ...scope,
      filters: {
        categories: ['close-date-slip', 'registration-sla'],
        ownerId: 'manager-a',
        severity: 'high',
      },
    };
    const summary = await provider.getActionCenterSummary(INTERNAL_DEMO_SCOPE, filtered);
    expect(summary.data).toEqual({
      totalCount: 1,
      categoryCounts: {
        'stale-high-value': 1,
        'missing-next-step': 1,
        'close-date-slip': 1,
        'registration-sla': 0,
        'partner-health': 0,
      },
    });
    const page = await provider.listActionItems(INTERNAL_DEMO_SCOPE, filtered, {});
    expect(page.data.rows.map((item) => item.id)).toEqual(['opportunity:merged']);
    expect(page.data.rows[0]?.reasons.map((reason) => reason.category)).toEqual([
      'stale-high-value',
      'missing-next-step',
      'close-date-slip',
    ]);
    expect(page.data.rows[0]?.owner).toEqual({ userId: 'manager-a', basis: 'manager' });
    const union = await walk(provider, INTERNAL_DEMO_SCOPE, {
      ...scope,
      filters: { categories: ['missing-next-step', 'registration-sla'] },
    });
    expect(new Set(union.map((item) => item.id)).size).toBe(union.length);
    expect(union.map((item) => item.id)).toEqual([
      'registration:breach',
      'registration:conflict',
      'registration:other-conflict',
      'opportunity:hidden',
      'opportunity:merged',
      'opportunity:step',
    ]);
  });

  it('walks every default page in exact domain order with full-set summary counts', async () => {
    const book = generateDashboardData();
    const provider = new MockDataProvider(book);
    const expected = deriveActionItems({
      ...book,
      asOf: SNAPSHOT_DATE.toISOString(),
      policy: DEFAULT_ACTION_POLICY,
      priorCloseDates: latestPriorCloseDates(book.snapshots, SNAPSHOT_DATE.toISOString()),
    });
    const first = await provider.listActionItems(INTERNAL_DEMO_SCOPE, scope, {});
    expect(first.data.rows).toHaveLength(25);
    expect(first.data.nextCursor).toBeDefined();
    const rows = await walk(provider, INTERNAL_DEMO_SCOPE);
    expect(rows.map((row) => row.id)).toEqual(expected.map((row) => row.id));
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    const summary = await provider.getActionCenterSummary(INTERNAL_DEMO_SCOPE, scope);
    expect(summary.data.totalCount).toBe(expected.length);
    for (const category of ACTION_CATEGORIES) {
      expect(summary.data.categoryCounts[category]).toBe(
        expected.filter((row) => row.reasons.some((reason) => reason.category === category)).length,
      );
    }
  });

  it('scopes before eligibility, overlays, exposure, routing and metadata', async () => {
    const provider = new MockDataProvider(fixture);
    const access: DemoAccessScope = { audience: 'partner', partnerId: 'partner-1' };
    const input: ActionCenterScope = {
      ...scope,
      edits: {
        ...NO_SESSION_EDITS,
        revenueOverrides: { merged: 900_000, hidden: 1_000_000 },
        nextSteps: { merged: 'Confirm plan', step: '' },
      },
      roster: { added: [makeTeamUser({ id: 'leaky' })] },
    };
    const rows = await walk(provider, access, input);
    expect(rows.map((row) => row.id)).toEqual(['registration:breach', 'opportunity:merged']);
    expect(rows.every((row) => row.partnerId === 'partner-1' && row.owner === undefined)).toBe(
      true,
    );
    expect(rows[1]?.exposure).toBe(900_000);
    expect(rows[1]?.reasons.map((reason) => reason.category)).toEqual([
      'stale-high-value',
      'close-date-slip',
    ]);
    const result = await provider.getActionCenterSummary(access, input);
    expect(result.meta).toMatchObject({
      providerId: 'local',
      asOf: SNAPSHOT_DATE.toISOString(),
      completeness: 'complete',
      warnings: [],
    });
    expect(
      result.meta.lineage.find((line) => line.source === 'session-edits')?.description,
    ).toContain('2 session edits');
    const serialized = JSON.stringify([result, rows]);
    for (const forbidden of [
      'takenAt',
      '"snapshots":',
      'forecastCategory',
      'leaky',
      'manager-a',
      'partner-2',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(await walk(provider, { audience: 'internal', partnerManagerId: 'missing' })).toEqual([]);
    expect(await walk(provider, { audience: 'partner', partnerId: 'missing' })).toEqual([]);
  });

  it('uses session-only roster status and fallback roles without roster prose', async () => {
    const provider = new MockDataProvider(fixture);
    const paused: ActionCenterScope = {
      ...scope,
      roster: {
        overrides: { 'manager-a': { status: 'suspended' }, 'manager-z': { status: 'invited' } },
      },
    };
    const rows = await walk(provider, INTERNAL_DEMO_SCOPE, paused);
    expect(rows.find((row) => row.id === 'opportunity:merged')?.owner).toEqual({
      userId: 'lead',
      basis: 'partnership-lead',
    });
    expect(rows.find((row) => row.id === 'registration:breach')?.owner).toEqual({
      userId: 'desk',
      basis: 'deal-desk',
    });
    const unowned = await walk(provider, INTERNAL_DEMO_SCOPE, {
      ...paused,
      roster: {
        overrides: Object.fromEntries(
          fixture.teamUsers.map((user) => [user.id, { status: 'suspended' }]),
        ),
      },
    });
    expect(unowned.every((row) => row.owner?.basis === 'unowned')).toBe(true);
    expect(
      await walk(provider, INTERNAL_DEMO_SCOPE, {
        ...scope,
        filters: { ownerId: 'unowned' },
        roster: {
          overrides: Object.fromEntries(
            fixture.teamUsers.map((user) => [user.id, { status: 'suspended' }]),
          ),
        },
      }),
    ).toEqual(unowned);
    expect(
      await walk(provider, INTERNAL_DEMO_SCOPE, { ...scope, filters: { ownerId: 'unowned' } }),
    ).toEqual([]);
  });

  it('reassigns classified activity before manager scoping including session prospects', async () => {
    const book = makeProviderBook({
      opportunities: [makeOpportunity({ createdAt: '2026-08-10', nextStep: 'Ready' })],
      registrations: [],
      snapshots: [],
      activities: [makeMeeting({ occurredAt: '2026-08-10' })],
    });
    const provider = new MockDataProvider(book);
    const input: ActionCenterScope = {
      ...scope,
      classifications: { 'meeting-1': { partnerId: 'prospect', type: 'discovery' } },
      prospects: [makePartner({ id: 'prospect', partnerManagerId: 'pm-2', prospect: true })],
    };
    // Before reassignment the prior meeting and opportunity are both deteriorating.
    expect(
      (await walk(provider, { audience: 'internal', partnerManagerId: 'pm-1' })).some(
        (row) => row.id === 'partner:partner-1',
      ),
    ).toBe(true);
    expect(await walk(provider, { audience: 'internal', partnerManagerId: 'pm-1' }, input)).toEqual(
      [],
    );
    const oneDriver = { ...input, policy: { ...scope.policy, minimumDeterioratingDrivers: 1 } };
    const newManager = await walk(
      provider,
      { audience: 'internal', partnerManagerId: 'pm-2' },
      oneDriver,
    );
    expect(newManager.map((row) => row.id)).toEqual(['partner:prospect']);
    expect(newManager[0]?.reasons[0]?.evidence).toMatchObject({
      drivers: [{ driver: 'partner-meetings', prior: 1, current: 0 }],
    });
  });

  it('clears next steps explicitly and applies edited revenue before eligibility once', async () => {
    const provider = new MockDataProvider(
      makeProviderBook({
        opportunities: [
          makeOpportunity({
            nextStep: 'Existing',
            forecastedRevenue: 399_999,
            expectedCloseDate: '2027-01-01',
          }),
        ],
        registrations: [],
        activities: [],
      }),
    );
    expect(await walk(provider, INTERNAL_DEMO_SCOPE)).toEqual([]);
    const rows = await walk(provider, INTERNAL_DEMO_SCOPE, {
      ...scope,
      edits: {
        ...NO_SESSION_EDITS,
        revenueOverrides: { 'opp-1': 400_000 },
        nextSteps: { 'opp-1': '' },
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.exposure).toBe(400_000);
    expect(rows[0]?.reasons.map((reason) => reason.category)).toEqual([
      'stale-high-value',
      'missing-next-step',
    ]);
  });

  it('binds cursor identity to every relevant scope value but not presentation edits', async () => {
    const provider = new MockDataProvider(generateDashboardData());
    const first = await provider.listActionItems(INTERNAL_DEMO_SCOPE, scope, { limit: 1 });
    const page = { cursor: first.data.nextCursor, limit: 1 };
    const changes: ActionCenterScope[] = [
      ...Object.keys(DEFAULT_ACTION_POLICY).map((field) => ({
        policy: { ...scope.policy, [field]: scope.policy[field as keyof ActionPolicy] + 1 },
      })),
      { ...scope, filters: { categories: ['missing-next-step'] } },
      { ...scope, filters: { ownerId: 'owner' } },
      { ...scope, filters: { severity: 'critical' } },
      { ...scope, edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'opp-1': 500_000 } } },
      { ...scope, edits: { ...NO_SESSION_EDITS, nextSteps: { 'opp-1': '' } } },
      { ...scope, roster: { added: [makeTeamUser()] } },
      { ...scope, classifications: { meeting: { partnerId: 'partner-1', type: 'discovery' } } },
      { ...scope, prospects: [makePartner({ id: 'new' })] },
    ];
    for (const changed of changes) {
      await expect(
        provider.listActionItems(INTERNAL_DEMO_SCOPE, changed, page),
      ).rejects.toMatchObject({ code: 'foreign-cursor' });
    }
    await expect(
      provider.listActionItems({ audience: 'partner', partnerId: 'partner-1' }, scope, page),
    ).rejects.toMatchObject({ code: 'foreign-cursor' });
    const presentation = {
      ...scope,
      edits: { ...NO_SESSION_EDITS, notes: { x: 'note' }, forecastCalls: { x: 'commit' as const } },
    };
    expect(actionCenterScopeKey(presentation)).toBe(actionCenterScopeKey(scope));
    await expect(
      provider.listActionItems(INTERNAL_DEMO_SCOPE, presentation, page),
    ).resolves.toBeDefined();
  });

  it('canonicalizes rebuilt map, category, roster and prospect order', () => {
    const left: ActionCenterScope = {
      ...scope,
      filters: { categories: ['missing-next-step', 'close-date-slip'] },
      edits: {
        ...NO_SESSION_EDITS,
        nextSteps: { b: '', a: 'Plan' },
        revenueOverrides: { b: 2, a: 1 },
      },
      prospects: [makePartner({ id: 'b' }), makePartner({ id: 'a' })],
      roster: { added: [makeTeamUser({ id: 'b' }), makeTeamUser({ id: 'a' })] },
      classifications: {
        b: { partnerId: 'b', type: 'discovery' },
        a: { partnerId: 'a', type: 'discovery' },
      },
    };
    const right: ActionCenterScope = {
      ...left,
      policy: { ...DEFAULT_ACTION_POLICY },
      filters: { categories: ['close-date-slip', 'missing-next-step', 'close-date-slip'] },
      edits: {
        ...NO_SESSION_EDITS,
        nextSteps: { a: 'Plan', b: '' },
        revenueOverrides: { a: 1, b: 2 },
      },
      prospects: [...left.prospects!].reverse(),
      roster: { added: [...left.roster!.added!].reverse() },
      classifications: Object.fromEntries(Object.entries(left.classifications!).reverse()),
    };
    expect(actionCenterScopeKey(left)).toBe(actionCenterScopeKey(right));
    expect(actionCenterScopeKey({ ...scope, filters: { categories: [] }, roster: {} })).toBe(
      actionCenterScopeKey(scope),
    );
    expect(
      actionCenterScopeKey({
        ...scope,
        roster: {
          overrides: { user: { name: 'Renamed', email: 'new@example.com', channels: ['email'] } },
        },
      }),
    ).toBe(actionCenterScopeKey(scope));
    expect(
      actionCenterScopeKey({
        ...scope,
        roster: { overrides: { user: { partnerManagerId: undefined } } },
      }),
    ).not.toBe(actionCenterScopeKey(scope));
    expect(
      actionCenterScopeKey({
        ...left,
        prospects: left.prospects?.map((partner) => ({ ...partner, name: 'Renamed' })),
        roster: {
          added: left.roster?.added?.map((user) => ({
            ...user,
            name: 'Renamed',
            email: 'new@example.com',
          })),
        },
      }),
    ).toBe(actionCenterScopeKey(left));
  });

  it('rejects invalid policies without echoing input records', async () => {
    const provider = new MockDataProvider(fixture);
    for (const value of [0, -1, 1.1, NaN, Infinity]) {
      for (const field of Object.keys(DEFAULT_ACTION_POLICY)) {
        const input = { policy: { ...scope.policy, [field]: value } };
        await expect(
          provider.getActionCenterSummary(INTERNAL_DEMO_SCOPE, input),
        ).rejects.toMatchObject({ code: 'invalid-action-policy' });
        await expect(
          provider.listActionItems(INTERNAL_DEMO_SCOPE, input, {}),
        ).rejects.toMatchObject({ code: 'invalid-action-policy' });
      }
    }
    await expect(
      provider.getActionCenterSummary(INTERNAL_DEMO_SCOPE, {
        policy: { ...scope.policy, minimumDeterioratingDrivers: 5 },
      }),
    ).rejects.toMatchObject({ code: 'invalid-action-policy' });
  });

  it('extends the simulated wrapper with one named failure and cancellable context per call', async () => {
    const provider = createSimulatedRemoteProvider(new MockDataProvider(fixture), {
      latencyMs: 0,
      failMethods: { getActionCenterSummary: 1 },
    });
    await expect(provider.getActionCenterSummary(INTERNAL_DEMO_SCOPE, scope)).rejects.toThrow(
      'simulated',
    );
    expect((await provider.listActionItems(INTERNAL_DEMO_SCOPE, scope, {})).meta.providerId).toBe(
      'remote',
    );
    expect(
      (await provider.getActionCenterSummary(INTERNAL_DEMO_SCOPE, scope)).meta.providerId,
    ).toBe('remote');
    const controller = new AbortController();
    controller.abort();
    const context = { signal: controller.signal };
    for (const inner of [provider, new MockDataProvider(fixture)]) {
      await expect(
        inner.getActionCenterSummary(INTERNAL_DEMO_SCOPE, scope, context),
      ).rejects.toMatchObject({ name: 'AbortError' });
      await expect(
        inner.listActionItems(INTERNAL_DEMO_SCOPE, scope, {}, context),
      ).rejects.toMatchObject({ name: 'AbortError' });
    }
  });
});
