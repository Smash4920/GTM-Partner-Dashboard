import {
  FISCAL_QUARTERS,
  FISCAL_YEAR_START,
  FORECAST_CATEGORIES,
  FORECAST_CATEGORY_FOR_STAGE,
  MEETING_TYPES,
  SNAPSHOT_DATE,
  STAGES,
} from '../constants';
import { quarterWindow, startOfWeekUtc } from '../../lib/fiscal';
import type {
  ActivityMeeting,
  DealRegistration,
  DashboardData,
  ForecastCategory,
  Opportunity,
  OpportunityStage,
  OpportunityType,
  Partner,
  PartnerCertification,
  PartnerManager,
  PartnerTier,
  PartnerType,
  PipelineSnapshot,
  Region,
  Target,
} from '../types';
import { chance, mulberry32, pick, randInt, skewAmount, weightedPick } from './rng';

/**
 * Deterministic mock book of business.
 *
 * A single seeded PRNG (mulberry32, seed 20260918) drives every number, so
 * the data is identical on every build and every load. The snapshot is fixed
 * at 2026-09-18 (see SNAPSHOT_DATE in constants.ts), so charts never shift
 * under your feet. Tune the *_COUNT / weight constants to reshape the story.
 */

// Re-seeded at the start of every generateDashboardData() call so the book
// is identical per call, not just per module load: a second provider, a test
// run, or any future regeneration must see exactly the same numbers.
const SEED = 20260918;
let rand = mulberry32(SEED);

const DAY = 86_400_000;
// One definition of the snapshot lives in constants.ts; alias it for brevity.
const SNAPSHOT = SNAPSHOT_DATE;

const ACCOUNT_MANAGERS = ['Dana Reyes', 'Marcus Webb', 'Priya Nair', 'Tom Alvarez', 'Ellie Chen'];
const FACTORY_ACCOUNT_DIRECTORS = [
  'Maya Patel',
  'Chris Alvarez',
  'Jordan Kim',
  'Morgan Lee',
  'Sam Okafor',
];

const PARTNER_MANAGER_NAMES = [
  'Alex Morgan',
  'Jordan Lee',
  'Taylor Chen',
  'Casey Rivera',
  'Riley Patel',
];

const PARTNER_NAMES = [
  'Northwind Solutions',
  'BrightPath Consulting',
  'Meridian Systems Group',
  'Harborview Technologies',
  'Summit Peak Analytics',
  'BlueRidge Integrators',
  'Catalyst Growth Partners',
  'Redwood Digital',
  'Ironclad Data Co.',
  'Foresight Advisory',
  'LatticeWorks',
  'Beacon IT Services',
  'Silverline Cloud',
  'Atlas Bridge Consulting',
  'Vantage Point Systems',
  'Kestrel Networks',
  'Oakfield Managed Services',
  'NimbusStack',
  'Cobalt Peak',
  'Trailmark Analytics',
  'Pinecrest Solutions',
  'Quanta Integrations',
  'Eastbridge Consulting',
  'Falcon Ridge Technologies',
  'Stellar Orbit Labs',
];

const NAME_PREFIX = [
  'Apex', 'Vertex', 'Nova', 'Juniper', 'Orion', 'Helix', 'Prime', 'Sterling',
  'Atlas', 'Zephyr', 'Aurora', 'Granite', 'Pinnacle', 'Quartz', 'Cedar', 'Onyx',
  'Sable', 'Talon', 'Vireo', 'Willow', 'Borealis', 'Dunelight', 'Ember', 'Fjord',
  'Halcyon', 'Indigo', 'Kestrel', 'Lumen',
];

const NAME_INDUSTRY = [
  'Logistics', 'Health', 'Manufacturing', 'Retail', 'Banking', 'Energy', 'Media',
  'Insurance', 'Construction', 'Pharma', 'Hospitality', 'Telecom', 'AgTech',
  'Aerospace', 'Education', 'Real Estate', 'Automotive', 'Food', 'Legal', 'Sports',
];

const NAME_SUFFIX = [
  'Group', 'Inc.', 'Co.', 'Corp.', 'Holdings', 'Systems', 'Industries', 'Ventures', 'Labs',
];

const REJECTION_REASONS = [
  'Duplicate registration',
  'Direct deal already in progress',
  'Registration window expired',
  'Insufficient deal detail',
  'Conflict with another partner',
];

/**
 * Registrations that become duplicate/conflicting submissions: a second
 * partner registers the same client as an earlier registration, so the
 * internal duplicate-conflict view has real rows. Applied as a post-pass with
 * a fixed index list so the seeded PRNG sequence above is never disturbed.
 */
const OVERLAP_SOURCES = [9, 23, 38, 52, 67, 81, 96, 110, 125, 139, 154, 168];

/**
 * Open-opportunity next steps, seeded deterministically from the opportunity
 * id rather than the PRNG, so the manager-facing table opens half-full of
 * real "next action" text. Undefined for the rest, which the UI shows as "—".
 */
const NEXT_STEP_POOL = [
  'Send mutual action plan',
  'Schedule executive roundtable',
  'Book technical deep-dive',
  'Align pricing with deal desk',
  'Provide security questionnaire',
  'Introduce partner solution lead',
];

function seededNextStep(id: string): string | undefined {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const pick = hash % 10;
  return pick < NEXT_STEP_POOL.length ? NEXT_STEP_POOL[pick] : undefined;
}

/**
 * The manager's called forecast category for an open deal.
 *
 * A category is a judgment about whether the deal lands, not a restatement of
 * the stage it sits in. The interesting rows are the ones where the two
 * disagree: a Commit still in Discovery (paper moving faster than the CRM), or
 * a Long Shot in Deal Desk Review (the champion left). Those disagreements are
 * the coaching signal the Forecasting view exists to surface.
 *
 * Roughly one open deal in five is called off its stage, split between
 * optimistic and cautious. That rate is deliberate: it matches the forecast
 * hygiene of an org with the registration-process problems this book models,
 * and it leaves enough rows inside a single quarter for the disagreement to be
 * legible rather than a rounding error. Derived from the id rather than the
 * PRNG, so no seeded sequence and no pinned volume shifts.
 */
function seededCategoryCall(id: string, stage: OpportunityStage): ForecastCategory {
  const fromStage = FORECAST_CATEGORY_FOR_STAGE[stage];
  let hash = 0;
  for (const char of id) hash = (hash * 37 + char.charCodeAt(0)) >>> 0;
  if (hash % 5 !== 0) return fromStage;

  // FORECAST_CATEGORIES runs long-shot -> commit, so +1 is a more confident
  // call than the stage implies and -1 a more cautious one. Move a single
  // bucket to keep every call adjacent-plausible, reflecting back off each end.
  const index = FORECAST_CATEGORIES.indexOf(fromStage);
  const step = hash % 10 === 0 ? 1 : -1;
  const called = index + step;
  return FORECAST_CATEGORIES[called] ?? FORECAST_CATEGORIES[index - step];
}

/**
 * Deterministic dwell time between an approved registration and its
 * opportunity being created, derived from the registration id (2–12 days) so
 * the conversion chain reads as real document handling rather than instant.
 */
function conversionGapDays(registrationId: string): number {
  const digits = registrationId.replace(/\D/g, '');
  const num = Number(digits) || 0;
  return 2 + (num % 11);
}

/** Higher tiers submit far more registrations. */
const TIER_ACTIVITY: Record<PartnerTier, number> = {
  platinum: 12,
  gold: 8,
  silver: 4,
  registered: 1.5,
};

/**
 * Partner revenue targets by tier, per quarter. Calibrated against the deal
 * volumes below so the aggregate story stays credible: roughly 55-60% YTD
 * attainment mid-Q3 with about 4x coverage on the remaining quota.
 */
const TIER_TARGET_BASE: Record<PartnerTier, number> = {
  platinum: 175_000,
  gold: 95_000,
  silver: 45_000,
  registered: 20_000,
};

const REGISTRATION_COUNT = 180;

/** Activity skews toward the current fiscal year and current Q3 snapshot. */
const MOCK_QUARTER_WEIGHTS: readonly (readonly [string, number])[] = [
  ['FY26-Q4', 5],
  ['FY27-Q1', 14],
  ['FY27-Q2', 24],
  ['FY27-Q3', 20],
];

/** Stage distribution for open opportunities: fat at Discovery, thin at Deal Desk. */
const OPEN_STAGE_WEIGHTS: readonly (readonly [OpportunityStage, number])[] = [
  ['discovery', 30],
  ['scope', 24],
  ['tech-validation', 17],
  ['business-case', 13],
  ['vendor-of-choice', 10],
  ['deal-desk-review', 6],
];

/** Lost deals die earlier in the funnel more often than late. */
const LOST_STAGE_WEIGHTS: readonly (readonly [OpportunityStage, number])[] = [
  ['discovery', 35],
  ['scope', 25],
  ['tech-validation', 15],
  ['business-case', 15],
  ['vendor-of-choice', 7],
  ['deal-desk-review', 3],
];

/**
 * Deal-size ranges by opportunity type. The seeded book uses a broad ACV
 * distribution centered around roughly $250k for open Q3 opportunities, with
 * smaller co-sell deals and larger allocation motions creating realistic
 * variance around that planning assumption.
 */
const AMOUNT_RANGES: Record<OpportunityType, readonly [number, number]> = {
  'sell-with': [80_000, 750_000],
  'sell-to': [50_000, 450_000],
  allocate: [125_000, 1_000_000],
};

/** Extra opportunities beyond converted registrations, by type. */
const EXTRA_COUNTS: Record<OpportunityType, number> = {
  'sell-with': 24, // co-sell deals that skipped deal registration
  'sell-to': 26,
  allocate: 30,
};

// ---- date helpers -----------------------------------------------------------

function iso(date: Date): string {
  return date.toISOString();
}

/** A random day inside the quarter, clamped to before the snapshot date. */
function dateWithinQuarter(quarter: string): Date {
  const { start, end } = quarterWindow(quarter);
  const spanDays = Math.round((end.getTime() - start.getTime()) / DAY);
  let date = new Date(start.getTime() + randInt(rand, 0, spanDays - 1) * DAY);
  if (date.getTime() > SNAPSHOT.getTime() - DAY) {
    date = new Date(SNAPSHOT.getTime() - randInt(rand, 1, 20) * DAY);
  }
  return date;
}

// ---- generators -------------------------------------------------------------

function generatePartnerManagers(): PartnerManager[] {
  return PARTNER_MANAGER_NAMES.map((name, index) => ({
    id: `pm-${String(index + 1).padStart(2, '0')}`,
    name,
  }));
}

function generatePartners(partnerManagers: PartnerManager[]): Partner[] {
  const tiers: readonly (readonly [PartnerTier, number])[] = [
    ['platinum', 3],
    ['gold', 6],
    ['silver', 10],
    ['registered', 6],
  ];
  const types: readonly (readonly [PartnerType, number])[] = [
    ['reseller', 7],
    ['agency', 5],
    ['msp', 6],
    ['integrator', 4],
    ['referral', 3],
  ];
  const regions: readonly (readonly [Region, number])[] = [
    ['na', 12],
    ['emea', 6],
    ['apac', 4],
    ['latam', 3],
  ];

  return PARTNER_NAMES.map((name, index) => ({
    id: `p-${String(index + 1).padStart(2, '0')}`,
    name,
    type: weightedPick(rand, types),
    tier: weightedPick(rand, tiers),
    region: weightedPick(rand, regions),
    accountManager: pick(rand, ACCOUNT_MANAGERS),
    // Salesforce Account.Partner_Manager__c is represented by this relationship.
    partnerManagerId: partnerManagers[index % partnerManagers.length].id,
    joinedAt: iso(
      new Date(Date.UTC(2022 + randInt(rand, 0, 3), randInt(rand, 0, 11), randInt(rand, 1, 28))),
    ),
  }));
}

function makeAccountName(taken: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = `${pick(rand, NAME_PREFIX)} ${pick(rand, NAME_INDUSTRY)} ${pick(rand, NAME_SUFFIX)}`;
    if (!taken.has(name)) {
      taken.add(name);
      return name;
    }
  }
  const fallback = `${pick(rand, NAME_PREFIX)} ${pick(rand, NAME_INDUSTRY)} ${randInt(rand, 2, 99)}`;
  taken.add(fallback);
  return fallback;
}

function generateRegistrations(partners: Partner[]): DealRegistration[] {
  const taken = new Set<string>();
  const partnerWeights = partners.map(
    (partner) => [partner, TIER_ACTIVITY[partner.tier]] as const,
  );
  const registrations: DealRegistration[] = [];

  for (let i = 0; i < REGISTRATION_COUNT; i += 1) {
    const partner = weightedPick(rand, partnerWeights);
    const quarter = weightedPick(rand, MOCK_QUARTER_WEIGHTS);
    const submittedAt = dateWithinQuarter(quarter);
    const registration: DealRegistration = {
      id: `reg-${String(i + 1).padStart(4, '0')}`,
      partnerId: partner.id,
      accountName: makeAccountName(taken),
      amount: skewAmount(rand, 15_000, 250_000),
      submittedAt: iso(submittedAt),
      status: 'pending',
    };

    // Recent submissions have a chance of still awaiting review.
    const ageDays = (SNAPSHOT.getTime() - submittedAt.getTime()) / DAY;
    if (ageDays < 40 && chance(rand, 0.35)) {
      registrations.push(registration);
      continue;
    }

    if (chance(rand, 0.85)) {
      const decisionAt = new Date(
        Math.min(SNAPSHOT.getTime(), submittedAt.getTime() + randInt(rand, 2, 10) * DAY),
      );
      registration.status = 'approved';
      registration.decisionAt = iso(decisionAt);
      registration.decidedBy = pick(rand, ACCOUNT_MANAGERS);
      if (chance(rand, 0.7)) {
        registration.convertedTo = `${registration.id}-opp`;
      }
    } else {
      const decisionAt = new Date(
        Math.min(SNAPSHOT.getTime(), submittedAt.getTime() + randInt(rand, 2, 12) * DAY),
      );
      registration.status = 'rejected';
      registration.decisionAt = iso(decisionAt);
      registration.decidedBy = pick(rand, ACCOUNT_MANAGERS);
      registration.reason = pick(rand, REJECTION_REASONS);
    }

    registrations.push(registration);
  }

  // Seed overlapping submissions: a fixed set of registrations becomes a
  // second partner registering the same client as an earlier registration.
  // No randomness is consumed, so every index and volume above is unchanged.
  for (const index of OVERLAP_SOURCES) {
    const registration = registrations[index];
    const rival = registrations[index - 7];
    if (!registration || !rival || rival.partnerId === registration.partnerId) continue;
    registration.accountName = rival.accountName;
  }

  return registrations;
}

function buildOpportunity(params: {
  id: string;
  partner: Partner;
  oppType: OpportunityType;
  createdAt: Date;
  accountName: string;
  registrationId?: string;
}): Opportunity {
  const { id, partner, oppType, createdAt, accountName, registrationId } = params;
  const [minAmount, maxAmount] = AMOUNT_RANGES[oppType];
  const expectedClose = new Date(createdAt.getTime() + randInt(rand, 60, 150) * DAY);

  // The older the opportunity, the more likely it has closed.
  const ageDays = (SNAPSHOT.getTime() - createdAt.getTime()) / DAY;
  const openChance = Math.max(0.08, 0.92 - ageDays / 420);

  const opportunity: Opportunity = {
    id,
    partnerId: partner.id,
    registrationId,
    accountName,
    oppType,
    stage: weightedPick(rand, OPEN_STAGE_WEIGHTS),
    factoryAccountDirector: pick(rand, FACTORY_ACCOUNT_DIRECTORS),
    forecastedRevenue: skewAmount(rand, minAmount, maxAmount),
    createdAt: iso(createdAt),
    expectedCloseDate: iso(expectedClose),
  };

  const canClose = createdAt.getTime() + 21 * DAY < SNAPSHOT.getTime();
  if (!chance(rand, openChance) && canClose) {
    const won = chance(rand, 0.55);
    const closedAt = new Date(
      Math.min(SNAPSHOT.getTime(), expectedClose.getTime()) - randInt(rand, 0, 10) * DAY,
    );
    opportunity.outcome = won ? 'won' : 'lost';
    opportunity.stage = won ? 'deal-desk-review' : weightedPick(rand, LOST_STAGE_WEIGHTS);
    opportunity.closedAt = iso(closedAt);
  }

  // The forecast bucket follows the deal's final stage (a late-funnel deal is
  // a commit whether it eventually closes or not). No randomness consumed.
  opportunity.forecastCategory = FORECAST_CATEGORY_FOR_STAGE[opportunity.stage];

  return opportunity;
}

function generateOpportunities(
  partners: Partner[],
  registrations: DealRegistration[],
): Opportunity[] {
  const taken = new Set<string>();
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const partnerWeights = partners.map(
    (partner) => [partner, TIER_ACTIVITY[partner.tier]] as const,
  );
  const opportunities: Opportunity[] = [];

  // Approved + converted registrations become Sell With opportunities.
  for (const registration of registrations) {
    if (!registration.convertedTo || !registration.decisionAt) continue;
    const partner = partnerById.get(registration.partnerId);
    if (!partner) continue;
    opportunities.push(
      buildOpportunity({
        id: registration.convertedTo,
        partner,
        oppType: 'sell-with',
        createdAt: new Date(registration.decisionAt),
        accountName: registration.accountName,
        registrationId: registration.id,
      }),
    );
  }

  // Additional opportunities that never went through deal registration.
  let seq = 1;
  for (const [oppType, count] of Object.entries(EXTRA_COUNTS) as [OpportunityType, number][]) {
    for (let i = 0; i < count; i += 1) {
      const partner = weightedPick(rand, partnerWeights);
      const quarter = weightedPick(rand, MOCK_QUARTER_WEIGHTS);
      opportunities.push(
        buildOpportunity({
          id: `opp-${String(seq).padStart(4, '0')}`,
          partner,
          oppType,
          createdAt: dateWithinQuarter(quarter),
          accountName: makeAccountName(taken),
        }),
      );
      seq += 1;
    }
  }

  // Post-passes that add realism without touching the seeded PRNG sequence:
  // converted registrations get a document-handling dwell time before their
  // opportunity is created, and open deals carry a row-level next step plus
  // the manager's called forecast category.
  for (const opportunity of opportunities) {
    if (!opportunity.registrationId) continue;
    const createdAt = Math.min(
      SNAPSHOT.getTime(),
      new Date(opportunity.createdAt).getTime() + conversionGapDays(opportunity.registrationId) * DAY,
    );
    opportunity.createdAt = iso(new Date(createdAt));
  }
  // Open deals also carry the manager's called category, which may disagree
  // with the stage default set in buildOpportunity. Closed deals keep the
  // stage-derived value: the call stops mattering once the deal resolves.
  for (const opportunity of opportunities) {
    if (opportunity.outcome) continue;
    opportunity.nextStep = seededNextStep(opportunity.id);
    opportunity.forecastCategory = seededCategoryCall(opportunity.id, opportunity.stage);
  }

  return opportunities;
}

/**
 * Closed-only prior-year book across the FY26 quarters. These opportunities
 * sit entirely outside FY27 phase windows, so current-period metrics never
 * see them — they exist to feed the prior-year (YoY) delta tiles.
 */
function generatePriorYearOpportunities(partners: Partner[]): Opportunity[] {
  const taken = new Set<string>();
  const partnerWeights = partners.map(
    (partner) => [partner, TIER_ACTIVITY[partner.tier]] as const,
  );
  const typeWeights: readonly (readonly [OpportunityType, number])[] = [
    ['sell-with', 5],
    ['sell-to', 3],
    ['allocate', 2],
  ];
  const priorQuarters = ['FY26-Q1', 'FY26-Q2', 'FY26-Q3', 'FY26-Q4'] as const;
  const opportunities: Opportunity[] = [];
  let seq = 1;

  for (const quarter of priorQuarters) {
    const { start, end } = quarterWindow(quarter);
    const spanDays = Math.round((end.getTime() - start.getTime()) / DAY);
    for (let i = 0; i < 10; i += 1) {
      const partner = weightedPick(rand, partnerWeights);
      const oppType = weightedPick(rand, typeWeights);
      const [minAmount, maxAmount] = AMOUNT_RANGES[oppType];
      const closedAt = new Date(start.getTime() + randInt(rand, 0, spanDays - 1) * DAY);
      const createdAt = new Date(closedAt.getTime() - randInt(rand, 60, 150) * DAY);
      const expectedClose = new Date(closedAt.getTime() + randInt(rand, 0, 10) * DAY);
      const won = chance(rand, 0.55);
      const stage = won ? 'deal-desk-review' : weightedPick(rand, LOST_STAGE_WEIGHTS);
      opportunities.push({
        id: `opp-prior-${String(seq).padStart(4, '0')}`,
        partnerId: partner.id,
        accountName: makeAccountName(taken),
        oppType,
        stage,
        forecastCategory: FORECAST_CATEGORY_FOR_STAGE[stage],
        factoryAccountDirector: pick(rand, FACTORY_ACCOUNT_DIRECTORS),
        forecastedRevenue: skewAmount(rand, minAmount, maxAmount),
        createdAt: iso(createdAt),
        expectedCloseDate: iso(expectedClose),
        outcome: won ? 'won' : 'lost',
        closedAt: iso(closedAt),
      });
      seq += 1;
    }
  }

  return opportunities;
}

// ---- weekly pipeline history -----------------------------------------------

const WEEK = 7 * DAY;

/**
 * Stable hash of an id, for variation that consumes no seeded randomness.
 *
 * The finalizer matters: opportunity ids run in sequence and differ only in
 * their last characters, so without mixing, the low bits track id order and
 * any `% n` selection picks a periodic slice of the book — which silently
 * correlates drift with creation batches, and so with close-date ranges.
 */
function idHash(id: string, salt: number): number {
  let hash = salt;
  for (const char of id) hash = (hash * 131 + char.charCodeAt(0)) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/**
 * Forecasted revenue as it stood `weeksAgo` weeks before the snapshot. Most
 * deals were never re-sized; of those that were, most grew as the scope firmed
 * up and a few were cut back.
 */
function snapshotRevenue(opportunity: Opportunity, weeksAgo: number): number {
  const hash = idHash(opportunity.id, 7);
  if (hash % 3 !== 0) return opportunity.forecastedRevenue;
  const stepWeeksAgo = 2 + (hash % 6);
  if (weeksAgo < stepWeeksAgo) return opportunity.forecastedRevenue;
  // A cut deal was larger before the step; a grown deal was smaller.
  const factor =
    hash % 9 === 0 ? 1.1 + ((hash >> 3) % 4) * 0.08 : 0.62 + ((hash >> 3) % 5) * 0.07;
  return Math.round((opportunity.forecastedRevenue * factor) / 1_000) * 1_000;
}

/**
 * The call and stage as they stood. A minority of deals were a bucket more
 * cautious and a stage earlier a few weeks back, which is what makes a
 * week-over-week composition shift real rather than an artifact of today's
 * calls being projected backward.
 */
function snapshotCall(
  opportunity: Opportunity,
  weeksAgo: number,
): { category: ForecastCategory; stage: OpportunityStage } {
  const current =
    opportunity.forecastCategory ?? FORECAST_CATEGORY_FOR_STAGE[opportunity.stage];
  const hash = idHash(opportunity.id, 11);
  if (hash % 4 !== 0) return { category: current, stage: opportunity.stage };
  const calledWeeksAgo = 1 + (hash % 5);
  if (weeksAgo < calledWeeksAgo) return { category: current, stage: opportunity.stage };
  return {
    category: FORECAST_CATEGORIES[Math.max(0, FORECAST_CATEGORIES.indexOf(current) - 1)],
    stage: STAGES[Math.max(0, STAGES.indexOf(opportunity.stage) - 1)],
  };
}

/**
 * Expected close as it stood. A minority of deals moved across a quarter
 * boundary: a slip pushes the date out, so the quarter it left shows the drop,
 * and a pull-in brings it forward, so the quarter it joined shows the rise.
 * Six weeks is enough movement to cross a boundary either way.
 */
function snapshotCloseDate(opportunity: Opportunity, weeksAgo: number): string {
  const hash = idHash(opportunity.id, 13);
  if (hash % 5 !== 0) return opportunity.expectedCloseDate;
  const movedWeeksAgo = 1 + (hash % 4);
  if (weeksAgo < movedWeeksAgo) return opportunity.expectedCloseDate;
  const current = new Date(opportunity.expectedCloseDate).getTime();
  // Slips outnumber pull-ins about two to one, as they do in a real book.
  const pulledIn = hash % 15 === 0;
  return iso(new Date(pulledIn ? current + 6 * WEEK : current - 6 * WEEK));
}

/**
 * Weekly recordings of the open book: one row per open opportunity per Monday
 * of FY27 through the snapshot date.
 *
 * Without history a week-over-week view has to read past weeks off the current
 * book, which backdates every later change — amounts, calls, and close dates
 * all arrive retroactively, and a deal that slipped out of a quarter vanishes
 * from the weeks it was in rather than showing the drop. These rows are what a
 * Friday-evening capture would have written, so once written they never move.
 *
 * Drift is derived from the opportunity id and the week index rather than the
 * seeded PRNG, so adding history shifts no existing volume or amount.
 */
function generateSnapshots(opportunities: Opportunity[]): PipelineSnapshot[] {
  const fiscalStart = FISCAL_YEAR_START.getTime();
  const mondayOnOrBefore = startOfWeekUtc(FISCAL_YEAR_START).getTime();
  const firstMonday = mondayOnOrBefore === fiscalStart ? fiscalStart : mondayOnOrBefore + WEEK;
  const lastMonday = startOfWeekUtc(SNAPSHOT).getTime();
  const snapshots: PipelineSnapshot[] = [];

  for (let takenAt = firstMonday; takenAt <= lastMonday; takenAt += WEEK) {
    const weeksAgo = Math.round((lastMonday - takenAt) / WEEK);
    for (const opportunity of opportunities) {
      if (new Date(opportunity.createdAt).getTime() > takenAt) continue;
      const closedAt = opportunity.closedAt
        ? new Date(opportunity.closedAt).getTime()
        : undefined;
      // A snapshot is the open book: membership is what records that the deal
      // had neither closed nor been created yet at that moment.
      if (closedAt !== undefined && closedAt <= takenAt) continue;
      const call = snapshotCall(opportunity, weeksAgo);
      snapshots.push({
        takenAt: iso(new Date(takenAt)),
        opportunityId: opportunity.id,
        forecastedRevenue: snapshotRevenue(opportunity, weeksAgo),
        forecastCategory: call.category,
        stage: call.stage,
        expectedCloseDate: snapshotCloseDate(opportunity, weeksAgo),
      });
    }
  }

  return snapshots;
}

function generateTargets(partners: Partner[]): Target[] {
  const targets: Target[] = [];
  for (const partner of partners) {
    for (const quarter of FISCAL_QUARTERS) {
      const jitter = 0.85 + rand() * 0.3; // plus or minus 15%
      const base = TIER_TARGET_BASE[partner.tier] * jitter;
      targets.push({
        partnerId: partner.id,
        quarter,
        revenueTarget: Math.round(base / 1_000) * 1_000,
      });
    }
  }
  return targets;
}

function generateActivities(partners: Partner[], partnerManagers: PartnerManager[]): ActivityMeeting[] {
  const activities: ActivityMeeting[] = [];
  // Activity weeks anchor to the Monday of the snapshot week (fiscal.ts owns
  // the week rule, so the generator and the tracker cannot drift apart).
  const snapshotWeek = startOfWeekUtc(SNAPSHOT);
  const activityWeights = MEETING_TYPES.map((type, index) => [type, index < 3 ? 4 : 2] as const);
  let sequence = 1;

  for (let weekIndex = 7; weekIndex >= 0; weekIndex -= 1) {
    const weekStart = new Date(snapshotWeek.getTime() - weekIndex * 7 * DAY);
    // The current week is the one partner managers classify in Log Meetings,
    // so give every manager a full week of their own calendar (the weekly
    // goal is 10 meetings). Prior weeks are a single seeded pool across all
    // managers, which reads as lighter activity further back.
    const meetingsThisWeek =
      weekIndex === 0
        ? 0
        : randInt(rand, 12, 24);
    for (let meetingIndex = 0; meetingIndex < meetingsThisWeek; meetingIndex += 1) {
      const partner = pick(rand, partners);
      const manager = partnerManagers.find((candidate) => candidate.id === partner.partnerManagerId);
      const occurredAt = new Date(
        weekStart.getTime() + randInt(rand, 0, 4) * DAY + randInt(rand, 9, 16) * 3_600_000,
      );
      activities.push({
        id: `meeting-${String(sequence).padStart(4, '0')}`,
        partnerId: partner.id,
        partnerManagerId: manager?.id ?? partner.partnerManagerId,
        type: weightedPick(rand, activityWeights),
        occurredAt: iso(occurredAt),
        durationMinutes: pick(rand, [30, 45, 60, 90]),
      });
      sequence += 1;
    }
  }

  // Current week: one calendar per partner manager. Meetings land Mon–Fri
  // between 09:00 and 16:00, mirroring a real Google Calendar import they
  // will classify partner-by-partner.
  for (const manager of partnerManagers) {
    const roster = partners.filter((partner) => partner.partnerManagerId === manager.id);
    const weekStart = snapshotWeek;
    const meetingsThisWeek = randInt(rand, 7, 12);
    for (let meetingIndex = 0; meetingIndex < meetingsThisWeek; meetingIndex += 1) {
      const partner = pick(rand, roster);
      const startedAt = new Date(
        weekStart.getTime() + randInt(rand, 0, 4) * DAY + randInt(rand, 9, 16) * 3_600_000,
      );
      activities.push({
        id: `meeting-${String(sequence).padStart(4, '0')}`,
        partnerId: partner.id,
        partnerManagerId: manager.id,
        type: weightedPick(rand, activityWeights),
        occurredAt: iso(startedAt),
        durationMinutes: pick(rand, [30, 45, 60, 90]),
      });
      sequence += 1;
    }
  }
  return activities;
}

function generateCertifications(partners: Partner[]): PartnerCertification[] {
  return partners.map((partner) => {
    const partnerStrategistsGoal = randInt(rand, 3, 6);
    const partnerEngineersGoal = randInt(rand, 4, 8);
    return {
      partnerId: partner.id,
      partnerStrategistsCertified: randInt(rand, 1, partnerStrategistsGoal),
      partnerStrategistsGoal,
      partnerEngineersCertified: randInt(rand, 1, partnerEngineersGoal),
      partnerEngineersGoal,
    };
  });
}

export function generateDashboardData(): DashboardData {
  rand = mulberry32(SEED);
  const partnerManagers = generatePartnerManagers();
  const partners = generatePartners(partnerManagers);
  const registrations = generateRegistrations(partners);
  const opportunities = [
    ...generateOpportunities(partners, registrations),
    ...generatePriorYearOpportunities(partners),
  ];
  const snapshots = generateSnapshots(opportunities);
  const targets = generateTargets(partners);
  const activities = generateActivities(partners, partnerManagers);
  const certifications = generateCertifications(partners);
  return {
    partnerManagers,
    partners,
    registrations,
    opportunities,
    snapshots,
    targets,
    activities,
    certifications,
  };
}
