import type { CalendarEventSource } from './calendar';
import type { CertificationRowSource } from './certifications';
import type { CrmAccountSource, CrmExport, CrmOpportunitySource } from './crm';
import type { EnablementRowSource } from './enablement';
import type { PrmRegistrationSource } from './prm';
import type { TargetRowSource } from './targets';

/**
 * Representative source records for the six demo adapters: the shapes the
 * real CRM, PRM, calendar, enablement, target, and certification exports are
 * expected to take — system-cased keys, source picklist labels, and ids the
 * source system owns. Tests build on them so every adapter's happy path and
 * its failures are exercised against the same small, human-readable corpus.
 * They are inputs to the pure adapters only; nothing fetches them from
 * anywhere.
 */

export const KNOWN_PARTNER_MANAGER_IDS: ReadonlySet<string> = new Set(['pm-ana', 'pm-luis']);

const crmAccounts: CrmAccountSource[] = [
  {
    Id: 'northwind',
    Name: 'Northwind Systems',
    Type: 'Reseller',
    Tier__c: 'Gold',
    Region__c: 'NA',
    Account_Manager__c: 'Kai Rocha',
    Partner_Manager__c: 'pm-ana',
    Joined_Date__c: '2025-02-10T09:00:00Z',
    Is_Prospect__c: false,
  },
  {
    Id: 'contoso',
    Name: 'Contoso Partners',
    Type: 'Integrator',
    Tier__c: 'Silver',
    Region__c: 'EMEA',
    Account_Manager__c: 'Maya Chen',
    Partner_Manager__c: 'pm-luis',
    Joined_Date__c: '2025-06-01T09:00:00Z',
    Is_Prospect__c: true,
  },
];

const crmOpportunities: CrmOpportunitySource[] = [
  {
    Id: 'opp-1001',
    Account_Id__c: 'northwind',
    End_Customer__c: 'Acme Corp',
    Factory_Account_Director__c: 'Dana Iyer',
    Revenue_Model__c: 'Sell With',
    Stage_Name__c: 'Vendor of Choice',
    Forecasted_Revenue__c: 240_000,
    Forecast_Category__c: 'Commit',
    Deal_Registration_Id__c: 'reg-501',
    Created_Date__c: '2025-11-03T10:00:00Z',
    Expected_Close_Date__c: '2026-03-15',
    Closed_Date__c: null,
    Outcome__c: null,
  },
  {
    Id: 'opp-1002',
    Account_Id__c: 'contoso',
    End_Customer__c: 'Globex',
    Factory_Account_Director__c: 'Ravi Patel',
    Revenue_Model__c: 'Sell To',
    Stage_Name__c: 'Deal Desk Review',
    Forecasted_Revenue__c: 96_000,
    Forecast_Category__c: null,
    Deal_Registration_Id__c: null,
    Created_Date__c: '2025-09-12T10:00:00Z',
    Expected_Close_Date__c: '2026-01-31',
    Closed_Date__c: '2026-01-28T16:00:00Z',
    Outcome__c: 'Won',
  },
];

export const crmExport: CrmExport = { accounts: crmAccounts, opportunities: crmOpportunities };

export const prmRegistrations: PrmRegistrationSource[] = [
  {
    registration_id: 'reg-501',
    partner_slug: 'northwind',
    end_customer: 'Acme Corp',
    deal_value: 240_000,
    submitted_at: '2026-02-01T08:00:00Z',
    status: 'approved',
    decided_at: '2026-02-03T17:00:00Z',
    decided_by: 'Dana Iyer',
    rejection_reason: null,
    opportunity_id: 'opp-1001',
  },
  {
    registration_id: 'reg-502',
    partner_slug: 'contoso',
    end_customer: 'Globex',
    deal_value: 40_000,
    submitted_at: '2026-02-10T08:00:00Z',
    status: 'submitted',
    decided_at: null,
    decided_by: null,
    rejection_reason: null,
    opportunity_id: null,
  },
];

export const calendarEvents: CalendarEventSource[] = [
  {
    event_id: 'evt-201',
    category: 'Discovery Call',
    partner_slug: 'northwind',
    partner_manager_id: 'pm-ana',
    start_at: '2026-02-20T14:30:00Z',
    all_day_date: null,
    duration_minutes: 45,
  },
  {
    event_id: 'evt-202',
    category: 'Technical Enablement',
    partner_slug: 'contoso',
    partner_manager_id: 'pm-luis',
    start_at: null,
    all_day_date: '2026-02-25',
    duration_minutes: 120,
  },
];

export const enablementRows: EnablementRowSource[] = [
  { partner_slug: 'northwind', session_kind: 'Technical Enablement' },
  { partner_slug: 'contoso', session_kind: 'GTM Enablement' },
];

export const targetRows: TargetRowSource[] = [
  { partner_slug: 'northwind', fiscal_period: 'FY27-Q1', quota_amount: 1_200_000 },
  { partner_slug: 'contoso', fiscal_period: 'FY27-Q1', quota_amount: 800_000 },
];

export const certificationRows: CertificationRowSource[] = [
  {
    partner_slug: 'northwind',
    strategists_certified: 3,
    strategists_goal: 2,
    engineers_certified: 1,
    engineers_goal: 2,
  },
  {
    partner_slug: 'contoso',
    strategists_certified: 0,
    strategists_goal: 1,
    engineers_certified: 2,
    engineers_goal: 2,
  },
];
