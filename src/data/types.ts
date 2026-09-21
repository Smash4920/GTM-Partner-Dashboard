/**
 * Canonical data model for the GTM Partner Dashboard.
 *
 * Everything the UI renders flows through these shapes via the DataProvider
 * interface (src/data/DataProvider.ts). A seeded mock generator fills them
 * today; a CRM-backed provider can fill the exact same shapes tomorrow
 * without any view code changing. See README "Data contract".
 */

export type PartnerType = 'reseller' | 'agency' | 'msp' | 'integrator' | 'referral';
export type PartnerTier = 'platinum' | 'gold' | 'silver' | 'registered';
export type Region = 'na' | 'emea' | 'apac' | 'latam';

export interface PartnerManager {
  id: string;
  name: string;
}

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  tier: PartnerTier;
  region: Region;
  accountManager: string;
  /** Salesforce Account.Partner_Manager__c relationship. */
  partnerManagerId: string;
  joinedAt: string; // ISO 8601
  /** True for prospective partners added from the Log Meetings calendar. */
  prospect?: boolean;
}

export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

/** A partner-submitted deal registration awaiting or carrying an ops decision. */
export interface DealRegistration {
  id: string;
  partnerId: string;
  accountName: string;
  amount: number;
  submittedAt: string; // ISO 8601
  status: RegistrationStatus;
  decisionAt?: string; // set once approved or rejected
  decidedBy?: string;
  reason?: string; // rejection reason
  convertedTo?: string; // opportunity id once converted
}

export type OpportunityStage =
  | 'discovery'
  | 'scope'
  | 'tech-validation'
  | 'business-case'
  | 'vendor-of-choice'
  | 'deal-desk-review';

/**
 * How revenue is attributed to the partner:
 * - sell-to:   your company sells directly to the partner (partner is the customer)
 * - sell-with: co-sell; the partner is attached to a deal with an end customer
 * - allocate:  allocated revenue / committed-spend drawdown attributed to the partner
 *
 * The partner-facing view intentionally excludes Sell To.
 */
export type OpportunityType = 'sell-to' | 'sell-with' | 'allocate';

export type OpportunityOutcome = 'won' | 'lost';

export interface Opportunity {
  id: string;
  partnerId: string;
  registrationId?: string; // set when the opp came from an approved deal registration
  accountName: string;
  /** Salesforce Opportunity.Account.Name, shown as Client in the portal. */
  factoryAccountDirector: string;
  oppType: OpportunityType;
  stage: OpportunityStage;
  /** Salesforce Opportunity.Forecasted_Revenue__c. */
  forecastedRevenue: number;
  createdAt: string; // ISO 8601
  expectedCloseDate: string; // ISO 8601
  closedAt?: string; // set once closed (won or lost)
  outcome?: OpportunityOutcome;
  /** Free-form note left by a partner manager; edited in-app, shown on hover. */
  notes?: string;
}

/** Revenue target for one partner for one quarter. */
export interface Target {
  partnerId: string;
  quarter: string; // e.g. 'FY27-Q3'
  revenueTarget: number;
}

export type MeetingType =
  | 'discovery'
  | 'pio-interlock'
  | 'pao-interlock'
  | 'interlock-cadence'
  | 'deal-support'
  | 'technical-enablement'
  | 'gtm-enablement'
  | 'partner-cadence';

/**
 * A partner manager's manual classification of a calendar meeting. In the
 * mock the Google Calendar sync is faked; once imported, the manager picks the
 * partner and call type per event, and the weekly goal counts those picks.
 */
export interface MeetingClassification {
  partnerId: string;
  type: MeetingType;
}

export type FiscalPhase = 'fy' | 'q1' | 'q2' | 'q3' | 'q4';

/** Calendar activity synced from Google Calendar in a future implementation. */
export interface ActivityMeeting {
  id: string;
  partnerId: string;
  partnerManagerId: string;
  type: MeetingType;
  occurredAt: string; // ISO 8601
  durationMinutes: number;
}

export interface PartnerCertification {
  partnerId: string;
  partnerStrategistsCertified: number;
  partnerStrategistsGoal: number;
  partnerEngineersCertified: number;
  partnerEngineersGoal: number;
}

export interface DashboardData {
  partnerManagers: PartnerManager[];
  partners: Partner[];
  registrations: DealRegistration[];
  opportunities: Opportunity[];
  targets: Target[];
  activities: ActivityMeeting[];
  certifications: PartnerCertification[];
}
