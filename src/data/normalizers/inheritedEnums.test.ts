import { describe, expect, it } from 'vitest';
import { normalizeCalendarEvent } from './calendar';
import { normalizeCrmExport } from './crm';
import { normalizeEnablementExport } from './enablement';
import {
  calendarEvents,
  crmExport,
  enablementRows,
  KNOWN_PARTNER_MANAGER_IDS,
  prmRegistrations,
} from './fixtures';
import { normalizePrmRegistrations } from './prm';
import type { NormalizationIssue } from './types';

const knownPartnerIds = new Set(['northwind', 'contoso']);
const crmContext = { knownPartnerManagerIds: KNOWN_PARTNER_MANAGER_IDS };
type EnumCase = {
  path: string;
  normalize: (value: string) => { accepted: number; issues: NormalizationIssue[] };
};

// Closed inventory of every required/optional mapped enum in the adapters.
const ENUM_CASES: EnumCase[] = [
  ...['Type', 'Tier__c', 'Region__c'].map((field) => ({
    path: `accounts[0].${field}`,
    normalize(value: string) {
      const result = normalizeCrmExport(
        {
          accounts: [Object.freeze({ ...crmExport.accounts[0]!, [field]: value })],
          opportunities: [],
        },
        crmContext,
      );
      return { accepted: result.partners.length, issues: result.issues };
    },
  })),
  ...['Revenue_Model__c', 'Stage_Name__c', 'Forecast_Category__c', 'Outcome__c'].map((field) => ({
    path: `opportunities[0].${field}`,
    normalize(value: string) {
      // Outcome uses a closed row so validation cannot reject it merely
      // because a close date is missing.
      const row = crmExport.opportunities[field === 'Outcome__c' ? 1 : 0]!;
      const result = normalizeCrmExport(
        {
          accounts: crmExport.accounts,
          opportunities: [Object.freeze({ ...row, [field]: value })],
        },
        crmContext,
      );
      return { accepted: result.opportunities.length, issues: result.issues };
    },
  })),
  {
    path: 'rows[0].status',
    normalize(value) {
      const result = normalizePrmRegistrations(
        [Object.freeze({ ...prmRegistrations[0]!, status: value })],
        { knownPartnerIds, knownOpportunityIds: new Set(['opp-1001', 'opp-1002']) },
      );
      return { accepted: result.records.length, issues: result.issues };
    },
  },
  {
    path: 'category',
    normalize(value) {
      const result = normalizeCalendarEvent(
        Object.freeze({ ...calendarEvents[0]!, category: value }),
        { knownPartnerIds, ...crmContext },
      );
      return { accepted: result.ok ? 1 : 0, issues: result.ok ? [] : result.issues };
    },
  },
  {
    path: 'rows[0].session_kind',
    normalize(value) {
      const result = normalizeEnablementExport(
        [Object.freeze({ ...enablementRows[0]!, session_kind: value })],
        { knownPartnerIds },
      );
      return { accepted: result.records.length, issues: result.issues };
    },
  },
];

describe('VAL-DATA-005: inherited keys are not declared source enum values', () => {
  it.each(
    ENUM_CASES.flatMap(({ path, normalize }) =>
      ['constructor', 'toString', '__proto__'].map((value) => ({ path, value, normalize })),
    ),
  )('rejects $value at $path without accepting a canonical row', ({ path, value, normalize }) => {
    const result = normalize(value);
    expect(result.accepted).toBe(0);
    expect(result.issues).toEqual([expect.objectContaining({ code: 'unknown-enum-value', path })]);
    expect(normalize(value)).toEqual(result);
  });
});
