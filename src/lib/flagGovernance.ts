/**
 * Shared lifecycle governance for every feature flag, product or operational.
 *
 * A flag is temporary release machinery with an accountable owner and a
 * planned end, not permanent configuration. Every registry entry must carry
 * the full `FlagLifecycle`; `auditFlagLifecycle` is the deterministic policy
 * check that rejects missing metadata, missing ownership, and expired flags.
 * The function is pure — callers inject the `asOf` date so the check never
 * reads the wall clock and stays reproducible in tests and CI.
 */

type FlagEnvironment = 'development' | 'preview' | 'production';

export interface FlagLifecycle {
  /** Team or role accountable for the flag's decisions and removal. */
  owner: string;
  /** Why the flag exists and what behavior it gates. */
  purpose: string;
  /** Environments the flag is evaluated in. */
  environments: readonly FlagEnvironment[];
  /** Value used when no fresh or cached value can be trusted. */
  safeDefault: boolean;
  /** Observable condition under which rollout proceeds. */
  rolloutTrigger: string;
  /** Observable condition under which the flag returns to its safe default. */
  rollbackTrigger: string;
  /** ISO 8601 date of the next scheduled review. */
  reviewDate: string;
  /** ISO 8601 date after which the flag is stale and must be renewed or removed. */
  expiresAt: string;
  /** Condition that allows deleting the flag and its guarded code path. */
  removalCondition: string;
}

/**
 * The audit accepts a draft so it can report incomplete metadata; registries
 * declare the full `FlagLifecycle`, which is assignable to this shape.
 */
type FlagLifecycleDraft = {
  readonly [K in keyof FlagLifecycle]?: FlagLifecycle[K];
};

export interface GovernedFlag {
  key: string;
  lifecycle: FlagLifecycleDraft;
}

export interface FlagPolicyViolation {
  flagKey: string;
  field: keyof FlagLifecycle;
  problem: string;
}

/**
 * The date the checked-in registries were last reviewed. Policy tests audit
 * the shipped registries as of this fixed date so the suite stays
 * deterministic; bumping it is part of each governance review, the same
 * convention as ROADMAP_LAST_UPDATED.
 */
export const FLAG_GOVERNANCE_AS_OF = '2026-09-29T00:00:00.000Z';

const MIN_PURPOSE_LENGTH = 20;

const REQUIRED_TEXT_FIELDS: readonly {
  field: keyof FlagLifecycle;
  problem: string;
}[] = [
  { field: 'owner', problem: 'missing owner' },
  { field: 'rolloutTrigger', problem: 'missing rollout trigger' },
  { field: 'rollbackTrigger', problem: 'missing rollback trigger' },
  { field: 'removalCondition', problem: 'missing removal condition' },
];

/**
 * ISO 8601 calendar date, or UTC date-time. Date-only and `Z`-suffixed forms
 * only: an offset-less time would parse in the local timezone, which is
 * non-deterministic across machines, and `Date.parse` alone accepts non-ISO
 * prose ('December 31, 2026') and rolls impossible days ('2026-02-30') into
 * the next month — both must fail the 'not an ISO 8601 date' check.
 */
const ISO_8601_DATE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;

function parseIsoDate(value: string | undefined): number | undefined {
  if (value === undefined || !ISO_8601_DATE.test(value)) return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  // Reject impossible calendar days that Date.parse silently rolls over.
  if (new Date(parsed).toISOString().slice(0, 10) !== value.slice(0, 10)) return undefined;
  return parsed;
}

/**
 * Audits every flag against the lifecycle contract. Missing metadata and
 * missing ownership fail field by field; a flag whose expiry is at or before
 * `asOf` fails as expired. Deterministic for the same inputs and `asOf`.
 */
export function auditFlagLifecycle(
  flags: readonly GovernedFlag[],
  asOf: Date,
): FlagPolicyViolation[] {
  const violations: FlagPolicyViolation[] = [];

  for (const { key, lifecycle } of flags) {
    const fail = (field: keyof FlagLifecycle, problem: string) =>
      violations.push({ flagKey: key, field, problem });

    for (const { field, problem } of REQUIRED_TEXT_FIELDS) {
      const value = lifecycle[field];
      if (typeof value !== 'string' || !value.trim()) fail(field, problem);
    }
    if ((lifecycle.purpose?.trim().length ?? 0) < MIN_PURPOSE_LENGTH) {
      fail('purpose', 'purpose missing or too short to explain the gated behavior');
    }
    if (!lifecycle.environments || lifecycle.environments.length === 0) {
      fail('environments', 'no environment scope declared');
    }
    if (typeof lifecycle.safeDefault !== 'boolean') fail('safeDefault', 'missing safe default');

    const review = parseIsoDate(lifecycle.reviewDate);
    const expiry = parseIsoDate(lifecycle.expiresAt);
    if (review === undefined) fail('reviewDate', 'review date missing or not an ISO 8601 date');
    if (expiry === undefined) {
      fail('expiresAt', 'expiry missing or not an ISO 8601 date');
    } else if (expiry <= asOf.getTime()) {
      fail('expiresAt', `flag expired on ${lifecycle.expiresAt}`);
    }
    if (review !== undefined && expiry !== undefined && review > expiry) {
      fail('reviewDate', 'review is scheduled after the flag expires');
    }
  }

  return violations;
}
