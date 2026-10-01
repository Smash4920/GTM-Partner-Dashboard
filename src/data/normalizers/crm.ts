import type { Opportunity, Partner } from '../types';
import type { NormalizationIssue, SourceProvenance } from './types';
import {
  asRecord,
  issue,
  malformedRecord,
  readEnum,
  readForeignKey,
  readIdentifier,
  readIsoDate,
  readIsoTimestamp,
  readMoney,
  readOptionalEnum,
  readOptionalIsoTimestamp,
  readString,
} from './validate';

/**
 * CRM adapter: the representative account/opportunity export a CRM would
 * deliver (Salesforce-flavored: `__c` custom fields, picklist labels,
 * account ids nested under opportunities), normalized to canonical partners
 * and opportunities.
 *
 * None of that shape reaches the canonical model — the picklists map through
 * declared tables and the keys rename. In this demo the CRM's stable ids
 * become the canonical ids directly; a production pipeline would mint
 * surrogate keys and keep these as lineage. Because every id is
 * source-supplied, the output is a deterministic function of the input: run
 * the same export twice and the canonical records, and their ids, are
 * identical.
 */

export interface CrmAccountSource {
  Id: string;
  Name: string;
  Type: 'Reseller' | 'Agency' | 'MSP' | 'Integrator' | 'Referral';
  Tier__c: 'Platinum' | 'Gold' | 'Silver' | 'Registered';
  Region__c: 'NA' | 'EMEA' | 'APAC' | 'LATAM';
  Account_Manager__c: string;
  Partner_Manager__c: string;
  Joined_Date__c: string;
  Is_Prospect__c: boolean;
}

export interface CrmOpportunitySource {
  Id: string;
  Account_Id__c: string;
  End_Customer__c: string;
  Factory_Account_Director__c: string;
  Revenue_Model__c: 'Sell To' | 'Sell With' | 'Allocate';
  Stage_Name__c:
    | 'Discovery'
    | 'Scope'
    | 'Tech Validation'
    | 'Business Case'
    | 'Vendor of Choice'
    | 'Deal Desk Review';
  Forecasted_Revenue__c: number;
  Forecast_Category__c: 'Commit' | 'Best Case' | 'Pipeline' | 'Long Shot' | null;
  Deal_Registration_Id__c: string | null;
  Created_Date__c: string;
  Expected_Close_Date__c: string;
  Closed_Date__c: string | null;
  Outcome__c: 'Won' | 'Lost' | null;
}

export interface CrmExport {
  accounts: unknown[];
  opportunities: unknown[];
}

export interface CrmContext {
  /** Partner-manager ids the export may reference from account rows. */
  knownPartnerManagerIds: ReadonlySet<string>;
}

const PARTNER_TYPE: Record<string, Partner['type']> = {
  Reseller: 'reseller',
  Agency: 'agency',
  MSP: 'msp',
  Integrator: 'integrator',
  Referral: 'referral',
};

const TIER: Record<string, Partner['tier']> = {
  Platinum: 'platinum',
  Gold: 'gold',
  Silver: 'silver',
  Registered: 'registered',
};

const REGION: Record<string, Partner['region']> = {
  NA: 'na',
  EMEA: 'emea',
  APAC: 'apac',
  LATAM: 'latam',
};

const REVENUE_MODEL: Record<string, Opportunity['oppType']> = {
  'Sell To': 'sell-to',
  'Sell With': 'sell-with',
  Allocate: 'allocate',
};

const STAGE_NAME: Record<string, Opportunity['stage']> = {
  Discovery: 'discovery',
  Scope: 'scope',
  'Tech Validation': 'tech-validation',
  'Business Case': 'business-case',
  'Vendor of Choice': 'vendor-of-choice',
  'Deal Desk Review': 'deal-desk-review',
};

const FORECAST_CATEGORY: Record<string, NonNullable<Opportunity['forecastCategory']>> = {
  Commit: 'commit',
  'Best Case': 'best-case',
  Pipeline: 'pipeline',
  'Long Shot': 'long-shot',
};

const OUTCOME: Record<string, NonNullable<Opportunity['outcome']>> = {
  Won: 'won',
  Lost: 'lost',
};

export interface CrmNormalized {
  partners: { record: Partner; provenance: SourceProvenance }[];
  opportunities: { record: Opportunity; provenance: SourceProvenance }[];
  issues: NormalizationIssue[];
}

function normalizeAccount(
  input: unknown,
  index: number,
  context: CrmContext,
  issues: NormalizationIssue[],
): { record: Partner; provenance: SourceProvenance } | undefined {
  const source = asRecord(input);
  if (source === null) {
    issues.push(malformedRecord(`accounts[${index}]`, 'an account object'));
    return undefined;
  }
  const path = (field: string) => `accounts[${index}].${field}`;
  const id = readIdentifier(source, 'Id', issues, path('Id'));
  const name = readString(source, 'Name', issues, path('Name'));
  const type = readEnum(source, 'Type', PARTNER_TYPE, issues, path('Type'));
  const tier = readEnum(source, 'Tier__c', TIER, issues, path('Tier__c'));
  const region = readEnum(source, 'Region__c', REGION, issues, path('Region__c'));
  const accountManager = readString(
    source,
    'Account_Manager__c',
    issues,
    path('Account_Manager__c'),
  );
  const partnerManagerId = readForeignKey(
    source,
    'Partner_Manager__c',
    context.knownPartnerManagerIds,
    issues,
    path('Partner_Manager__c'),
  );
  const joinedAt = readIsoTimestamp(source, 'Joined_Date__c', issues, path('Joined_Date__c'));
  const prospectRaw = source['Is_Prospect__c'];
  if (typeof prospectRaw !== 'boolean') {
    issue(
      issues,
      prospectRaw === undefined || prospectRaw === null ? 'missing-field' : 'invalid-string',
      path('Is_Prospect__c'),
      'expected a boolean',
    );
  }
  if (
    id === undefined ||
    name === undefined ||
    type === undefined ||
    tier === undefined ||
    region === undefined ||
    accountManager === undefined ||
    partnerManagerId === undefined ||
    joinedAt === undefined ||
    typeof prospectRaw !== 'boolean'
  ) {
    return undefined;
  }
  const record: Partner = {
    id,
    name,
    type,
    tier,
    region,
    accountManager,
    partnerManagerId,
    joinedAt,
  };
  if (prospectRaw) record.prospect = true;
  return {
    record,
    provenance: {
      source: 'crm',
      sourceRecordId: id,
      fields: [
        'Account_Manager__c',
        'Id',
        'Is_Prospect__c',
        'Joined_Date__c',
        'Name',
        'Partner_Manager__c',
        'Region__c',
        'Tier__c',
        'Type',
      ],
    },
  };
}

function normalizeOpportunity(
  input: unknown,
  index: number,
  knownPartnerIds: ReadonlySet<string>,
  issues: NormalizationIssue[],
): { record: Opportunity; provenance: SourceProvenance } | undefined {
  const source = asRecord(input);
  if (source === null) {
    issues.push(malformedRecord(`opportunities[${index}]`, 'an opportunity object'));
    return undefined;
  }
  const path = (field: string) => `opportunities[${index}].${field}`;
  const id = readIdentifier(source, 'Id', issues, path('Id'));
  const partnerId = readForeignKey(
    source,
    'Account_Id__c',
    knownPartnerIds,
    issues,
    path('Account_Id__c'),
  );
  const accountName = readString(source, 'End_Customer__c', issues, path('End_Customer__c'));
  const factoryAccountDirector = readString(
    source,
    'Factory_Account_Director__c',
    issues,
    path('Factory_Account_Director__c'),
  );
  const oppType = readEnum(
    source,
    'Revenue_Model__c',
    REVENUE_MODEL,
    issues,
    path('Revenue_Model__c'),
  );
  const stage = readEnum(source, 'Stage_Name__c', STAGE_NAME, issues, path('Stage_Name__c'));
  const forecastedRevenue = readMoney(
    source,
    'Forecasted_Revenue__c',
    issues,
    path('Forecasted_Revenue__c'),
  );
  // The four optional reads below may push issues for a malformed PRESENT
  // value; the guard after the required fields rejects the row when one
  // did. Counting from here keeps required-field failures (already fatal
  // on their own) out of the comparison.
  const issuesBeforeOptionalReads = issues.length;
  const forecastCategory = readOptionalEnum(
    source,
    'Forecast_Category__c',
    FORECAST_CATEGORY,
    issues,
    path('Forecast_Category__c'),
  );
  // Deal-registration ids are a foreign namespace owned by the PRM export;
  // the CRM adapter validates the shape and leaves cross-system
  // reconciliation to the merge step that has both exports in hand.
  const registrationIdRaw = source['Deal_Registration_Id__c'];
  const registrationId =
    registrationIdRaw === undefined || registrationIdRaw === null
      ? undefined
      : readIdentifier(source, 'Deal_Registration_Id__c', issues, path('Deal_Registration_Id__c'));
  const createdAt = readIsoTimestamp(source, 'Created_Date__c', issues, path('Created_Date__c'));
  const expectedCloseDate = readIsoDate(
    source,
    'Expected_Close_Date__c',
    issues,
    path('Expected_Close_Date__c'),
  );
  const closedAt = readOptionalIsoTimestamp(
    source,
    'Closed_Date__c',
    issues,
    path('Closed_Date__c'),
  );
  const outcome = readOptionalEnum(source, 'Outcome__c', OUTCOME, issues, path('Outcome__c'));
  if (
    id === undefined ||
    partnerId === undefined ||
    accountName === undefined ||
    factoryAccountDirector === undefined ||
    oppType === undefined ||
    stage === undefined ||
    forecastedRevenue === undefined ||
    createdAt === undefined ||
    expectedCloseDate === undefined
  ) {
    return undefined;
  }
  // Any malformed present optional field fails the whole row: emitting the
  // record without the field would present a partially-normalized row as a
  // clean one — a dropped Close Date or a shrugged-off Forecast Category
  // is not the same deal the CRM described. Absent or null stays a
  // legitimate "not set".
  if (issues.length > issuesBeforeOptionalReads) {
    return undefined;
  }
  // A closed deal carries both facts or neither: an outcome with no close
  // date (or a close date with no outcome) is a contradiction the source
  // must fix, not a state the adapter may round into something plausible.
  if ((outcome === undefined) !== (closedAt === undefined)) {
    issue(
      issues,
      'inconsistent-state',
      path('Outcome__c'),
      'a closed opportunity must carry both Closed_Date__c and Outcome__c, or neither',
    );
    return undefined;
  }
  const record: Opportunity = {
    id,
    partnerId,
    accountName,
    factoryAccountDirector,
    oppType,
    stage,
    forecastedRevenue,
    createdAt,
    expectedCloseDate,
  };
  if (forecastCategory !== undefined) record.forecastCategory = forecastCategory;
  if (registrationId !== undefined) record.registrationId = registrationId;
  if (closedAt !== undefined && outcome !== undefined) {
    record.closedAt = closedAt;
    record.outcome = outcome;
  }
  return {
    record,
    provenance: {
      source: 'crm',
      sourceRecordId: id,
      fields: [
        'Account_Id__c',
        'Closed_Date__c',
        'Created_Date__c',
        'End_Customer__c',
        'Expected_Close_Date__c',
        'Factory_Account_Director__c',
        'Forecast_Category__c',
        'Forecasted_Revenue__c',
        'Id',
        'Outcome__c',
        'Revenue_Model__c',
        'Stage_Name__c',
      ],
    },
  };
}

/**
 * Normalize a CRM export. Accounts are validated first so opportunity
 * account references are checked against exactly the partners this export
 * produced — an opportunity naming an account the export does not carry is
 * an `unknown-foreign-key` failure, not a partner invented on the spot.
 */
export function normalizeCrmExport(input: unknown, context: CrmContext): CrmNormalized {
  const issues: NormalizationIssue[] = [];
  const partners: CrmNormalized['partners'] = [];
  const opportunities: CrmNormalized['opportunities'] = [];
  const source = asRecord(input);
  const accountInputs = source?.['accounts'];
  const opportunityInputs = source?.['opportunities'];
  if (source === null || !Array.isArray(accountInputs) || !Array.isArray(opportunityInputs)) {
    issues.push(malformedRecord('$', 'a CRM export object with accounts and opportunities arrays'));
    return { partners, opportunities, issues };
  }
  const seenPartnerIds = new Set<string>();
  for (const [index, account] of accountInputs.entries()) {
    const normalized = normalizeAccount(account, index, context, issues);
    if (normalized === undefined) continue;
    if (seenPartnerIds.has(normalized.record.id)) {
      issue(
        issues,
        'duplicate-record',
        `accounts[${index}].Id`,
        'an account with this id is already in the export',
      );
      continue;
    }
    seenPartnerIds.add(normalized.record.id);
    partners.push(normalized);
  }
  const seenOpportunityIds = new Set<string>();
  for (const [index, opportunity] of opportunityInputs.entries()) {
    const normalized = normalizeOpportunity(opportunity, index, seenPartnerIds, issues);
    if (normalized === undefined) continue;
    if (seenOpportunityIds.has(normalized.record.id)) {
      issue(
        issues,
        'duplicate-record',
        `opportunities[${index}].Id`,
        'an opportunity with this id is already in the export',
      );
      continue;
    }
    seenOpportunityIds.add(normalized.record.id);
    opportunities.push(normalized);
  }
  return { partners, opportunities, issues };
}
