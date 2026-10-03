import type { TeamRosterScope } from './DataProvider';
import type { SessionEdits } from './sessionEdits';
import type {
  ActionCategory,
  ActionItem,
  ActionPolicy,
  ActionSeverity,
  MeetingClassification,
  Partner,
  TeamUser,
} from './types';

export interface ActionCenterScope {
  policy: Readonly<ActionPolicy>;
  filters?: {
    categories?: readonly ActionCategory[];
    ownerId?: string;
    severity?: ActionSeverity;
  };
  edits?: SessionEdits;
  roster?: TeamRosterScope;
  classifications?: Record<string, MeetingClassification>;
  prospects?: Partner[];
}

export interface ActionCenterSummary {
  totalCount: number;
  categoryCounts: Record<ActionCategory, number>;
}

export const ACTION_CATEGORY_LABELS: Record<ActionCategory, string> = {
  'stale-high-value': 'Stale high-value deal',
  'missing-next-step': 'Missing next step',
  'close-date-slip': 'Slipping close date',
  'registration-sla': 'Registration SLA',
  'partner-health': 'Partner-health deterioration',
};

export const ACTION_CATEGORIES = Object.keys(ACTION_CATEGORY_LABELS) as ActionCategory[];

function sortedEntries<T>(record: Record<string, T> | undefined): [string, T][] {
  return Object.entries(record ?? {}).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function routingFields(user: Partial<TeamUser>): unknown[] {
  return [user.id, user.role, user.partnerManagerId, user.status];
}

function routingPatch(user: Partial<TeamUser>): unknown[][] {
  const fields: readonly (keyof TeamUser)[] = ['id', 'role', 'partnerManagerId', 'status'];
  return fields.filter((field) => Object.hasOwn(user, field)).map((field) => [field, user[field]]);
}

function sortedTuples(rows: unknown[][]): unknown[][] {
  return rows.sort((left, right) => {
    const a = JSON.stringify(left);
    const b = JSON.stringify(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/**
 * Content identity, not object identity. Bind cursors and hook requests to
 * eligibility, exposure, ownership and membership; notes and forecast calls
 * affect none of those. No key is logged or placed in a cursor verbatim.
 */
export function actionCenterScopeKey(scope: ActionCenterScope): string {
  const policy = scope.policy;
  return JSON.stringify([
    [
      policy.highValueAmount,
      policy.staleCalendarDays,
      policy.missingNextStepHorizonDays,
      policy.closeSlipCalendarDays,
      policy.healthWindowDays,
      policy.minimumDeterioratingDrivers,
    ],
    [...new Set(scope.filters?.categories ?? [])].sort(),
    scope.filters?.ownerId,
    scope.filters?.severity,
    sortedEntries(scope.edits?.revenueOverrides),
    sortedEntries(scope.edits?.nextSteps),
    sortedEntries(scope.roster?.overrides)
      .map(([id, user]) => [id, ...routingPatch(user)])
      .filter((patch) => patch.length > 1),
    sortedTuples((scope.roster?.added ?? []).map(routingFields)),
    sortedEntries(scope.classifications).map(([id, value]) => [id, value.partnerId, value.type]),
    sortedTuples((scope.prospects ?? []).map((partner) => [partner.id, partner.partnerManagerId])),
  ]);
}

/** Counts every retained reason across the full filtered set, never just a page. */
export function summarizeActionItems(items: readonly ActionItem[]): ActionCenterSummary {
  const categoryCounts = Object.fromEntries(
    ACTION_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ActionCategory, number>;
  for (const item of items) {
    for (const reason of item.reasons) categoryCounts[reason.category] += 1;
  }
  return { totalCount: items.length, categoryCounts };
}
