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

/**
 * Probability bucket a partner manager assigns to an open deal, the input to
 * the weighted forecast: commit, best case, pipeline, or long shot. Weights
 * live in constants.ts (FORECAST_CATEGORY_META).
 */
export type ForecastCategory = 'long-shot' | 'pipeline' | 'best-case' | 'commit';

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
  /** Probability bucket for the weighted forecast; derived from stage when unset. */
  forecastCategory?: ForecastCategory;
  /** Row-level next action; a free-form field edited in-app. */
  nextStep?: string;
  createdAt: string; // ISO 8601
  expectedCloseDate: string; // ISO 8601
  closedAt?: string; // set once closed (won or lost)
  outcome?: OpportunityOutcome;
  /** Free-form note left by a partner manager; edited in-app, shown on hover. */
  notes?: string;
}

/**
 * One opportunity's state as it stood at a weekly recording of the open book.
 *
 * This is append-only history, and it exists because current state cannot
 * answer a question about the past. An opportunity row carries one amount, one
 * call, and one expected close date, so reading last week's pipeline off
 * today's book silently backdates every later change: an amount raised this
 * week rewrites the weeks before it, a re-call re-colors them, and a deal that
 * slipped out of the quarter disappears from the weeks it was in rather than
 * showing the drop. A snapshot already written must never change.
 *
 * Salesforce keeps the equivalent in OpportunityHistory and
 * OpportunityFieldHistory; a warehouse would model it as a weekly fact table.
 */
export interface PipelineSnapshot {
  /** UTC Monday midnight the book was recorded at — the close of the prior week. */
  takenAt: string; // ISO 8601
  opportunityId: string;
  /** Forecasted revenue as it stood, not today's figure. */
  forecastedRevenue: number;
  /** The manager's call as it stood. */
  forecastCategory: ForecastCategory;
  stage: OpportunityStage;
  /** Expected close as it stood, so slips in and out of a quarter are visible. */
  expectedCloseDate: string; // ISO 8601
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
  /** Weekly recordings of the open book, for week-over-week history. */
  snapshots: PipelineSnapshot[];
  targets: Target[];
  activities: ActivityMeeting[];
  certifications: PartnerCertification[];
}
