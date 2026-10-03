import { throwIfAborted } from '../../lib/abort';
import { deriveActionItems } from '../../lib/actionRules';
import { routeActionOwner } from '../../lib/actionRouting';
import { applyTeamRosterOverlays } from '../../lib/metrics';
import {
  scopeActivities,
  scopeOpportunities,
  scopePartners,
  scopeRegistrations,
  scopeTeamUsers,
} from '../accessScope';
import type { DemoAccessScope } from '../accessScope';
import type { ActionCenterScope } from '../actionCenter';
import type { QueryContext } from '../queryContext';
import type { DataLineage } from '../queryMetadata';
import { applySessionEdits, NO_SESSION_EDITS } from '../sessionEdits';
import type { SessionEdits } from '../sessionEdits';
import type { ActionPolicy, Opportunity } from '../types';
import { latestPriorCloseDates } from './book';
import type { ProviderBook } from './book';

export { actionCenterScopeKey, summarizeActionItems } from '../actionCenter';

/** A typed seam rejection, containing no policy values or source records. */
class ActionPolicyQueryError extends Error {
  readonly code = 'invalid-action-policy';
  constructor() {
    super('Action policy requires positive integers and one to four deteriorating drivers');
    this.name = 'ActionPolicyQueryError';
  }
}

function requireValidPolicy(policy: Readonly<ActionPolicy>): void {
  const values = [
    policy.highValueAmount,
    policy.staleCalendarDays,
    policy.missingNextStepHorizonDays,
    policy.closeSlipCalendarDays,
    policy.healthWindowDays,
    policy.minimumDeterioratingDrivers,
  ];
  if (
    values.some((value) => !Number.isInteger(value) || value <= 0) ||
    policy.minimumDeterioratingDrivers > 4
  )
    throw new ActionPolicyQueryError();
}

/** Narrow overlays before both the one application and its lineage count. */
function scopeSessionEdits(
  edits: SessionEdits | undefined,
  opportunities: Opportunity[],
): SessionEdits {
  const ids = new Set(opportunities.map((opportunity) => opportunity.id));
  const select = <T>(values: Record<string, T> | undefined): Record<string, T> =>
    Object.fromEntries(Object.entries(values ?? {}).filter(([id]) => ids.has(id)));
  return {
    ...NO_SESSION_EDITS,
    revenueOverrides: select(edits?.revenueOverrides),
    nextSteps: select(edits?.nextSteps),
  };
}

/**
 * Lazy provider-private calculation. Classifications resolve effective partner
 * ownership before access scoping; raw calendar attribution must not strand a
 * reassigned meeting outside both managers' health windows.
 */
export function scopedActionCenter(
  book: ProviderBook,
  access: DemoAccessScope,
  scope: ActionCenterScope,
  asOf: string,
  context?: QueryContext,
) {
  throwIfAborted(context?.signal);
  requireValidPolicy(scope.policy);
  const allPartners = [...book.partners, ...(scope.prospects ?? [])];
  const partners = scopePartners(allPartners, access);
  const visible = scopeOpportunities(book.opportunities, allPartners, access);
  const edits = scopeSessionEdits(scope.edits, visible);
  const opportunities = applySessionEdits(visible, edits);
  const registrations = scopeRegistrations(book.registrations, allPartners, access);
  const managerByPartner = new Map(
    allPartners.map((partner) => [partner.id, partner.partnerManagerId]),
  );
  const classified = book.activities.map((activity) => {
    const classification = scope.classifications?.[activity.id];
    return classification === undefined
      ? activity
      : {
          ...activity,
          ...classification,
          partnerManagerId:
            managerByPartner.get(classification.partnerId) ?? activity.partnerManagerId,
        };
  });
  const activities = scopeActivities(classified, allPartners, access);
  const users =
    access.audience === 'partner'
      ? []
      : applyTeamRosterOverlays(
          scopeTeamUsers(book.teamUsers, access),
          scope.roster?.overrides,
          scope.roster?.added,
        );
  const visibleIds = new Set(visible.map((opportunity) => opportunity.id));
  const priorCloseDates = latestPriorCloseDates(
    book.snapshots.filter((row) => visibleIds.has(row.opportunityId)),
    asOf,
  );
  const derived = deriveActionItems({
    asOf,
    policy: scope.policy,
    partners,
    opportunities,
    registrations,
    activities,
    priorCloseDates,
  });
  const items = derived
    .map((item) =>
      access.audience === 'partner'
        ? item
        : {
            ...item,
            owner: routeActionOwner(item.entityKind, managerByPartner.get(item.partnerId), users),
          },
    )
    .filter((item) => {
      const filters = scope.filters;
      return (
        (!filters?.categories?.length ||
          item.reasons.some((reason) => filters.categories?.includes(reason.category))) &&
        (filters?.ownerId === undefined ||
          (filters.ownerId === 'unowned'
            ? item.owner?.userId === undefined
            : item.owner?.userId === filters.ownerId)) &&
        (filters?.severity === undefined || item.severity === filters.severity)
      );
    });
  const lineage: DataLineage[] = [
    {
      source: 'weekly-snapshots',
      description:
        'Latest strictly prior expected close dates only; raw history remains provider-private',
    },
  ];
  const classifiedCount = activities.filter(
    (activity) => scope.classifications?.[activity.id] !== undefined,
  ).length;
  const rosterCount =
    access.audience === 'partner'
      ? 0
      : Object.keys(scope.roster?.overrides ?? {}).length + (scope.roster?.added?.length ?? 0);
  const prospectIds = new Set(scope.prospects?.map((partner) => partner.id));
  const prospectCount = partners.filter((partner) => prospectIds.has(partner.id)).length;
  if (classifiedCount + rosterCount + prospectCount > 0)
    lineage.push({
      source: 'session-edits',
      description: `${classifiedCount + rosterCount + prospectCount} session reporting overlays applied before derivation`,
    });
  return { items, edits, lineage };
}
