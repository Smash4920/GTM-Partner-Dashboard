import type { Target } from '../types';
import type { NormalizationIssue, SourceProvenance } from './types';
import { asRecord, issue, malformedRecord, readForeignKey, readMoney } from './validate';

/**
 * Targets adapter: the representative quota export a planning system would
 * deliver, normalized to canonical per-partner quarter targets. A target is
 * three facts — whose, which quarter, how much — and all three are strict:
 * the partner must be one the caller knows, the quarter must be a fiscal
 * quarter label, and the amount must be finite and non-negative. A target
 * with no quarter is a number with no clock, so it fails rather than
 * landing in whatever quarter is current.
 */

export interface TargetRowSource {
  partner_slug: string;
  fiscal_period: string;
  quota_amount: number;
}

export interface TargetsContext {
  knownPartnerIds: ReadonlySet<string>;
}

/** Fiscal quarter label, e.g. `FY27-Q3`. Same shape as the book's quarters. */
const FISCAL_QUARTER = /^FY\d{2}-Q[1-4]$/;

export interface TargetsNormalized {
  records: { record: Target; provenance: SourceProvenance }[];
  issues: NormalizationIssue[];
}

export function normalizeTargetsExport(input: unknown, context: TargetsContext): TargetsNormalized {
  const issues: NormalizationIssue[] = [];
  const records: TargetsNormalized['records'] = [];
  if (!Array.isArray(input)) {
    issues.push(malformedRecord('$', 'an array of target rows'));
    return { records, issues };
  }
  const seen = new Set<string>();
  for (const [index, row] of input.entries()) {
    const source = asRecord(row);
    if (source === null) {
      issues.push(malformedRecord(`rows[${index}]`, 'a target object'));
      continue;
    }
    const path = (field: string) => `rows[${index}].${field}`;
    const partnerId = readForeignKey(
      source,
      'partner_slug',
      context.knownPartnerIds,
      issues,
      path('partner_slug'),
    );
    const quarterRaw = source['fiscal_period'];
    let quarter: string | undefined;
    if (quarterRaw === undefined || quarterRaw === null) {
      issue(
        issues,
        'missing-field',
        path('fiscal_period'),
        'expected a fiscal quarter label (FY27-Q1)',
      );
    } else if (typeof quarterRaw !== 'string' || !FISCAL_QUARTER.test(quarterRaw)) {
      issue(
        issues,
        'invalid-string',
        path('fiscal_period'),
        'expected a fiscal quarter label (FY27-Q1)',
      );
    } else {
      quarter = quarterRaw;
    }
    const revenueTarget = readMoney(source, 'quota_amount', issues, path('quota_amount'));
    if (partnerId === undefined || quarter === undefined || revenueTarget === undefined) continue;
    const key = `${partnerId}:${quarter}`;
    if (seen.has(key)) {
      issue(
        issues,
        'duplicate-record',
        path('fiscal_period'),
        'this partner already has a target for the quarter',
      );
      continue;
    }
    seen.add(key);
    records.push({
      record: { partnerId, quarter, revenueTarget },
      provenance: {
        source: 'targets',
        sourceRecordId: key,
        fields: ['fiscal_period', 'partner_slug', 'quota_amount'],
      },
    });
  }
  return { records, issues };
}
