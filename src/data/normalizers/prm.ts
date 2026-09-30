import type { DealRegistration } from '../types';
import type { NormalizationIssue, SourceProvenance } from './types';
import {
  asRecord,
  issue,
  malformedRecord,
  readEnum,
  readForeignKey,
  readIdentifier,
  readIsoTimestamp,
  readMoney,
  readOptionalIsoTimestamp,
  readOptionalString,
  readString,
} from './validate';

/**
 * PRM adapter: the representative deal-registration export a partner
 * relationship platform would deliver, normalized to canonical
 * registrations. The partner foreign key is checked against the known
 * partners the caller supplies — a registration with no known partner is
 * not a registration.
 *
 * Conflicts are deliberately *not* a field here. Whether two registrations
 * conflict is derived at query time from overlapping accounts
 * (`duplicateRegistrationGroups` in src/lib/metrics.ts), so the adapter
 * validates the submission, the decision, and the amounts, and never stores
 * a conflict flag that could drift from the accounts it was computed from.
 */

export interface PrmRegistrationSource {
  registration_id: string;
  partner_slug: string;
  end_customer: string;
  deal_value: number;
  submitted_at: string;
  status: 'submitted' | 'approved' | 'rejected';
  decided_at: string | null;
  decided_by: string | null;
  rejection_reason: string | null;
  opportunity_id: string | null;
}

export interface PrmContext {
  knownPartnerIds: ReadonlySet<string>;
  /** Opportunity ids an approved registration may point at once converted. */
  knownOpportunityIds: ReadonlySet<string>;
}

const REGISTRATION_STATUS: Record<string, DealRegistration['status']> = {
  submitted: 'pending',
  approved: 'approved',
  rejected: 'rejected',
};

export interface PrmNormalized {
  records: { record: DealRegistration; provenance: SourceProvenance }[];
  issues: NormalizationIssue[];
}

/**
 * A decision is one fact with three parts: the state, the instant, and the
 * decider. Any subset is a contradiction the source must fix — an approved
 * registration with no decision time is not "approved recently". Returns
 * undefined (with an issue recorded) when the combination is contradictory.
 */
function readDecision(
  source: Record<string, unknown>,
  status: DealRegistration['status'],
  issues: NormalizationIssue[],
  path: (field: string) => string,
): Pick<DealRegistration, 'decisionAt' | 'decidedBy' | 'reason'> | undefined {
  const decisionAt = readOptionalIsoTimestamp(source, 'decided_at', issues, path('decided_at'));
  const decidedBy = readOptionalString(source, 'decided_by', issues, path('decided_by'));
  const reason = readOptionalString(source, 'rejection_reason', issues, path('rejection_reason'));
  if (status === 'pending' && decisionAt !== undefined) {
    issue(
      issues,
      'inconsistent-state',
      path('decided_at'),
      'a pending registration cannot carry a decision time',
    );
    return undefined;
  }
  if (status !== 'pending' && (decisionAt === undefined || decidedBy === undefined)) {
    issue(
      issues,
      'inconsistent-state',
      path('decided_at'),
      'a decided registration must carry decided_at and decided_by',
    );
    return undefined;
  }
  if (status === 'rejected' && reason === undefined) {
    issue(
      issues,
      'inconsistent-state',
      path('rejection_reason'),
      'a rejected registration must carry its reason',
    );
    return undefined;
  }
  const decision: Pick<DealRegistration, 'decisionAt' | 'decidedBy' | 'reason'> = {};
  if (decisionAt !== undefined) decision.decisionAt = decisionAt;
  if (decidedBy !== undefined) decision.decidedBy = decidedBy;
  if (reason !== undefined) decision.reason = reason;
  return decision;
}

function normalizeRegistration(
  input: unknown,
  index: number,
  context: PrmContext,
  issues: NormalizationIssue[],
): { record: DealRegistration; provenance: SourceProvenance } | undefined {
  const source = asRecord(input);
  if (source === null) {
    issues.push(malformedRecord(`rows[${index}]`, 'a registration object'));
    return undefined;
  }
  const path = (field: string) => `rows[${index}].${field}`;
  const id = readIdentifier(source, 'registration_id', issues, path('registration_id'));
  const partnerId = readForeignKey(
    source,
    'partner_slug',
    context.knownPartnerIds,
    issues,
    path('partner_slug'),
  );
  const accountName = readString(source, 'end_customer', issues, path('end_customer'));
  const amount = readMoney(source, 'deal_value', issues, path('deal_value'));
  const submittedAt = readIsoTimestamp(source, 'submitted_at', issues, path('submitted_at'));
  const status = readEnum(source, 'status', REGISTRATION_STATUS, issues, path('status'));
  const convertedRaw = source['opportunity_id'];
  const convertedTo =
    convertedRaw === undefined || convertedRaw === null
      ? undefined
      : readForeignKey(
          source,
          'opportunity_id',
          context.knownOpportunityIds,
          issues,
          path('opportunity_id'),
        );
  if (
    id === undefined ||
    partnerId === undefined ||
    accountName === undefined ||
    amount === undefined ||
    submittedAt === undefined ||
    status === undefined
  ) {
    return undefined;
  }
  const decision = readDecision(source, status, issues, path);
  if (decision === undefined) return undefined;
  if (convertedRaw !== undefined && convertedRaw !== null && convertedTo === undefined) {
    return undefined;
  }
  const record: DealRegistration = {
    id,
    partnerId,
    accountName,
    amount,
    submittedAt,
    status,
    ...decision,
  };
  if (convertedTo !== undefined) record.convertedTo = convertedTo;
  return {
    record,
    provenance: {
      source: 'prm',
      sourceRecordId: id,
      fields: [
        'deal_value',
        'decided_at',
        'decided_by',
        'end_customer',
        'opportunity_id',
        'partner_slug',
        'registration_id',
        'rejection_reason',
        'status',
        'submitted_at',
      ],
    },
  };
}

/**
 * Normalize a PRM registration export (an array of registration rows).
 * Failures are collected per row in export order; a duplicate registration
 * id rejects the later row, so the surviving set is deterministic.
 */
export function normalizePrmRegistrations(input: unknown, context: PrmContext): PrmNormalized {
  const issues: NormalizationIssue[] = [];
  const records: PrmNormalized['records'] = [];
  if (!Array.isArray(input)) {
    issues.push(malformedRecord('$', 'an array of registration rows'));
    return { records, issues };
  }
  const seen = new Set<string>();
  for (const [index, row] of input.entries()) {
    const normalized = normalizeRegistration(row, index, context, issues);
    if (normalized === undefined) continue;
    if (seen.has(normalized.record.id)) {
      issue(
        issues,
        'duplicate-record',
        `rows[${index}].registration_id`,
        'a registration with this id is already in the export',
      );
      continue;
    }
    seen.add(normalized.record.id);
    records.push(normalized);
  }
  return { records, issues };
}
