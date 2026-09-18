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

export interface Partner {
  id: string;
  name: string;
  type: PartnerType;
  tier: PartnerTier;
  region: Region;
  accountManager: string;
  joinedAt: string; // ISO 8601
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
  oppType: OpportunityType;
  stage: OpportunityStage;
  amount: number;
  createdAt: string; // ISO 8601
  expectedCloseDate: string; // ISO 8601
  closedAt?: string; // set once closed (won or lost)
  outcome?: OpportunityOutcome;
}

/** Revenue target for one partner for one quarter. */
export interface Target {
  partnerId: string;
  quarter: string; // e.g. '2026-Q3'
  revenueTarget: number;
}

export interface DashboardData {
  partners: Partner[];
  registrations: DealRegistration[];
  opportunities: Opportunity[];
  targets: Target[];
}
