import { useEffect, useState } from 'react';
import { logger } from '../lib/logging';
import type { DataProvider } from './DataProvider';
import type { DashboardData } from './types';

export interface DashboardState {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads the book the views render, through the DataProvider seam.
 *
 * Note what is *not* here: weekly pipeline history. It used to be a ninth
 * collection in this `Promise.all`, and it is ~87% of the payload at
 * production volume — millions of rows to answer a question about fourteen
 * weeks. It now leaves through `getWeeklyForecastSeries()`, as a handful of
 * buckets, only where a view asks for it. See docs/migration-plan.md.
 *
 * The single `Promise.all` is itself on the way out: one slow collection is
 * still the difference between a page and a blank one. Phase 1 gives the
 * migrated views their own loading and error states; this one follows as the
 * remaining views move across.
 */
const log = logger.child({ component: 'useDashboardData' });

/** Loads all dashboard data through the DataProvider seam. */
export function useDashboardData(provider: DataProvider): DashboardState {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // A new load replaces the last one, so the previous attempt's state has to
    // go with it. Without this, `error` is write-once: a failed load leaves a
    // message that no later success clears, and swapping to a provider that
    // answers cleanly — which is what the header's provider selector does —
    // sits there reporting a failure that is over. `data` is deliberately kept,
    // so a reload shows the book it already has instead of an empty page.
    setError(null);
    setLoading(true);
    log.debug('Loading dashboard data');
    const startedAt = Date.now();
    Promise.all([
      provider.listPartners(),
      provider.listRegistrations(),
      provider.listOpportunities(),
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
          targets,
          activities,
          certifications,
          teamUsers,
        });
        setLoading(false);
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
