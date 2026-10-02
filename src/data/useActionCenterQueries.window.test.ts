import { act, renderHook, waitFor as waitForState } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ACTION_POLICY } from '../lib/actionPolicy';
import { makeOpportunity, makePartner, makeProviderBook, makeTeamUser } from '../test/fixtures';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import type { ActionCenterScope } from './actionCenter';
import { MockDataProvider } from './mock/MockDataProvider';
import { MAX_PAGE_LIMIT } from './pagination';
import { NO_SESSION_EDITS } from './sessionEdits';
import { useActionCenterQueries } from './useActionCenterQueries';

const INITIAL_SCOPE: ActionCenterScope = {
  policy: DEFAULT_ACTION_POLICY,
  edits: NO_SESSION_EDITS,
};
// These deterministic in-process requests settle without simulated latency.
const waitFor = <T>(assertion: () => T) => waitForState(assertion, { interval: 5 });
const BOOK = makeProviderBook({
  opportunities: Array.from({ length: 160 }, (_, index) =>
    makeOpportunity({
      id: `window-${String(index).padStart(3, '0')}`,
      forecastedRevenue: 500_000 + index * 1_000,
    }),
  ),
  registrations: [],
  activities: [],
  teamUsers: [makeTeamUser()],
});

type ActionAnswer = Awaited<ReturnType<MockDataProvider['listActionItems']>>;
type HookProps = {
  provider: MockDataProvider;
  access: DemoAccessScope;
  scope: ActionCenterScope;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup() {
  const provider = new MockDataProvider(BOOK);
  const list = vi.spyOn(provider, 'listActionItems');
  const summary = vi.spyOn(provider, 'getActionCenterSummary');
  const hook = renderHook((props: HookProps) => useActionCenterQueries(props), {
    initialProps: { provider, access: INTERNAL_DEMO_SCOPE, scope: INITIAL_SCOPE } as HookProps,
  });
  return { ...hook, provider, list, summary };
}

async function loadWindow(result: ReturnType<typeof setup>['result'], count = 125) {
  await waitFor(() => expect(result.current.items.rows).toHaveLength(25));
  for (let loaded = 50; loaded <= count; loaded += 25) {
    act(() => result.current.items.loadMore());
    await waitFor(() => expect(result.current.items.rows).toHaveLength(loaded));
  }
}

async function expectedRows(scope: ActionCenterScope, access = INTERNAL_DEMO_SCOPE) {
  const provider = new MockDataProvider(BOOK);
  const first = await provider.listActionItems(access, scope, { limit: MAX_PAGE_LIMIT });
  if (first.data.nextCursor === undefined) return first.data.rows;
  const rest = await provider.listActionItems(access, scope, {
    cursor: first.data.nextCursor,
    limit: MAX_PAGE_LIMIT,
  });
  return [...first.data.rows, ...rest.data.rows];
}

function rerenderScope(hook: ReturnType<typeof setup>, scope: ActionCenterScope) {
  hook.rerender({ provider: hook.provider, access: INTERNAL_DEMO_SCOPE, scope });
}

const OVERLAYS: [string, ActionCenterScope][] = [
  [
    'revenue',
    {
      ...INITIAL_SCOPE,
      edits: { ...NO_SESSION_EDITS, revenueOverrides: { 'window-000': 2_000_000 } },
    },
  ],
  [
    'next step',
    {
      ...INITIAL_SCOPE,
      edits: { ...NO_SESSION_EDITS, nextSteps: { 'window-159': 'Confirm the plan' } },
    },
  ],
  [
    'note',
    {
      ...INITIAL_SCOPE,
      edits: { ...NO_SESSION_EDITS, notes: { 'window-159': 'Session-only note' } },
    },
  ],
];

describe('Action Center loaded-window invalidation', () => {
  it.each(OVERLAYS)(
    'refreshes %s edits through a fresh bounded chain, not page one',
    async (_, scope) => {
      const hook = setup();
      await loadWindow(hook.result);
      const oldRows = hook.result.current.items.rows;
      const oldContinuation = (await hook.list.mock.results[4].value).data.nextCursor;
      const expected = await expectedRows(scope);
      rerenderScope(hook, scope);
      expect(hook.result.current.items.rows).toEqual(oldRows);
      expect(hook.result.current.items.refreshing).toBe(true);
      await waitFor(() => expect(hook.result.current.items.refreshing).toBe(false));
      expect(hook.result.current.items.rows).toEqual(expected.slice(0, 125));
      expect(hook.result.current.items.totalCount).toBe(160);
      expect(hook.summary.mock.calls).toHaveLength(2);
      expect(hook.result.current.summary.data?.totalCount).toBe(160);
      expect(hook.list.mock.calls.slice(5).map((call) => call[2].limit)).toEqual([100, 25]);
      expect(hook.list.mock.calls[5][2]).toEqual({ limit: MAX_PAGE_LIMIT });
      const first = await hook.list.mock.results[5].value;
      const last = await hook.list.mock.results[6].value;
      expect(hook.list.mock.calls[6][2].cursor).toBe(first.data.nextCursor);
      act(() => hook.result.current.items.loadMore());
      await waitFor(() => expect(hook.result.current.items.rows).toHaveLength(150));
      expect(hook.list.mock.calls[7][2]).toEqual({ cursor: last.data.nextCursor, limit: 25 });
      if (scope.edits?.revenueOverrides['window-000'] || scope.edits?.nextSteps['window-159'])
        expect(last.data.nextCursor).not.toBe(oldContinuation);
      expect(hook.result.current.items.rows).toEqual(expected.slice(0, 150));
      expect(new Set(hook.result.current.items.rows.map((row) => row.id)).size).toBe(150);
      if (scope.edits?.revenueOverrides['window-000']) {
        expect(hook.result.current.items.rows[0]).toMatchObject({
          entityId: 'window-000',
          exposure: 2_000_000,
        });
      }
      if (scope.edits?.nextSteps['window-159']) {
        expect(
          hook.result.current.items.rows.find((row) => row.entityId === 'window-159')?.reasons,
        ).toHaveLength(1);
      }
      const calls = [hook.list.mock.calls.length, hook.summary.mock.calls.length];
      rerenderScope(hook, {
        ...scope,
        policy: { ...scope.policy },
        edits: { ...scope.edits!, forecastCalls: { 'window-000': 'commit' } },
      });
      expect([hook.list.mock.calls.length, hook.summary.mock.calls.length]).toEqual(calls);
    },
  );

  it('shrinks the retained window to the new total when effective edits remove actions', async () => {
    const hook = setup();
    await loadWindow(hook.result);
    const removedIds = BOOK.opportunities.slice(0, 60).map((row) => row.id);
    const scope: ActionCenterScope = {
      ...INITIAL_SCOPE,
      edits: {
        ...NO_SESSION_EDITS,
        revenueOverrides: Object.fromEntries(removedIds.map((id) => [id, 0])),
        nextSteps: Object.fromEntries(removedIds.map((id) => [id, 'Complete'])),
      },
    };
    const expected = await expectedRows(scope);
    expect(expected).toHaveLength(100);
    rerenderScope(hook, scope);
    await waitFor(() => expect(hook.result.current.items.refreshing).toBe(false));
    expect(hook.result.current.items.rows).toEqual(expected);
    expect(hook.result.current.items.hasMore).toBe(false);
    expect(hook.result.current.items.totalCount).toBe(100);
    expect(hook.result.current.summary.data?.totalCount).toBe(100);
    expect(hook.list.mock.calls.slice(5).map((call) => call[2])).toEqual([{ limit: 100 }]);
    act(() => hook.result.current.items.loadMore());
    expect(hook.list).toHaveBeenCalledTimes(6);
  });

  it.each(OVERLAYS)(
    'retains stale rows after failed %s refresh and fences loadMore until retry',
    async (_, scope) => {
      const hook = setup();
      await loadWindow(hook.result);
      const rows = hook.result.current.items.rows;
      const original = MockDataProvider.prototype.listActionItems.bind(hook.provider);
      // Failure on the second chunk must not publish a partial new window.
      hook.list
        .mockImplementationOnce(original)
        .mockRejectedValueOnce(new Error('private failure'));
      rerenderScope(hook, scope);
      expect(hook.result.current.items.rows).toEqual(rows);
      await waitFor(() => expect(hook.result.current.items.error).not.toBeNull());
      expect(hook.result.current.items.rows).toEqual(rows);
      expect(hook.result.current.items.refreshing).toBe(false);
      expect(hook.result.current.items.error).toBe('Failed to load the action items');
      const calls = hook.list.mock.calls.length;
      act(() => {
        hook.result.current.items.loadMore();
        hook.result.current.items.loadMore();
      });
      expect(hook.list).toHaveBeenCalledTimes(calls);
      act(() => hook.result.current.items.retry());
      await waitFor(() => expect(hook.result.current.items.error).toBeNull());
      await waitFor(() => expect(hook.result.current.items.refreshing).toBe(false));
      expect(hook.list.mock.calls.slice(calls).map((call) => call[2].limit)).toEqual([100, 25]);
      expect(hook.list.mock.calls[calls][2].cursor).toBeUndefined();
      const first = await hook.list.mock.results[calls].value;
      const last = await hook.list.mock.results[calls + 1].value;
      expect(hook.list.mock.calls[calls + 1][2].cursor).toBe(first.data.nextCursor);
      const expected = await expectedRows(scope);
      expect(hook.result.current.items.rows).toEqual(expected.slice(0, 125));
      act(() => hook.result.current.items.loadMore());
      await waitFor(() => expect(hook.result.current.items.rows).toHaveLength(150));
      expect(hook.list.mock.calls.at(-1)?.[2]).toEqual({
        cursor: last.data.nextCursor,
        limit: 25,
      });
      expect(hook.result.current.items.rows).toEqual(expected.slice(0, 150));
    },
  );

  it.each(OVERLAYS)('ignores a late page superseded by a %s window refresh', async (_, scope) => {
    const hook = setup();
    await loadWindow(hook.result);
    const rows = hook.result.current.items.rows;
    const pending = deferred<ActionAnswer>();
    const continuation = (await hook.list.mock.results[4].value).data.nextCursor;
    // Obtain a genuine old-scope continuation answer from its issuing provider.
    const original = MockDataProvider.prototype.listActionItems.bind(hook.provider);
    const oldPage = await original(INTERNAL_DEMO_SCOPE, INITIAL_SCOPE, {
      cursor: continuation,
      limit: 25,
    });
    expect(oldPage.data.rows).toHaveLength(25);
    hook.list.mockImplementationOnce(() => pending.promise);
    act(() => hook.result.current.items.loadMore());
    const signal = hook.list.mock.calls[5][3]?.signal;
    rerenderScope(hook, scope);
    expect(signal?.aborted).toBe(true);
    expect(hook.result.current.items.rows).toEqual(rows);
    expect(hook.result.current.items.loadingMore).toBe(false);
    act(() => hook.result.current.items.loadMore());
    await waitFor(() => expect(hook.result.current.items.refreshing).toBe(false));
    const expected = await expectedRows(scope);
    expect(hook.result.current.items.rows).toEqual(expected.slice(0, 125));
    await act(async () => pending.resolve(oldPage));
    expect(hook.result.current.items.rows).toEqual(expected.slice(0, 125));
    expect(hook.list).toHaveBeenCalledTimes(8);
    act(() => hook.result.current.items.loadMore());
    await waitFor(() => expect(hook.result.current.items.rows).toHaveLength(150));
    expect(hook.result.current.items.rows).toEqual(expected.slice(0, 150));
    expect(new Set(hook.result.current.items.rows.map((row) => row.id)).size).toBe(150);
  });

  const RESET_SCOPES: [string, ActionCenterScope][] = [
    ['policy', { ...INITIAL_SCOPE, policy: { ...DEFAULT_ACTION_POLICY, staleCalendarDays: 15 } }],
    ['category filter', { ...INITIAL_SCOPE, filters: { categories: ['missing-next-step'] } }],
    ['owner filter', { ...INITIAL_SCOPE, filters: { ownerId: 'user-1' } }],
    ['severity filter', { ...INITIAL_SCOPE, filters: { severity: 'high' } }],
    [
      'roster override',
      { ...INITIAL_SCOPE, roster: { overrides: { 'user-1': { status: 'suspended' } } } },
    ],
    ['roster addition', { ...INITIAL_SCOPE, roster: { added: [makeTeamUser({ id: 'user-2' })] } }],
    [
      'classification',
      {
        ...INITIAL_SCOPE,
        classifications: { 'meeting-1': { partnerId: 'partner-1', type: 'deal-support' } },
      },
    ],
    ['prospect', { ...INITIAL_SCOPE, prospects: [makePartner({ id: 'prospect-1' })] }],
  ];

  it.each(RESET_SCOPES)('resets to one page on a %s membership change', async (_, scope) => {
    const hook = setup();
    await loadWindow(hook.result, 50);
    rerenderScope(hook, scope);
    expect(hook.result.current.items.rows).toEqual([]);
    expect(hook.result.current.items.loading).toBe(true);
    await waitFor(() => expect(hook.result.current.items.loading).toBe(false));
    const expected = await expectedRows(scope);
    expect(hook.result.current.items.rows).toEqual(expected.slice(0, 25));
    expect(hook.list.mock.calls.slice(2).map((call) => call[2])).toEqual([{ limit: 25 }]);
  });

  it.each(['provider', 'access'] as const)('resets the window on %s changes', async (change) => {
    const hook = setup();
    await loadWindow(hook.result, 50);
    const provider = change === 'provider' ? new MockDataProvider(BOOK) : hook.provider;
    const access: DemoAccessScope =
      change === 'access' ? { audience: 'partner', partnerId: 'partner-1' } : INTERNAL_DEMO_SCOPE;
    const list = change === 'provider' ? vi.spyOn(provider, 'listActionItems') : hook.list;
    const before = list.mock.calls.length;
    hook.rerender({ provider, access, scope: INITIAL_SCOPE });
    expect(hook.result.current.items.rows).toEqual([]);
    await waitFor(() => expect(hook.result.current.items.rows).toHaveLength(25));
    expect(list.mock.calls.slice(before).map((call) => call[2])).toEqual([{ limit: 25 }]);
    expect(hook.result.current.items.rows).toEqual(
      (await expectedRows(INITIAL_SCOPE, access)).slice(0, 25),
    );
    if (change === 'access')
      expect(hook.result.current.items.rows.every((row) => row.owner === undefined)).toBe(true);
  });
});
