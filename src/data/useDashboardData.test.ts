import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useDashboardData } from './useDashboardData';
import type { DataProvider } from './DataProvider';
import { makeDashboardData } from '../test/fixtures';

/** A provider whose every method resolves from one in-memory book. */
function stubProvider(overrides: Partial<DataProvider> = {}): DataProvider {
  const data = makeDashboardData();
  return {
    listPartnerManagers: async () => data.partnerManagers,
    listPartners: async () => data.partners,
    listRegistrations: async () => data.registrations,
    listOpportunities: async () => data.opportunities,
    listPipelineSnapshots: async () => data.snapshots,
    getTargets: async () => data.targets,
    listActivities: async () => data.activities,
    listCertifications: async () => data.certifications,
    listTeamUsers: async () => data.teamUsers,
    ...overrides,
  };
}

describe('useDashboardData', () => {
  it('starts loading with no data', () => {
    const { result } = renderHook(() => useDashboardData(stubProvider()));
    expect(result.current).toMatchObject({ loading: true, data: null, error: null });
  });

  it('assembles every collection into one book', async () => {
    const { result } = renderHook(() => useDashboardData(stubProvider()));

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
    const { result } = renderHook(() =>
      useDashboardData(
        stubProvider({
          listOpportunities: async () => {
            throw new Error('Salesforce query timed out');
          },
        }),
      ),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBe('Salesforce query timed out');
    expect(result.current.data).toBeNull();
  });

  it('describes a non-Error rejection rather than rendering undefined', async () => {
    const { result } = renderHook(() =>
      useDashboardData(
        stubProvider({
          listPartners: async () => {
            throw 'no session';
          },
        }),
      ),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Failed to load dashboard data');
  });

  it('does not set state after unmount', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { unmount } = renderHook(() =>
      useDashboardData(
        stubProvider({
          listPartners: async () => {
            await gate;
            return [];
          },
        }),
      ),
    );

    unmount();
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // React warns loudly about setting state on an unmounted component; the
    // `alive` flag in the hook is what keeps that quiet.
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
