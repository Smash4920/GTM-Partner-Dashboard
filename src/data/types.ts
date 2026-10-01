/**
 * Canonical data model for the GTM Partner Dashboard.
 *
 * Everything the UI renders flows through these shapes via the DataProvider
 * interface (src/data/DataProvider.ts). A seeded mock generator fills them
 * today; a CRM-backed provider can fill the exact same shapes tomorrow
 * without any view code changing. See README "Data contract".
 *
 * Two shapes are deliberately NOT here: the whole-book container a
 * provider holds and the raw weekly snapshot history rows live in
 * `src/data/mock/book.ts`, provider-private, so no shared import can leak
 * raw history toward the client (the boundary test scans for their names).
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

type OpportunityOutcome = 'won' | 'lost';

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

/** Internal (not partner) role on the GTM partner team. */
export type TeamRole = 'partnership-lead' | 'partner-manager' | 'deal-desk-ops' | 'analyst';

/**
 * Notification-routing state for an internal roster entry, for this session
 * only. None of these states grants, revokes, or restores sign-in or data
 * access — production identity (Prod Only) owns that:
 * - invited:   on the roster, notification routing not set up yet
 * - active:    this session would route simulated notifications to them
 * - suspended: notifications paused, the roster entry kept
 */
export type TeamUserStatus = 'active' | 'invited' | 'suspended';

/** Where a simulated notification would go. Email is the always-on channel. */
export type NotificationChannel = 'email' | 'slack' | 'in-app';

/**
 * An internal user on the partner team.
 *
 * The dashboard is not the system of record for people: in production the
 * identity provider owns the roster and this record is a projection of it
 * (see the Data Connections view). What lives here is the dashboard-specific
 * part — which manager a user is aligned to, and which channels they are
 * authorized to be notified on — because that is what decides who hears about
 * a deal registration they own.
 */
export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  /**
   * Partner-manager alignment for a `partner-manager` user. Together with the
   * partner record this is what makes a registration "theirs": partner →
   * partnerManagerId → user. Left unset for roles that are not aligned to one
   * manager (the lead and the deal desk see the whole book).
   */
  partnerManagerId?: string;
  status: TeamUserStatus;
  /** Channels this user would receive simulated notifications on this session. */
  channels: NotificationChannel[];
  addedAt: string; // ISO 8601
  /** Set when notification routing was switched on; never an access grant. */
  authorizedAt?: string;
  /** Who added the user to the roster. */
  addedBy?: string;
}

/** What the roster form collects; the session-only record is built from it. */
export interface NewTeamUserInput {
  name: string;
  email: string;
  role: TeamRole;
  /** Required for the aligned `partner-manager` role, ignored otherwise. */
  partnerManagerId?: string;
  channels: NotificationChannel[];
}

export type NotificationKind =
  /** Owner's registration is one business day from the response SLA. */
  | 'registration-sla-warning'
  /** Owner's registration has already passed the response SLA. */
  | 'registration-sla-breach'
  /** Free-form note sent by hand from the notification panel. */
  | 'manual';

/**
 * Session send states. The demo records sends locally only, so the only state
 * it can truthfully report is `simulated-local` — a record on this screen, in
 * memory, for this session. A real sender (Prod Only) would add delivery,
 * retry, and failure states; the demo never claims one.
 */
type NotificationStatus = 'simulated-local';

/**
 * One simulated notification to one internal user, recorded locally for the
 * session. Nothing is delivered; refresh clears the record.
 */
export interface DashboardNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  channels: NotificationChannel[];
  sentAt: string; // ISO 8601
  status: NotificationStatus;
  /** The registration the notification is about, when it is about one. */
  registrationId?: string;
}

/**
 * A roadmap row carries two independent statuses so a client-only demo is never
 * confused with a production dependency:
 *
 * - The Demo status describes only verified client behavior in this deterministic
 *   demo. It is `complete`, `wip`, or `pending`. It can never be `prod-only`.
 * - The optional Production status marks the continuation that a real deployment
 *   needs (trusted identity, a scoped API/RLS, a warehouse, source credentials,
 *   durable storage, production telemetry, or deployment accounts). Its only value
 *   is `prod-only`, so demo completion can never imply the production step is done.
 *
 * A mixed row therefore renders `Demo: <complete|wip|pending>` alongside
 * `Production: Prod Only`, and names both the usable demo portion and the exact
 * production blocker in typed text rather than in prose the render cannot check.
 */
export type RoadmapDemoStatus = 'complete' | 'wip' | 'pending';

export type RoadmapProductionStatus = 'prod-only';

export type RoadmapStatus = RoadmapDemoStatus | RoadmapProductionStatus;

/** The two labeled axes a roadmap badge can describe. */
export type RoadmapScope = 'demo' | 'production';

/**
 * The production continuation of a row: the step is intentionally paused until a
 * real deployment exists, with the exact blocker stated for the reader.
 */
interface RoadmapProduction {
  status: RoadmapProductionStatus;
  /** The concrete production prerequisite this step waits on. */
  blocker: string;
}

/** One checklist line on the Production Requirements boards. */
export interface RoadmapItem {
  text: string;
  /** State of the client-only demo portion. Never a production claim. */
  demo: RoadmapDemoStatus;
  /**
   * What is usable in the demo today. Stated on a `Demo: WIP` row so the
   * landed half is unambiguous, and on a `Demo: Pending` row when the reader
   * needs the simulation caveat (for example, that the partner picker is an
   * untrusted presentation selector, not authorization).
   */
  demoScope?: string;
  /** Present when a production continuation is intentionally paused. */
  production?: RoadmapProduction;
}
