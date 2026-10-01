import type { ActionItem, TeamUser } from '../data/types';

/** Active demo recommendation only; never an authorization decision. */
export function routeActionOwner(
  entityKind: ActionItem['entityKind'],
  partnerManagerId: string | undefined,
  users: readonly TeamUser[],
): NonNullable<ActionItem['owner']> {
  const active = users.filter((user) => user.status === 'active');
  const pick = (role: TeamUser['role'], aligned = false) =>
    active
      .filter(
        (user) => user.role === role && (!aligned || user.partnerManagerId === partnerManagerId),
      )
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
  const manager = partnerManagerId === undefined ? undefined : pick('partner-manager', true);
  if (manager !== undefined) return { userId: manager.id, basis: 'manager' };
  const registration = entityKind === 'registration';
  const fallback = pick(registration ? 'deal-desk-ops' : 'partnership-lead');
  return fallback === undefined
    ? { basis: 'unowned' }
    : { userId: fallback.id, basis: registration ? 'deal-desk' : 'partnership-lead' };
}
