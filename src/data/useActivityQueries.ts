import type { DataProvider } from './DataProvider';
import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import type { WeeklyActivityRow, WeeklyGoalProgress } from '../lib/metrics';
import { usePaginatedRows } from './paginationState';
import type { PaginationState } from './paginationState';
import { classificationsKey, prospectsKey, useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import { useManagerDirectory, usePartnerRoster } from './useScopedDirectories';
import type { ActivityMeeting, MeetingClassification, Partner, PartnerManager } from './types';

/**
 * The Activity Tracking route's data, fetched the way it will be fetched in
 * production: the manager/partner selection is an input to every query, and
 * the provider computes each card's answer from the scoped rows alone. One
 * rejected call fails exactly one card; its retry repeats only that call.
 *
 * What each query is for:
 *
 * - `managers` and `roster`: the two selectors' dimensions. The roster
 *   carries the session's prospect partners, so adding one refetches exactly
 *   this answer.
 * - `goal`: this week's meetings against the weekly goal. It is manager-wide
 *   by design — the goal belongs to the manager, never to the partner
 *   filter — and it applies the session's committed classifications.
 * - `goalWeek`: the manager-wide weekly series, whose current-week row
 *   carries the by-type split that sits inside the goal card; like the goal,
 *   it ignores the partner filter.
 * - `series`: the eight-week volume chart, re-scoped by the partner filter.
 * - `meetings`: the manager's current-week calendar, a cursor page at a
 *   time — the raw classification input Log Meetings edits a draft against.
 *   Classifications are not an input here, so a commit never refetches it.
 *
 * `managerId: ''` means "follow the directory". While the directory is
 * still answering there is no manager to attribute figures to, so the
 * manager-scoped aggregates hold at initial loading and issue nothing — an
 * org-wide placeholder asked now would resolve under a manager nobody
 * selected. Once the directory answers, the aggregates commit to its first
 * manager: the view's label and the figures arrive under one scope identity,
 * never a frame that pairs the new manager's name with an org-wide answer.
 * A FAILED directory resolves to the org-wide fallback the view has always
 * documented, rendered under its generic label. An answered-EMPTY directory
 * is neither pending nor failed: there is no manager whose goal these cards
 * could describe, so the goal and series queries are never issued and the
 * surfaces say the directory holds no partner managers — an org-wide answer
 * would attribute the crowd's work to a selection nobody made. The resolved
 * id is returned as `managerId` so the view renders the manager the data
 * actually describes.
 *
 * A classification commit refetches `goal`, `goalWeek`, and `series` — the
 * three aggregates that read classifications — exactly once, and nothing
 * else: the keys are built from primitive values, so a re-render that
 * changed nothing issues no request.
 */

/** Rows per page of the Log Meetings calendar. */
const CLASSIFICATION_PAGE_SIZE = 25;

/**
 * The goal surfaces' answer when the manager directory answered with nobody
 * on it. The aggregate queries were never issued, so this is not a failure
 * of those queries — it is the truthful state of the directory, and the
 * directory's retry is the only way the answer can change.
 */
export const EMPTY_DIRECTORY_COPY = 'No partner managers on the directory';

/** The explicit unavailable state for a card whose scope does not exist. */
function emptyDirectoryState<T>(retry: () => void): QueryState<T> {
  return {
    data: null,
    meta: null,
    loading: false,
    refreshing: false,
    error: EMPTY_DIRECTORY_COPY,
    retry,
  };
}

export interface ActivityQueryInput {
  provider: DataProvider;
  access: DemoAccessScope;
  /**
   * The selected partner manager; '' follows the directory's first manager.
   * Org-wide answers happen only when the directory FAILS — a directory
   * that answered empty is an explicit unavailable state, not a scope.
   */
  managerId: string;
  /** 'all' or one partner id — re-scopes the volume chart only. */
  partnerId: string;
  classifications: Record<string, MeetingClassification>;
  prospects: Partner[];
}

export interface ActivityQueries {
  /**
   * The manager the aggregate queries resolved to; '' when following the
   * directory produced none — the org-wide failure fallback, or an empty
   * directory (the goal and series states say which).
   */
  managerId: string;
  managers: QueryState<PartnerManager[]>;
  roster: QueryState<Partner[]>;
  goal: QueryState<WeeklyGoalProgress>;
  goalWeek: QueryState<WeeklyActivityRow[]>;
  series: QueryState<WeeklyActivityRow[]>;
  meetings: PaginationState<ActivityMeeting>;
}

export function useActivityQueries({
  provider,
  access,
  managerId,
  partnerId,
  classifications,
  prospects,
}: ActivityQueryInput): ActivityQueries {
  const accessKey = demoScopeKey(access);
  const clsKey = classificationsKey(classifications);
  const rosterKey = prospectsKey(prospects);
  const selectedPartnerId = partnerId === 'all' ? undefined : partnerId;

  const managers = useManagerDirectory(provider, access);
  const roster = usePartnerRoster(provider, access, prospects);

  // An explicit selection wins. Otherwise the aggregates follow the
  // directory — but only once it has answered: while it is still answering
  // they stay disabled rather than issue an org-wide placeholder, and only
  // a FAILED directory resolves to the org-wide fallback. A directory that
  // answered empty is a truthful "no partner managers" state, so no
  // aggregate fires at all — there is nobody whose goal an org-wide number
  // could describe.
  const directoryFailed = managers.error !== null && managers.data === null;
  const directoryEmpty = managers.data !== null && managers.data.length === 0;
  const resolvedManagerId = managerId !== '' ? managerId : (managers.data?.[0]?.id ?? '');
  const aggregatesEnabled = managerId !== '' || resolvedManagerId !== '' || directoryFailed;
  const partnerManagerId = resolvedManagerId === '' ? undefined : resolvedManagerId;

  const goal = useScopedQuery({
    provider,
    queryKey: `activity-goal|access:${accessKey}|manager:${resolvedManagerId}|cls:${clsKey}|prospects:${rosterKey}`,
    // The scope identity an answer belongs to: this manager's goal. A
    // manager change — the user's or the directory's late resolution — must
    // never show the previous scope's figures under the new label.
    scopeKey: `activity-goal|access:${accessKey}|manager:${resolvedManagerId}`,
    enabled: aggregatesEnabled,
    run: (context) =>
      provider.getWeeklyGoalProgress(
        access,
        { partnerManagerId, classifications, prospects },
        context,
      ),
    errorFallback: 'Failed to load the weekly goal',
  });

  const goalWeek = useScopedQuery({
    provider,
    queryKey: `activity-goal-week|access:${accessKey}|manager:${resolvedManagerId}|cls:${clsKey}|prospects:${rosterKey}`,
    scopeKey: `activity-goal-week|access:${accessKey}|manager:${resolvedManagerId}`,
    enabled: aggregatesEnabled,
    run: (context) =>
      provider.getWeeklyActivitySeries(
        access,
        { partnerManagerId, classifications, prospects },
        context,
      ),
    errorFallback: 'Failed to load the weekly meeting types',
  });

  const series = useScopedQuery({
    provider,
    queryKey: `activity-series|access:${accessKey}|manager:${resolvedManagerId}|partner:${partnerId}|cls:${clsKey}|prospects:${rosterKey}`,
    // The chart's scope identity includes the partner filter: one partner's
    // series is not a stale stand-in for another's.
    scopeKey: `activity-series|access:${accessKey}|manager:${resolvedManagerId}|partner:${partnerId}`,
    enabled: aggregatesEnabled,
    run: (context) =>
      provider.getWeeklyActivitySeries(
        access,
        {
          partnerManagerId,
          ...(selectedPartnerId !== undefined ? { partnerId: selectedPartnerId } : {}),
          classifications,
          prospects,
        },
        context,
      ),
    errorFallback: 'Failed to load the weekly activity',
  });

  const meetings = usePaginatedRows({
    provider,
    // No manager resolved (a failed or empty directory): no calendar.
    enabled: resolvedManagerId !== '',
    resetKey: `classification-meetings|access:${accessKey}|manager:${resolvedManagerId}|${CLASSIFICATION_PAGE_SIZE}`,
    // The raw calendar rows carry no classifications or prospects; nothing
    // session-side refreshes this collection.
    refreshKey: '',
    pageSize: CLASSIFICATION_PAGE_SIZE,
    fetchPage: (page, context) =>
      provider.listWeeklyClassificationMeetings(
        access,
        { partnerManagerId: resolvedManagerId },
        page,
        context,
      ),
    errorFallback: 'Failed to load the week’s meetings',
    loadMoreErrorFallback: 'Failed to load more meetings',
  });

  // The empty-directory state overrides the (never-issued) aggregates only
  // in follow-the-directory mode; an explicit selection always stands.
  const noManagers = managerId === '' && directoryEmpty;
  return {
    managerId: resolvedManagerId,
    managers,
    roster,
    goal: noManagers ? emptyDirectoryState<WeeklyGoalProgress>(managers.retry) : goal,
    goalWeek: noManagers ? emptyDirectoryState<WeeklyActivityRow[]>(managers.retry) : goalWeek,
    series: noManagers ? emptyDirectoryState<WeeklyActivityRow[]>(managers.retry) : series,
    meetings,
  };
}
