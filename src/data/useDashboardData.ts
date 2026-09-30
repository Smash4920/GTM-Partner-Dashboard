import { useCallback, useEffect, useState } from 'react';
import { logger } from '../lib/logging';
import type { DataProvider } from './DataProvider';
import type { DashboardData } from './types';

export interface DashboardState {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  /** Repeats the load. The error clears as the new attempt starts. */
  retry: () => void;
}

const log = logger.child({ component: 'useDashboardData' });

/**
 * What the last finished load settled into, tagged with the provider that
 * produced it. The tag is the race guard: a result is only ever exposed while
 * the provider that produced it is still the one being asked, so a provider
 * switch can never leave the old book rendering under the new label — not
 * even for the frame before this hook's effect re-runs.
 */
interface SettledLoad {
  provider: DataProvider;
  data?: DashboardData;
  error?: string;
}

/**
 * Loads the book the views render, through the DataProvider seam.
 *
 * Note what is *not* here: weekly pipeline history. It used to be a ninth
 * collection in this `Promise.all`, and it is ~87% of the payload at
 * production volume — millions of rows to answer a question about fourteen
 * weeks. It now leaves through `getWeeklyForecastSeries()`, as a handful of
 * buckets, only where a view asks for it. The count still appears in the load
 * record below as 0 for that reason: the collection is no longer this hook's
 * to report. See docs/migration-plan.md.
 *
 * The single `Promise.all` is itself on the way out: one slow collection is
 * still the difference between a page and a blank one. Phase 1 gives the
 * migrated views their own loading and error states; this one follows as the
 * remaining views move across.
 *
 * Cancellation: every call carries the attempt's AbortSignal, so a provider
 * that honours cancellation stops the obsolete work itself. One that cannot
 * still cannot get a late answer committed — the write is skipped and the
 * settled record stays tagged to the provider that owns it.
 */
export function useDashboardData(provider: DataProvider): DashboardState {
  const [settled, setSettled] = useState<SettledLoad | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    log.debug('Loading dashboard data');
    const startedAt = Date.now();
    // A retry starts a new attempt: whatever a previous attempt settled into
    // — including its error — is no longer the state of the world.
    if (attempt > 0) {
      setSettled((previous) =>
        previous !== null && previous.provider === provider && previous.error !== undefined
          ? { provider }
          : previous,
      );
    }
    // One context, one signal: the eight calls are one logical load, so they
    // become obsolete together.
    const context = { signal: controller.signal };
    Promise.all([
      provider.listPartners(context),
      provider.listRegistrations(context),
      provider.listOpportunities(context),
      provider.getTargets(context),
      provider.listPartnerManagers(context),
      provider.listActivities(context),
      provider.listCertifications(context),
      provider.listTeamUsers(context),
    ]).then(
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
        if (controller.signal.aborted) {
          // StrictMode double-invokes effects in development; the first
          // run's result is expected to be discarded, and the record says so.
          // A provider swap mid-load lands here too.
          log.debug('Load finished after abort; result discarded');
          return;
        }
        log.info('Dashboard data loaded', {
          partnerManagers: partnerManagers.length,
          partners: partners.length,
          registrations: registrations.length,
          opportunities: opportunities.length,
          targets: targets.length,
          activities: activities.length,
          certifications: certifications.length,
          teamUsers: teamUsers.length,
          durationMs: Date.now() - startedAt,
        });
        setSettled({
          provider,
          data: {
            partnerManagers,
            partners,
            registrations,
            opportunities,
            targets,
            activities,
            certifications,
            teamUsers,
          },
        });
      },
      (err: unknown) => {
        if (controller.signal.aborted) {
          log.debug('Load failed after abort; failure discarded');
          return;
        }
        log.error('Failed to load dashboard data', { error: err });
        setSettled({
          provider,
          error: err instanceof Error ? err.message : 'Failed to load dashboard data',
        });
      },
    );
    return () => {
      controller.abort();
    };
  }, [provider, attempt]);

  const retry = useCallback(() => {
    setAttempt((previous) => previous + 1);
  }, []);

  // The frame between "the committed provider changed" and "this effect
  // re-ran" is exactly where old-provider data used to show under the new
  // label. Gating at read time, rather than resetting in the effect, closes
  // that frame: a result belongs to its provider or to no one.
  const current = settled !== null && settled.provider === provider ? settled : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  return { data, error, loading: data === null && error === null, retry };
}
