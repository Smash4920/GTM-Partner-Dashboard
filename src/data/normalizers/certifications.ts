import type { PartnerCertification } from '../types';
import type { NormalizationIssue, SourceProvenance } from './types';
import { asRecord, issue, malformedRecord, readCount, readForeignKey } from './validate';

/**
 * Certifications adapter: the representative credential-registry export a
 * certification system would deliver, normalized to canonical per-partner
 * certification standing — certified counts against goals, split into the
 * strategist and engineer tracks.
 *
 * These rows are partner-facing evidence, so the partner reference is
 * validated against the caller's known partners, and a partner may appear
 * once: two rows for one partner are a duplicate export, not a sum the
 * adapter gets to invent. A certified count above the goal is valid
 * (over-achievement is real); a negative or fractional count is not.
 */

export interface CertificationRowSource {
  partner_slug: string;
  strategists_certified: number;
  strategists_goal: number;
  engineers_certified: number;
  engineers_goal: number;
}

export interface CertificationsContext {
  knownPartnerIds: ReadonlySet<string>;
}

export interface CertificationsNormalized {
  records: { record: PartnerCertification; provenance: SourceProvenance }[];
  issues: NormalizationIssue[];
}

export function normalizeCertificationsExport(
  input: unknown,
  context: CertificationsContext,
): CertificationsNormalized {
  const issues: NormalizationIssue[] = [];
  const records: CertificationsNormalized['records'] = [];
  if (!Array.isArray(input)) {
    issues.push(malformedRecord('$', 'an array of certification rows'));
    return { records, issues };
  }
  const seen = new Set<string>();
  for (const [index, row] of input.entries()) {
    const source = asRecord(row);
    if (source === null) {
      issues.push(malformedRecord(`rows[${index}]`, 'a certification object'));
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
    const strategistsCertified = readCount(
      source,
      'strategists_certified',
      issues,
      path('strategists_certified'),
    );
    const strategistsGoal = readCount(source, 'strategists_goal', issues, path('strategists_goal'));
    const engineersCertified = readCount(
      source,
      'engineers_certified',
      issues,
      path('engineers_certified'),
    );
    const engineersGoal = readCount(source, 'engineers_goal', issues, path('engineers_goal'));
    if (
      partnerId === undefined ||
      strategistsCertified === undefined ||
      strategistsGoal === undefined ||
      engineersCertified === undefined ||
      engineersGoal === undefined
    ) {
      continue;
    }
    if (seen.has(partnerId)) {
      issue(
        issues,
        'duplicate-record',
        path('partner_slug'),
        'this partner already has a certification row',
      );
      continue;
    }
    seen.add(partnerId);
    records.push({
      record: {
        partnerId,
        partnerStrategistsCertified: strategistsCertified,
        partnerStrategistsGoal: strategistsGoal,
        partnerEngineersCertified: engineersCertified,
        partnerEngineersGoal: engineersGoal,
      },
      provenance: {
        source: 'certifications',
        sourceRecordId: partnerId,
        fields: [
          'engineers_certified',
          'engineers_goal',
          'partner_slug',
          'strategists_certified',
          'strategists_goal',
        ],
      },
    });
  }
  return { records, issues };
}
