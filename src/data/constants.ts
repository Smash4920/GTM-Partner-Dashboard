import type {
  DealRegistration,
  FiscalPhase,
  MeetingType,
  OpportunityStage,
  OpportunityType,
  PartnerTier,
  PartnerType,
  Region,
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
export const FISCAL_QUARTERS = [
  'FY27-Q1',
  'FY27-Q2',
  'FY27-Q3',
  'FY27-Q4',
] as const;
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

export const MEETING_TYPES: MeetingType[] = Object.keys(
  MEETING_TYPE_META,
) as MeetingType[];

/** Factory's functional accents, used only for data states. */
export const WON_COLOR = '#a0ca92'; // metric green
export const LOST_COLOR = '#4d4947'; // graphite
export const TARGET_COLOR = '#8a8380'; // granite
