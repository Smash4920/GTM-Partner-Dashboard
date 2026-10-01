import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import { MockDataProvider } from './mock/MockDataProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import { DEFAULT_ACTION_POLICY } from '../lib/actionPolicy';
import { useActionCenterQueries } from './useActionCenterQueries';
import type { ActionCenterScope } from './actionCenter';

describe('Action Center scoped queries', () => {
  it('walks coherent 25-row pages, coalesces concurrent cursor calls and resets filters/policy', async () => {
    const provider = new MockDataProvider();
    const summary = vi.spyOn(provider, 'getActionCenterSummary');
    const list = vi.spyOn(provider, 'listActionItems');
    const initialScope = { policy: DEFAULT_ACTION_POLICY };
    const { result, rerender } = renderHook(
      (scope: ActionCenterScope) =>
        useActionCenterQueries({ provider, access: INTERNAL_DEMO_SCOPE, scope }),
      { initialProps: initialScope as ActionCenterScope },
    );
    await waitFor(() => expect(result.current.items.rows).toHaveLength(25));
    expect(result.current.summary.data?.totalCount).toBe(85);
    act(() => {
      result.current.items.loadMore();
      result.current.items.loadMore();
    });
    await waitFor(() => expect(result.current.items.rows).toHaveLength(50));
    expect(list).toHaveBeenCalledTimes(2);
    expect(summary).toHaveBeenCalledTimes(1);
    expect(new Set(result.current.items.rows.map((item) => item.id)).size).toBe(50);
    rerender({ ...initialScope, filters: { categories: ['registration-sla'] } });
    await waitFor(() => expect(result.current.items.totalCount).toBe(17));
    expect(result.current.items.rows).toHaveLength(17);
    rerender({ policy: { ...DEFAULT_ACTION_POLICY, staleCalendarDays: 1 } });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.items.rows).toHaveLength(25));
    expect(list.mock.calls[3]?.[2]).toEqual({ limit: 25 });
  });

  it('ignores presentation-only edits and equal objects, but invalidates relevant overlays once', async () => {
    const provider = new MockDataProvider();
    const summary = vi.spyOn(provider, 'getActionCenterSummary');
    const list = vi.spyOn(provider, 'listActionItems');
    const initialScope = { policy: DEFAULT_ACTION_POLICY, edits: NO_SESSION_EDITS };
    const { result, rerender } = renderHook(
      (scope: ActionCenterScope) =>
        useActionCenterQueries({ provider, access: INTERNAL_DEMO_SCOPE, scope }),
      { initialProps: initialScope as ActionCenterScope },
    );
    await waitFor(() => expect(result.current.items.rows).toHaveLength(25));
    rerender({
      policy: { ...DEFAULT_ACTION_POLICY },
      edits: {
        ...NO_SESSION_EDITS,
        forecastCalls: { 'opp-1': 'commit' },
      },
    });
    expect(summary).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(1);
    rerender({
      ...initialScope,
      edits: { ...NO_SESSION_EDITS, nextSteps: { 'opp-1': 'Confirm' } },
    });
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    const edits = {
      ...NO_SESSION_EDITS,
      nextSteps: { 'opp-1': 'Confirm' },
      revenueOverrides: { 'opp-1': 400_000 },
    };
    rerender({ ...initialScope, edits });
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list.mock.calls[2]?.[2]).toEqual({ limit: 25 });
    rerender({
      ...initialScope,
      edits: { ...edits, revenueOverrides: { ...edits.revenueOverrides } },
    });
    expect(summary).toHaveBeenCalledTimes(3);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('refreshes note-only changes without resetting loaded pages or cursor identity', async () => {
    const provider = new MockDataProvider();
    const summary = vi.spyOn(provider, 'getActionCenterSummary');
    const list = vi.spyOn(provider, 'listActionItems');
    const { result, rerender } = renderHook(
      (scope: ActionCenterScope) =>
        useActionCenterQueries({ provider, access: INTERNAL_DEMO_SCOPE, scope }),
      { initialProps: { policy: DEFAULT_ACTION_POLICY } as ActionCenterScope },
    );
    await waitFor(() => expect(result.current.items.rows).toHaveLength(25));
    act(() => result.current.items.loadMore());
    await waitFor(() => expect(result.current.items.rows).toHaveLength(50));
    const ids = result.current.items.rows.map((item) => item.id);
    rerender({
      policy: DEFAULT_ACTION_POLICY,
      edits: { ...NO_SESSION_EDITS, notes: { 'opp-1': 'Only here' } },
    });
    await waitFor(() => expect(summary).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.items.refreshing).toBe(false));
    expect(result.current.items.rows.map((item) => item.id)).toEqual(ids);
    expect(list.mock.calls[2]?.[2]).toEqual({ limit: 50 });
  });

  it('retries a failed summary independently and cancels obsolete requests', async () => {
    const provider = new MockDataProvider();
    const summary = vi
      .spyOn(provider, 'getActionCenterSummary')
      .mockRejectedValueOnce(new Error('private'));
    const list = vi.spyOn(provider, 'listActionItems');
    const { result, unmount } = renderHook(() =>
      useActionCenterQueries({
        provider,
        access: INTERNAL_DEMO_SCOPE,
        scope: { policy: DEFAULT_ACTION_POLICY },
      }),
    );
    await waitFor(() => expect(result.current.summary.error).not.toBeNull());
    await waitFor(() => expect(result.current.items.rows).toHaveLength(25));
    act(() => result.current.summary.retry());
    await waitFor(() => expect(result.current.summary.data?.totalCount).toBe(85));
    expect(list).toHaveBeenCalledTimes(1);
    const signal = summary.mock.calls[1]?.[2]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
  });
});
