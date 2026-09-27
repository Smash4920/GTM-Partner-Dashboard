import type {
  DealRegistration,
  FiscalPhase,
  ForecastCategory,
  MeetingType,
  NotificationChannel,
  OpportunityStage,
  OpportunityType,
  PartnerTier,
  PartnerType,
  Region,
  TeamRole,
  TeamUserStatus,
} from './types';

export const STAGES: OpportunityStage[] = [
  'discovery',
  'scope',
  'tech-validation',
  'business-case',
  'vendor-of-choice',
  'deal-desk-review',
];

/**
 * Stage colors follow Factory's monochrome instrument palette: a graphite ramp
 * that lightens as deals progress. Chromatic color is reserved for outcomes.
 */
export const STAGE_META: Record<OpportunityStage, { label: string; color: string }> = {
  discovery: { label: 'Discovery', color: '#4d4947' },
  scope: { label: 'Scope', color: '#5e5a58' },
  'tech-validation': { label: 'Tech Validation', color: '#6e6b68' },
  'business-case': { label: 'Business Case', color: '#7e7b78' },
  'vendor-of-choice': { label: 'Vendor of Choice', color: '#8f8b88' },
  'deal-desk-review': { label: 'Deal Desk Review', color: '#a09d9a' },
};

export const OPP_TYPES: OpportunityType[] = ['sell-to', 'sell-with', 'allocate'];

export const OPP_TYPE_META: Record<
  OpportunityType,
  { label: string; color: string; description: string }
> = {
  'sell-to': {
    label: 'Sell To',
    color: '#b8b3b0',
    description: 'Your company sells directly to the partner (the partner is the customer).',
  },
  'sell-with': {
    label: 'Sell With',
    color: '#eeeeee',
    description: 'Co-sell: the partner is attached to a deal with an end customer.',
  },
  allocate: {
    label: 'Allocate',
    color: '#8a8380',
    description: 'Allocated revenue / committed-spend drawdown attributed to the partner.',
  },
};

/**
 * Forecast probability buckets for the weighted forecast. Weights are the
 * probability the open revenue closes: Long Shot 10%, Pipeline 25%, Best
 * Case 50%, Commit 90%.
 */
export const FORECAST_CATEGORIES: ForecastCategory[] = [
  'long-shot',
  'pipeline',
  'best-case',
  'commit',
];

export const FORECAST_CATEGORY_META: Record<
  ForecastCategory,
  { label: string; weight: number; color: string; description: string }
> = {
  'long-shot': {
    label: 'Long Shot',
    weight: 0.1,
    color: '#6e6b68',
    description: '10% probability — early funnel, low confidence.',
  },
  pipeline: {
    label: 'Pipeline',
    weight: 0.25,
    color: '#8a8380',
    description: '25% probability — qualified but unproven.',
  },
  'best-case': {
    label: 'Best Case',
    weight: 0.5,
    color: '#a09d9a',
    description: '50% probability — active evaluation.',
  },
  commit: {
    label: 'Commit',
    weight: 0.9,
    color: '#a0ca92',
    description: '90% probability — verbal/paper commitment in place.',
  },
};

/** Stage → forecast bucket heuristic used to seed and derive categories. */
export const FORECAST_CATEGORY_FOR_STAGE: Record<OpportunityStage, ForecastCategory> = {
  discovery: 'long-shot',
  scope: 'pipeline',
  'tech-validation': 'best-case',
  'business-case': 'commit',
  'vendor-of-choice': 'commit',
  'deal-desk-review': 'commit',
};

/** Deal-registration ops service levels. */
export const REGISTRATION_SLA_BUSINESS_DAYS = 5; // respond to a submission within 5 business days
export const REGISTRATION_EXCLUSIVITY_DAYS = 60; // approved lead keeps exclusivity for 60 calendar days

/**
 * How far ahead of the response SLA the owner is warned: one business day, so
 * a registration pending 24 hours out from the deadline notifies its owner
 * while there is still a working day to act. The deadline itself is the
 * snapshot day the submission reaches REGISTRATION_SLA_BUSINESS_DAYS.
 */
export const REGISTRATION_SLA_WARNING_BUSINESS_DAYS = 1;

export const PARTNER_TYPE_META: Record<PartnerType, string> = {
  reseller: 'Reseller',
  agency: 'Agency',
  msp: 'MSP',
  integrator: 'Integrator',
  referral: 'Referral',
};

export const PARTNER_TIER_META: Record<PartnerTier, { label: string; badgeClass: string }> = {
  platinum: { label: 'Platinum', badgeClass: 'bg-bone text-canvas' },
  gold: { label: 'Gold', badgeClass: 'border border-ash text-stone' },
  silver: { label: 'Silver', badgeClass: 'border border-ash text-granite' },
  registered: { label: 'Registered', badgeClass: 'border border-carbon text-granite' },
};

export const REGION_META: Record<Region, string> = {
  na: 'North America',
  emea: 'EMEA',
  apac: 'APAC',
  latam: 'LATAM',
};

export const REGISTRATION_STATUS_META: Record<
  DealRegistration['status'],
  { label: string; dotClass: string; textClass: string }
> = {
  pending: { label: 'Pending review', dotClass: 'bg-signal', textClass: 'text-signal' },
  approved: { label: 'Approved', dotClass: 'bg-metric', textClass: 'text-metric' },
  rejected: { label: 'Rejected', dotClass: 'bg-graphite', textClass: 'text-granite' },
};

/** Fixed snapshot date for all mock data. All relative ("today") logic uses this. */
export const SNAPSHOT_DATE = new Date('2026-09-18T00:00:00Z');

/** Fiscal year starts in February. The snapshot is in FY27 Q3. */
export const FISCAL_YEAR = 'FY27';
export const FISCAL_QUARTERS = ['FY27-Q1', 'FY27-Q2', 'FY27-Q3', 'FY27-Q4'] as const;
export const CURRENT_FISCAL_QUARTER = 'FY27-Q3';
export const FISCAL_YEAR_START = new Date('2026-02-01T00:00:00Z');

export const FISCAL_PHASE_META: Record<
  FiscalPhase,
  { label: string; description: string; quarter?: string }
> = {
  fy: { label: 'FY', description: 'FY27 year to date' },
  q1: { label: 'Q1', description: 'FY27 Q1 · Feb–Apr', quarter: 'FY27-Q1' },
  q2: { label: 'Q2', description: 'FY27 Q2 · May–Jul', quarter: 'FY27-Q2' },
  q3: { label: 'Q3', description: 'FY27 Q3 · Aug–Oct, through snapshot', quarter: 'FY27-Q3' },
  q4: { label: 'Q4', description: 'FY27 Q4 · Nov–Jan', quarter: 'FY27-Q4' },
};

export const FISCAL_PHASES: FiscalPhase[] = ['fy', 'q1', 'q2', 'q3', 'q4'];

export const MEETING_TYPE_META: Record<
  MeetingType,
  { label: string; fullLabel: string; color: string }
> = {
  discovery: { label: 'Discovery', fullLabel: 'Discovery', color: '#ee6018' },
  'pio-interlock': {
    label: 'PIO Interlock',
    fullLabel: 'Partner-Identified Opportunity Interlock (PIO Interlock)',
    color: '#a0ca92',
  },
  'pao-interlock': {
    label: 'PAO Interlock',
    fullLabel: 'Partner-Assisted Opportunity Interlock (PAO Interlock)',
    color: '#eeeeee',
  },
  'interlock-cadence': {
    label: 'Interlock Cadence',
    fullLabel: 'Interlock Cadence',
    color: '#b8b3b0',
  },
  'deal-support': {
    label: 'Deal Support',
    fullLabel: 'Deal Support',
    color: '#e8c76a',
  },
  'technical-enablement': {
    label: 'Technical Enablement',
    fullLabel: 'Technical Enablement',
    color: '#8a8380',
  },
  'gtm-enablement': {
    label: 'GTM Enablement',
    fullLabel: 'GTM Enablement',
    color: '#6e6b68',
  },
  'partner-cadence': {
    label: 'Partner Cadence',
    fullLabel: 'Partner Cadence',
    color: '#4d4947',
  },
};

export const MEETING_TYPES: MeetingType[] = Object.keys(MEETING_TYPE_META) as MeetingType[];

/**
 * Activity-tracking weekly goal: 10 classified partner meetings per manager
 * per week, at least 3 of which are Partner-Identified Opportunity Interlocks.
 */
export const WEEKLY_MEETING_GOAL = 10;
export const WEEKLY_PIO_GOAL = 3;

/** Factory's functional accents, used only for data states. */
export const WON_COLOR = '#a0ca92'; // metric green
export const LOST_COLOR = '#4d4947'; // graphite
export const TARGET_COLOR = '#8a8380'; // granite

/**
 * Internal partner-team roles. `aligned` marks the role that must be tied to
 * one partner manager — that alignment is what routes a registration to its
 * owner, so a manager without one would never be notified.
 */
export const TEAM_ROLE_META: Record<
  TeamRole,
  { label: string; description: string; aligned: boolean }
> = {
  'partnership-lead': {
    label: 'Partnership Lead',
    description: 'Owns the partner business end to end; sees every partner and manager.',
    aligned: false,
  },
  'partner-manager': {
    label: 'Partner Manager',
    description: "Owns one manager's aligned partners, and the registrations they submit.",
    aligned: true,
  },
  'deal-desk-ops': {
    label: 'Deal Desk Ops',
    description: 'Works the registration queue across every partner and manager.',
    aligned: false,
  },
  analyst: {
    label: 'Analyst',
    description: 'Read-only reporting across the ecosystem; no workflow ownership.',
    aligned: false,
  },
};

export const TEAM_ROLES: TeamRole[] = Object.keys(TEAM_ROLE_META) as TeamRole[];

export const TEAM_USER_STATUS_META: Record<
  TeamUserStatus,
  { label: string; dotClass: string; textClass: string }
> = {
  active: { label: 'Authorized', dotClass: 'bg-metric', textClass: 'text-metric' },
  invited: { label: 'Awaiting authorization', dotClass: 'bg-signal', textClass: 'text-signal' },
  suspended: { label: 'Access revoked', dotClass: 'bg-graphite', textClass: 'text-granite' },
};

export const NOTIFICATION_CHANNEL_META: Record<
  NotificationChannel,
  { label: string; description: string }
> = {
  email: { label: 'Email', description: 'Always on — the channel that reaches everyone.' },
  slack: { label: 'Slack', description: 'Direct message from the partner-bot workspace app.' },
  'in-app': { label: 'In-app', description: 'Badge and inbox inside this dashboard.' },
};

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['email', 'slack', 'in-app'];
