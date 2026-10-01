import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerCertification,
  PipelineSnapshot,
  ProviderBook,
  Target,
} from '../types';
import { MockDataProvider } from './MockDataProvider';
import { generateDashboardData } from './generate';

/** Copies of the mock book. 100× lands the demo near the mid-market tier of docs/migration-plan.md. */
export const DEFAULT_SCALE = 100;

/** What the scaled book weighs, for reporting rather than for rendering. */
export interface BookSize {
  partners: number;
  opportunities: number;
  snapshots: number;
  /** Approximate JSON bytes the browser would hold, sampled rather than serialized whole. */
  approxBytes: number;
}

/**
 * The mock book multiplied, to make the contract's claim measurable instead of
 * asserted: the scoped queries return the same small answers at 100× volume,
 * and there is no load-everything path left to grow with the book.
 *
 * What is scaled is the book — partners, opportunities, the weekly snapshots,
 * registrations, targets, activities, certifications. What is not is the
 * roster: the partner team stays five managers and one deal desk, because
 * scaling people would not change anything the seam ships. A manager simply
 * owns 100× the accounts, which is the situation the retired whole-book
 * contract failed on.
 *
 * Ids and account names carry a per-copy suffix so the copies stay distinct
 * rows; foreign keys are rewritten with the same suffix so each copy's
 * opportunities point at its own partners and snapshots.
 */
export class ScaleDataProvider extends MockDataProvider {
  readonly scale: number;
  readonly size: BookSize;

  constructor(scale: number = DEFAULT_SCALE, base: ProviderBook = generateDashboardData()) {
    const expanded = expandBook(base, scale);
    // Answers are stamped with the scaled identity, so metadata on screen can
    // never attribute a 100× figure to the local mock.
    super(expanded, { providerId: 'scaled' });
    this.scale = Math.max(1, Math.floor(scale));
    this.size = measureBook(expanded);
  }
}

/** `~2` for the second copy, empty for the original so ids stay recognisable. */
function copySuffix(index: number): string {
  return index === 0 ? '' : `~${index}`;
}

function expandBook(base: ProviderBook, scale: number): ProviderBook {
  const copies = Math.max(1, Math.floor(scale));
  if (copies === 1) return base;

  const partners: Partner[] = [];
  const opportunities: Opportunity[] = [];
  const snapshots: PipelineSnapshot[] = [];
  const registrations: DealRegistration[] = [];
  const targets: Target[] = [];
  const activities: ActivityMeeting[] = [];
  const certifications: PartnerCertification[] = [];

  for (let copy = 0; copy < copies; copy += 1) {
    const suffix = copySuffix(copy);
    const label = copy === 0 ? '' : ` · copy ${copy + 1}`;
    for (const partner of base.partners) {
      partners.push({ ...partner, id: `${partner.id}${suffix}`, name: `${partner.name}${label}` });
    }
    for (const opportunity of base.opportunities) {
      opportunities.push({
        ...opportunity,
        id: `${opportunity.id}${suffix}`,
        partnerId: `${opportunity.partnerId}${suffix}`,
        ...(opportunity.registrationId
          ? { registrationId: `${opportunity.registrationId}${suffix}` }
          : {}),
        accountName: `${opportunity.accountName}${label}`,
      });
    }
    for (const snapshot of base.snapshots) {
      snapshots.push({ ...snapshot, opportunityId: `${snapshot.opportunityId}${suffix}` });
    }
    for (const registration of base.registrations) {
      registrations.push({
        ...registration,
        id: `${registration.id}${suffix}`,
        partnerId: `${registration.partnerId}${suffix}`,
        // The account name carries the copy label too, or duplicate-account
        // groups would merge across copies and the scaled book would stop
        // being 100 disjoint copies.
        accountName: `${registration.accountName}${label}`,
        ...(registration.convertedTo
          ? { convertedTo: `${registration.convertedTo}${suffix}` }
          : {}),
      });
    }
    for (const target of base.targets) {
      targets.push({ ...target, partnerId: `${target.partnerId}${suffix}` });
    }
    for (const activity of base.activities) {
      activities.push({
        ...activity,
        id: `${activity.id}${suffix}`,
        partnerId: `${activity.partnerId}${suffix}`,
      });
    }
    for (const certification of base.certifications) {
      certifications.push({ ...certification, partnerId: `${certification.partnerId}${suffix}` });
    }
  }

  return {
    partnerManagers: base.partnerManagers,
    partners,
    registrations,
    opportunities,
    snapshots,
    targets,
    activities,
    certifications,
    teamUsers: base.teamUsers,
  };
}

function measureBook(data: ProviderBook): BookSize {
  return {
    partners: data.partners.length,
    opportunities: data.opportunities.length,
    snapshots: data.snapshots.length,
    approxBytes: estimateBytes(data.opportunities) + estimateBytes(data.snapshots),
  };
}

/**
 * Bytes as the browser would hold them, estimated from a sample. Serializing
 * 190,000 rows whole at startup to print a number would cost more than the
 * number is worth.
 */
function estimateBytes(rows: readonly unknown[]): number {
  if (rows.length === 0) return 0;
  const sample = rows.slice(0, 50);
  return Math.round((JSON.stringify(sample).length / sample.length) * rows.length);
}
