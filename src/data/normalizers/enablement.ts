import type { MeetingClassification } from '../types';
import type { NormalizationIssue, SourceProvenance } from './types';
import { asRecord, issue, malformedRecord, readEnum, readForeignKey } from './validate';

/**
 * Enablement adapter: the representative classification export an enablement
 * system would deliver — which partner a technical- or GTM-enablement
 * session was with — normalized to canonical meeting classifications.
 *
 * The export is narrow on purpose: an enablement system only ever reports
 * enablement sessions, so its kind table contains exactly the two canonical
 * enablement meeting types, and anything else (a discovery call misfiled as
 * enablement, an unrecognized label) is a failure rather than a guessed
 * classification. A (partner, kind) pair may appear once; a repeat is a
 * duplicate export row, not a second classification.
 */

export interface EnablementRowSource {
  partner_slug: string;
  session_kind: 'Technical Enablement' | 'GTM Enablement';
}

export interface EnablementContext {
  knownPartnerIds: ReadonlySet<string>;
}

const SESSION_KIND: Record<string, MeetingClassification['type']> = {
  'Technical Enablement': 'technical-enablement',
  'GTM Enablement': 'gtm-enablement',
};

export interface EnablementNormalized {
  records: { record: MeetingClassification; provenance: SourceProvenance }[];
  issues: NormalizationIssue[];
}

export function normalizeEnablementExport(
  input: unknown,
  context: EnablementContext,
): EnablementNormalized {
  const issues: NormalizationIssue[] = [];
  const records: EnablementNormalized['records'] = [];
  if (!Array.isArray(input)) {
    issues.push(malformedRecord('$', 'an array of enablement classification rows'));
    return { records, issues };
  }
  const seen = new Set<string>();
  for (const [index, row] of input.entries()) {
    const source = asRecord(row);
    if (source === null) {
      issues.push(malformedRecord(`rows[${index}]`, 'an enablement classification object'));
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
    const type = readEnum(source, 'session_kind', SESSION_KIND, issues, path('session_kind'));
    if (partnerId === undefined || type === undefined) continue;
    const key = `${partnerId}:${type}`;
    if (seen.has(key)) {
      issue(
        issues,
        'duplicate-record',
        `rows[${index}]`,
        'this partner and session kind are already classified',
      );
      continue;
    }
    seen.add(key);
    records.push({
      record: { partnerId, type },
      provenance: {
        source: 'enablement',
        sourceRecordId: key,
        fields: ['partner_slug', 'session_kind'],
      },
    });
  }
  return { records, issues };
}
