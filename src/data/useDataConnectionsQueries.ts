import { MAX_SLA_ALERT_DIGEST } from './DataProvider';
import type { DataProvider, RegistrationSlaAlertDigest, TeamRosterScope } from './DataProvider';
import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { usePaginatedRows } from './paginationState';
import type { PaginationState } from './paginationState';
import { useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import { useManagerDirectory, usePartnerRoster } from './useScopedDirectories';
import type { DealRegistration, Partner, PartnerManager, TeamUser } from './types';

/**
 * The Data Connections route's session data, fetched the way it will be
 * fetched in production: the connection catalog itself is static and renders
 * without touching business facts, and each data-backed section — the
 * roster, the SLA alert queue, the composer's record pickers — is its own
 * scoped query. One rejected call fails exactly one section; its retry
 * repeats only that call.
 *
 * The roster is internal notification infrastructure, so the route reads it
 * under the internal demo scope. The session's roster overlays (a routing
 * toggle, an added teammate) ride the roster and alert queries the way the
 * session's edits ride the forecast queries — there is no write path to an
 * identity provider (Production: Prod Only), so the overlay is the query's
 * input, and the alert rule resolves owners against exactly the roster the
 * Access section renders.
 */

/** The composer's record picker lists the most recent registrations. */
const COMPOSER_PAGE_SIZE = 25;

/**
 * The roster overlays as a stable key: a re-render that rebuilt but did not
 * change them issues no request, and a toggle or an addition refetches
 * exactly the two queries the overlay rides.
 */
function rosterOverlayKey(scope: TeamRosterScope): string {
  const overrides = Object.keys(scope.overrides ?? {})
    .sort()
    .map((id) => `${id}=${JSON.stringify(scope.overrides?.[id])}`)
    .join('&');
  const added = (scope.added ?? []).map((user) => JSON.stringify(user)).join('&');
  return `overrides:${overrides}|added:${added}`;
}

export interface DataConnectionsQueryInput {
  provider: DataProvider;
  /** The internal demo scope — this route's data is internal-only material. */
  access: DemoAccessScope;
  /** The session's roster overlays; see `TeamRosterScope`. */
  roster: TeamRosterScope;
  prospects: Partner[];
}

export interface DataConnectionsQueries {
  /** The notification roster with the session's overlays applied. */
  teamUsers: QueryState<TeamUser[]>;
  /** The partner managers the roster's alignment column renders names from. */
  managers: QueryState<PartnerManager[]>;
  /** The SLA alert queue: the urgent window plus the whole-queue counts. */
  alerts: QueryState<RegistrationSlaAlertDigest>;
  /** Recent registrations for the composer's record picker, a page at a time. */
  registrations: PaginationState<DealRegistration>;
  /** The partner roster the composer names records by. */
  partners: QueryState<Partner[]>;
}

export function useDataConnectionsQueries({
  provider,
  access,
  roster,
  prospects,
}: DataConnectionsQueryInput): DataConnectionsQueries {
  const accessKey = demoScopeKey(access);
  const overlayKey = rosterOverlayKey(roster);

  const teamUsers = useScopedQuery({
    provider,
    queryKey: `connections-roster|access:${accessKey}|${overlayKey}`,
    run: (context) => provider.getTeamRoster(access, roster, context),
    errorFallback: 'Failed to load the notification roster',
  });

  const managers = useManagerDirectory(provider, access);

  // The alert panel works the queue from the top: the most urgent
  // MAX_SLA_ALERT_DIGEST, a bound the contract exports and the provider
  // enforces, so the window and the rule can never drift apart.
  const alerts = useScopedQuery({
    provider,
    queryKey: `connections-alerts|access:${accessKey}|${overlayKey}|${MAX_SLA_ALERT_DIGEST}`,
    run: (context) =>
      provider.getRegistrationSlaAlerts(access, roster, MAX_SLA_ALERT_DIGEST, context),
    errorFallback: 'Failed to load the registration SLA alerts',
  });

  const registrations = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: `connections-registrations|access:${accessKey}|${COMPOSER_PAGE_SIZE}`,
    refreshKey: '',
    pageSize: COMPOSER_PAGE_SIZE,
    fetchPage: (page, context) => provider.listRecentRegistrations(access, {}, page, context),
    errorFallback: 'Failed to load the registration records',
    loadMoreErrorFallback: 'Failed to load more registration records',
  });

  const partners = usePartnerRoster(provider, access, prospects);

  return { teamUsers, managers, alerts, registrations, partners };
}
