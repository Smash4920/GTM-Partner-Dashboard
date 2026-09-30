import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerCertification,
  PartnerManager,
  Target,
  TeamUser,
} from './types';

/**
 * Demo access scope: who is asking, as data.
 *
 * Every data-bearing provider method takes one of these as its first
 * argument and applies it before any aggregation, ordering, or pagination,
 * so the answer is computed as if the out-of-scope rows were never written:
 *
 * - `internal`: the GTM partner team. Unqualified, the whole organization;
 *   with `partnerManagerId`, narrowed to that manager's book — the shape a
 *   partner manager's signed-in view would take.
 * - `partner`: one partner's portal view. Only that partner's rows, with the
 *   internal-only material removed: Sell To opportunities (the partner is
 *   the customer there, so the deal is not theirs to see), registrations
 *   under a conflict (another partner registered the same account), and the
 *   internal directories — the partner-manager list and the team roster.
 *
 * This is demonstrative filtering, and it is labelled that way everywhere it
 * surfaces. It is NOT authentication, authorization, row-level security, or
 * any other enforcement: the browser is untrusted, and a caller can construct
 * any scope it likes. The scope exists to prove policy propagation through
 * the contract and to pin the partner-facing exclusions in conformance
 * tests. Real enforcement is server-side row authorization behind trusted
 * identity, which is Production: Prod Only.
 */
export type DemoAccessScope =
  | {
      audience: 'internal';
      /** Present narrows the answer to one partner manager's book. */
      partnerManagerId?: string;
    }
  | {
      audience: 'partner';
      /** The one partner the caller is presenting as. */
      partnerId: string;
    };

/**
 * The shell's own scope: the internal team, org-wide. Every view the demo
 * operator drives asks with this scope; the partner audience exists for the
 * contract and its conformance tests until the partner-facing routes migrate
 * onto scoped queries.
 */
export const INTERNAL_DEMO_SCOPE: DemoAccessScope = { audience: 'internal' };

/**
 * The scope's primitive identity, for query keys and effect dependencies.
 * Hooks key on this string rather than the scope object, so a rebuilt but
 * equal scope cannot start a refetch loop.
 */
export function demoScopeKey(scope: DemoAccessScope): string {
  return scope.audience === 'internal'
    ? `internal:${scope.partnerManagerId ?? 'org'}`
    : `partner:${scope.partnerId}`;
}

/** The canonical collections a demo access scope can filter. */
export interface CanonicalCollections {
  partnerManagers: PartnerManager[];
  partners: Partner[];
  registrations: DealRegistration[];
  opportunities: Opportunity[];
  targets: Target[];
  activities: ActivityMeeting[];
  certifications: PartnerCertification[];
  teamUsers: TeamUser[];
}

/** Readonly view of the same collections, for pure filtering inputs. */
export type ScopeableCollections = {
  readonly [K in keyof CanonicalCollections]: readonly CanonicalCollections[K][number][];
};

/** Ids of the partners one manager owns. */
function managedPartnerIds(partners: readonly Partner[], managerId: string): Set<string> {
  return new Set(
    partners.filter((partner) => partner.partnerManagerId === managerId).map((p) => p.id),
  );
}

/**
 * Registrations whose account a second partner also registered. A conflict
 * row says "another partner is on this account", which is exactly what a
 * partner-facing answer must never reveal — so partner scope drops the
 * conflicting rows on *both* sides and leaves the conflict to the internal
 * duplicate view. Mirrors `duplicateRegistrationGroups` in src/lib/metrics.ts:
 * any overlap on account name across distinct partners counts, whatever the
 * statuses.
 */
function conflictingRegistrationIds(registrations: readonly DealRegistration[]): Set<string> {
  const partnersByAccount = new Map<string, Set<string>>();
  for (const registration of registrations) {
    const seen = partnersByAccount.get(registration.accountName);
    if (seen) seen.add(registration.partnerId);
    else partnersByAccount.set(registration.accountName, new Set([registration.partnerId]));
  }
  const conflicts = new Set<string>();
  for (const registration of registrations) {
    if ((partnersByAccount.get(registration.accountName)?.size ?? 0) > 1) {
      conflicts.add(registration.id);
    }
  }
  return conflicts;
}

/**
 * The partner dimension, scoped. A partner audience sees its own record only
 * — the full directory is internal data. An unknown id scopes to nothing: a
 * scope that names a partner the book does not hold returns empty
 * collections, never the whole book.
 */
export function scopePartners(partners: readonly Partner[], access: DemoAccessScope): Partner[] {
  if (access.audience === 'partner') {
    return partners.filter((partner) => partner.id === access.partnerId);
  }
  if (access.partnerManagerId === undefined) return [...partners];
  return partners.filter((partner) => partner.partnerManagerId === access.partnerManagerId);
}

/**
 * Opportunities, scoped. The partner audience never sees Sell To: those deals
 * sell *to* the partner, so they are internal revenue, not the partner's
 * pipeline.
 */
export function scopeOpportunities(
  opportunities: readonly Opportunity[],
  partners: readonly Partner[],
  access: DemoAccessScope,
): Opportunity[] {
  if (access.audience === 'partner') {
    return opportunities.filter(
      (opp) => opp.partnerId === access.partnerId && opp.oppType !== 'sell-to',
    );
  }
  if (access.partnerManagerId === undefined) return [...opportunities];
  const managed = managedPartnerIds(partners, access.partnerManagerId);
  return opportunities.filter((opp) => managed.has(opp.partnerId));
}

/**
 * Registrations, scoped. Partner scope keeps the partner's own submissions
 * minus any under a conflict (see `conflictingRegistrationIds`): the conflict
 * table is internal-only, and so is the fact that an account overlaps.
 */
export function scopeRegistrations(
  registrations: readonly DealRegistration[],
  partners: readonly Partner[],
  access: DemoAccessScope,
): DealRegistration[] {
  if (access.audience === 'partner') {
    const conflicts = conflictingRegistrationIds(registrations);
    return registrations.filter(
      (reg) => reg.partnerId === access.partnerId && !conflicts.has(reg.id),
    );
  }
  if (access.partnerManagerId === undefined) return [...registrations];
  const managed = managedPartnerIds(partners, access.partnerManagerId);
  return registrations.filter((reg) => managed.has(reg.partnerId));
}

/** Targets, scoped: a target belongs to its partner, and through the partner to the manager. */
export function scopeTargets(
  targets: readonly Target[],
  partners: readonly Partner[],
  access: DemoAccessScope,
): Target[] {
  if (access.audience === 'partner') {
    return targets.filter((target) => target.partnerId === access.partnerId);
  }
  if (access.partnerManagerId === undefined) return [...targets];
  const managed = managedPartnerIds(partners, access.partnerManagerId);
  return targets.filter((target) => managed.has(target.partnerId));
}

/** Activities, scoped through the partner they belong to. */
export function scopeActivities(
  activities: readonly ActivityMeeting[],
  partners: readonly Partner[],
  access: DemoAccessScope,
): ActivityMeeting[] {
  if (access.audience === 'partner') {
    return activities.filter((activity) => activity.partnerId === access.partnerId);
  }
  if (access.partnerManagerId === undefined) return [...activities];
  const managed = managedPartnerIds(partners, access.partnerManagerId);
  return activities.filter((activity) => managed.has(activity.partnerId));
}

/** Certification records, scoped through the partner they describe. */
export function scopeCertifications(
  certifications: readonly PartnerCertification[],
  partners: readonly Partner[],
  access: DemoAccessScope,
): PartnerCertification[] {
  if (access.audience === 'partner') {
    return certifications.filter((cert) => cert.partnerId === access.partnerId);
  }
  if (access.partnerManagerId === undefined) return [...certifications];
  const managed = managedPartnerIds(partners, access.partnerManagerId);
  return certifications.filter((cert) => managed.has(cert.partnerId));
}

/**
 * The partner-manager directory, scoped. It is internal org data: a partner
 * audience receives no directory rows at all.
 */
export function scopePartnerManagers(
  managers: readonly PartnerManager[],
  access: DemoAccessScope,
): PartnerManager[] {
  if (access.audience === 'partner') return [];
  if (access.partnerManagerId === undefined) return [...managers];
  return managers.filter((manager) => manager.id === access.partnerManagerId);
}

/**
 * The internal notification roster, scoped. It is internal-only data, so a
 * partner audience receives nothing. Internal audiences share the whole
 * roster: routing notifications is an org operations concern, not one
 * manager's book.
 */
export function scopeTeamUsers(users: readonly TeamUser[], access: DemoAccessScope): TeamUser[] {
  if (access.audience === 'partner') return [];
  return [...users];
}

/**
 * The whole book under a demo access scope, in one pass per collection.
 * Providers call the granular scopers above for the collections a query
 * actually reads; this composite exists for consumers (and tests) that need
 * the complete scoped projection at once.
 */
export function applyDemoAccessScope(
  collections: ScopeableCollections,
  access: DemoAccessScope,
): CanonicalCollections {
  return {
    partnerManagers: scopePartnerManagers(collections.partnerManagers, access),
    partners: scopePartners(collections.partners, access),
    registrations: scopeRegistrations(collections.registrations, collections.partners, access),
    opportunities: scopeOpportunities(collections.opportunities, collections.partners, access),
    targets: scopeTargets(collections.targets, collections.partners, access),
    activities: scopeActivities(collections.activities, collections.partners, access),
    certifications: scopeCertifications(collections.certifications, collections.partners, access),
    teamUsers: scopeTeamUsers(collections.teamUsers, access),
  };
}
