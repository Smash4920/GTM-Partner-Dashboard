import { useEffect, useState } from 'react';
import type { DataProvider } from './DataProvider';
import type { DashboardData } from './types';

export interface DashboardState {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
}

/** Loads all dashboard data through the DataProvider seam. */
export function useDashboardData(provider: DataProvider): DashboardState {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      provider.listPartners(),
      provider.listRegistrations(),
      provider.listOpportunities(),
      provider.listPipelineSnapshots(),
      provider.getTargets(),
      provider.listPartnerManagers(),
      provider.listActivities(),
      provider.listCertifications(),
      provider.listTeamUsers(),
    ])
      .then(
        ([
          partners,
          registrations,
          opportunities,
          snapshots,
          targets,
          partnerManagers,
          activities,
          certifications,
          teamUsers,
        ]) => {
        if (!alive) return;
        setData({
          partnerManagers,
          partners,
          registrations,
          opportunities,
          snapshots,
          targets,
          activities,
          certifications,
          teamUsers,
        });
        setLoading(false);
        },
      )
      .catch((err: unknown) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [provider]);

  return { data, loading, error };
}
