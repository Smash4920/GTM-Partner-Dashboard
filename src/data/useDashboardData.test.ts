import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { makeProviderBook } from '../test/fixtures';

/**
 * A provider whose every method resolves from one in-memory book. The real
 * mock is the base, so this stays honest about the contract as it grows; the
 * overrides are what the failure tests need.
 */
function stubProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  return Object.assign(new MockDataProvider(makeProviderBook()), overrides);
}

describe('useDashboardData', () => {
  it('starts loading with no data', () => {
    const provider = stubProvider();
    const { result } = renderHook(() => useDashboardData(provider));
    expect(result.current).toMatchObject({ loading: true, data: null, error: null });
  });

  it('assembles every collection into one book', async () => {
    // Hoisted, and that matters: the provider is the effect's dependency, so a
    // provider built inside the render callback is a new object every render
    // and the hook refetches forever. App is what keeps this stable — it
    // memoises the provider — so the harness has to as well.
    const provider = stubProvider();
    const { result } = renderHook(() => useDashboardData(provider));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.data).toMatchObject({
      partnerManagers: [{ id: 'pm-1', name: 'J. Alvarez' }],
      partners: [{ id: 'partner-1' }],
      opportunities: [{ id: 'opp-1' }],
    });
  });

  // The whole dashboard currently rides on one Promise.all, so a single
  // failing collection is the difference between a working page and a blank
  // one. Phase 1 of docs/migration-plan.md is what splits this up.
  it('surfaces a provider failure instead of hanging on the loader', async () => {
    const provider = stubProvider({
      listOpportunities: async () => {
        throw new Error('Salesforce query timed out');
      },
    });
    const { result } = renderHook(() => useDashboardData(provider));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Salesforce query timed out');
    expect(result.current.data).toBeNull();
  });

  it('describes a non-Error rejection rather than rendering undefined', async () => {
    const provider = stubProvider({
      listPartners: async () => {
        throw 'no session';
      },
    });
    const { result } = renderHook(() => useDashboardData(provider));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load dashboard data');
  });

  it('clears a failure on the next attempt instead of reporting it forever', async () => {
    // Found in the browser, not in a test: the error was write-once. Switch to
    // a provider whose call fails, then to one that answers, and the banner
    // from the first stayed on screen over perfectly good data. The header's
    // provider selector makes that a single click.
    const flaky = stubProvider({
      listOpportunities: async () => {
        throw new Error('listOpportunities failed in transit (simulated)');
      },
    });
    const healthy = stubProvider();

    const { result, rerender } = renderHook(
      ({ provider }: { provider: DataProvider }) => useDashboardData(provider),
      { initialProps: { provider: flaky } },
    );
    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ provider: healthy });
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  it('does not set state after unmount', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const provider = stubProvider({
      listPartners: async () => {
        await gate;
        return [];
      },
    });

    const { unmount } = renderHook(() => useDashboardData(provider));

    unmount();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // React warns loudly about setting state on an unmounted component; the
    // `alive` flag in the hook is what keeps that quiet.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
