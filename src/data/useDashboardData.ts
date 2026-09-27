import { useEffect, useState } from 'react';
import { logger } from '../lib/logging';
import type { DataProvider } from './DataProvider';
import type { DashboardData } from './types';

export interface DashboardState {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
}

const log = logger.child({ component: 'useDashboardData' });

/** Loads all dashboard data through the DataProvider seam. */
export function useDashboardData(provider: DataProvider): DashboardState {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    log.debug('Loading dashboard data');
    const startedAt = Date.now();
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
          if (!alive) {
            // StrictMode double-invokes effects in development; the first
            // run's result is expected to be discarded, and the record says so.
            log.debug('Load finished after unmount; result discarded');
            return;
          }
          log.info('Dashboard data loaded', {
            partnerManagers: partnerManagers.length,
            partners: partners.length,
            registrations: registrations.length,
            opportunities: opportunities.length,
            snapshots: snapshots.length,
            targets: targets.length,
            activities: activities.length,
            certifications: certifications.length,
            teamUsers: teamUsers.length,
            durationMs: Date.now() - startedAt,
          });
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
        if (!alive) {
          log.debug('Load failed after unmount; failure discarded');
          return;
        }
        log.error('Failed to load dashboard data', { error: err });
        setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [provider]);

  return { data, loading, error };
}
