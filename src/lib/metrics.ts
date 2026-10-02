import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  FISCAL_QUARTERS,
  FISCAL_YEAR,
  FISCAL_YEAR_START,
  FORECAST_CATEGORIES,
  FORECAST_CATEGORY_FOR_STAGE,
  FORECAST_CATEGORY_META,
  MEETING_TYPES,
  OPP_TYPES,
  REGISTRATION_EXCLUSIVITY_DAYS,
  REGISTRATION_SLA_BUSINESS_DAYS,
  REGISTRATION_SLA_WARNING_BUSINESS_DAYS,
  SNAPSHOT_DATE,
  STAGES,
  WEEKLY_MEETING_GOAL,
  WEEKLY_PIO_GOAL,
} from '../data/constants';
import type {
  ActivityMeeting,
  DealRegistration,
  FiscalPhase,
  ForecastCategory,
  MeetingClassification,
  MeetingType,
  Opportunity,
  OpportunityStage,
  OpportunityType,
  Partner,
  Target,
  TeamUser,
} from '../data/types';
import {
  businessDaysAfter,
  businessDaysBetween,
  fiscalQuarterOfDate,
  quarterWindow,
  startOfWeekUtc,
} from './fiscal';

/**
 * Business-day math lives in fiscal.ts, alongside the other calendar rules the
 * generator and the metrics share; re-exported here because the ops helpers
 * below are its main consumer.
 */
export { businessDaysBetween } from './fiscal';

const DAY = 86_400_000;

function isOpen(opp: Opportunity): boolean {
  return opp.outcome === undefined;
}

export function openOpportunities(opps: Opportunity[]): Opportunity[] {
  return opps.filter(isOpen);
}

/**
 * The opportunity-type lens: 'all', one type, or several types summed
 * together. The multi-type form is the leaderboard's combined ranking lens
 * (Sell With plus Allocate ranked as one book, not two truncated boards
 * merged afterward). An empty array matches nothing.
 */
export function filterByType(
  opps: Opportunity[],
  oppType: OpportunityType | 'all' | readonly OpportunityType[],
): Opportunity[] {
  if (oppType === 'all') return opps;
  if (typeof oppType === 'string') return opps.filter((opp) => opp.oppType === oppType);
  const wanted = new Set(oppType);
  return opps.filter((opp) => wanted.has(opp.oppType));
}

export function openPipeline(opps: Opportunity[]): { value: number; count: number } {
  const open = openOpportunities(opps);
  return {
    value: open.reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
    count: open.length,
  };
}

/** Closed-won revenue whose close date falls in [start, end). */
function closedWonBetween(opps: Opportunity[], startDate: Date, endDate: Date): number {
  const start = startDate.getTime();
  const end = endDate.getTime();
  return opps
    .filter((opp) => {
      if (opp.outcome !== 'won' || !opp.closedAt) return false;
      const closedAt = new Date(opp.closedAt).getTime();
      return closedAt >= start && closedAt < end;
    })
    .reduce((sum, opp) => sum + opp.forecastedRevenue, 0);
}

export function winRateForPhase(opps: Opportunity[], phase: FiscalPhase): number {
  const window = phaseWindow(phase);
  const start = window.start.getTime();
  const end = window.end.getTime();
  let won = 0;
  let lost = 0;
  for (const opp of opps) {
    if (!opp.closedAt) continue;
    const closedAt = new Date(opp.closedAt).getTime();
    if (closedAt < start || closedAt >= end) continue;
    if (opp.outcome === 'won') won += 1;
    else if (opp.outcome === 'lost') lost += 1;
  }
  return won + lost === 0 ? 0 : won / (won + lost);
}

export function avgOpenDealSize(opps: Opportunity[]): number {
  const { value, count } = openPipeline(opps);
  return count === 0 ? 0 : value / count;
}

/** Partners with an opportunity or registration created this fiscal year. */
export function activePartnerCount(opps: Opportunity[], registrations: DealRegistration[]): number {
  const active = new Set<string>();
  const cutoff = FISCAL_YEAR_START.getTime();
  for (const opp of opps) {
    if (new Date(opp.createdAt).getTime() >= cutoff) active.add(opp.partnerId);
  }
  for (const reg of registrations) {
    if (new Date(reg.submittedAt).getTime() >= cutoff) active.add(reg.partnerId);
  }
  return active.size;
}

export function filterRegistrationsByPhase(
  registrations: DealRegistration[],
  phase: FiscalPhase,
): DealRegistration[] {
  const window = phaseWindow(phase);
  return registrations.filter((registration) => isInWindow(registration.submittedAt, window));
}

/**
 * Deal registration funnel. Every stage carries both a count and a dollar
 * total, and the dollars are the partner-estimated deal value captured at
 * submission — not the amount on the opportunity the registration became.
 * Those two numbers diverge in a real CRM (the partner estimates, then sales
 * sizes the deal), so they are deliberately never summed together.
 */
export interface RegistrationFunnel {
  submitted: number;
  submittedValue: number;
  approved: number;
  approvedValue: number;
  converted: number;
  convertedValue: number;
  rejected: number;
  rejectedValue: number;
  pending: number;
  pendingValue: number;
}

export function registrationFunnel(registrations: DealRegistration[]): RegistrationFunnel {
  let submittedValue = 0;
  let approved = 0;
  let approvedValue = 0;
  let converted = 0;
  let convertedValue = 0;
  let rejected = 0;
  let rejectedValue = 0;
  let pending = 0;
  let pendingValue = 0;

  for (const reg of registrations) {
    submittedValue += reg.amount;
    if (reg.status === 'pending') {
      pending += 1;
      pendingValue += reg.amount;
    } else if (reg.status === 'rejected') {
      rejected += 1;
      rejectedValue += reg.amount;
    } else {
      approved += 1;
      approvedValue += reg.amount;
      if (reg.convertedTo) {
        converted += 1;
        convertedValue += reg.amount;
      }
    }
  }

  return {
    submitted: registrations.length,
    submittedValue,
    approved,
    approvedValue,
    converted,
    convertedValue,
    rejected,
    rejectedValue,
    pending,
    pendingValue,
  };
}

export function approvalRate(registrations: DealRegistration[]): number {
  const decided = registrations.filter((reg) => reg.status !== 'pending').length;
  const approved = registrations.filter((reg) => reg.status === 'approved').length;
  return decided === 0 ? 0 : approved / decided;
}

/** Approved registrations that converted into a qualified opportunity. */
export function registrationConversionRate(registrations: DealRegistration[]): number {
  const approved = registrations.filter((reg) => reg.status === 'approved').length;
  const converted = registrations.filter((reg) => reg.convertedTo !== undefined).length;
  return approved === 0 ? 0 : converted / approved;
}

export interface StageRow {
  stage: OpportunityStage;
  count: number;
  value: number;
}

export function stageBreakdown(opps: Opportunity[]): StageRow[] {
  const open = openOpportunities(opps);
  return STAGES.map((stage) => {
    const inStage = open.filter((opp) => opp.stage === stage);
    return {
      stage,
      count: inStage.length,
      value: inStage.reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
    };
  });
}

export interface OutcomeTotals {
  wonCount: number;
  wonValue: number;
  lostCount: number;
  lostValue: number;
}

export function outcomeTotals(opps: Opportunity[]): OutcomeTotals {
  const won = opps.filter((opp) => opp.outcome === 'won');
  const lost = opps.filter((opp) => opp.outcome === 'lost');
  return {
    wonCount: won.length,
    wonValue: won.reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
    lostCount: lost.length,
    lostValue: lost.reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
  };
}

export interface TypeRow {
  type: OpportunityType;
  count: number;
  value: number;
}

export function typeBreakdown(opps: Opportunity[]): TypeRow[] {
  const open = openOpportunities(opps);
  return OPP_TYPES.map((type) => {
    const ofType = open.filter((opp) => opp.oppType === type);
    return {
      type,
      count: ofType.length,
      value: ofType.reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
    };
  });
}

export interface QuarterRevenueRow {
  quarter: string;
  closedWon: number;
  target: number;
}

/**
 * Closed-won and target per fiscal quarter, for the revenue-vs-target chart.
 *
 * Input contract: callers pass their scoped opportunities *before* any phase
 * filtering — this function buckets by fiscal quarter on its own, so
 * phase-filtered input would zero out every quarter outside the selected
 * phase. Scope, partner, and revenue-motion filtering are fine.
 */
export function quarterlyClosedWonAndTarget(
  opps: Opportunity[],
  targets: Target[],
): QuarterRevenueRow[] {
  const targetByQuarter = new Map<string, number>();
  for (const target of targets) {
    targetByQuarter.set(
      target.quarter,
      (targetByQuarter.get(target.quarter) ?? 0) + target.revenueTarget,
    );
  }
  return FISCAL_QUARTERS.map((quarter) => ({
    quarter,
    closedWon: opps
      .filter(
        (opp) =>
          opp.outcome === 'won' && opp.closedAt && fiscalQuarterOfDate(opp.closedAt) === quarter,
      )
      .reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
    target: targetByQuarter.get(quarter) ?? 0,
  }));
}

export interface PhaseWindow {
  phase: FiscalPhase;
  /** Phase start (UTC midnight). */
  start: Date;
  /**
   * Closed-activity horizon: the phase truncated at the snapshot date.
   * Nothing can close after the snapshot, so closed opportunities are matched
   * against this bound. Inverted (end < start) for future phases, which
   * correctly yields an empty closed set.
   */
  end: Date;
  /**
   * Open-pipeline horizon: the phase's full span, including the future. Open
   * opportunities are matched by expected close against this bound, so
   * pipeline scheduled for the rest of the phase is not truncated at the
   * snapshot.
   */
  pipelineEnd: Date;
  targetQuarters: string[];
}

function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/**
 * The phase whose window is a given fiscal quarter, so a caller holding a
 * quarter label can reach the phase-based functions below. The inverse of the
 * `FISCAL_PHASE_META[phase].quarter` mapping, kept beside it so the two cannot
 * drift apart — the scoped DataProvider contract is phrased in quarters (that
 * is the unit a caller thinks in) while every window here is a phase.
 *
 * Throws on a quarter the fiscal calendar does not define rather than
 * defaulting to Q1. A fallback would answer a question about FY28-Q4 with FY27
 * Q1's numbers, and a plausible wrong number is worse than a crash: nobody
 * checks a figure that looks like a figure.
 */
export function phaseForQuarter(quarter: string): Exclude<FiscalPhase, 'fy'> {
  const phase = (['q1', 'q2', 'q3', 'q4'] as const).find(
    (candidate) => FISCAL_PHASE_META[candidate].quarter === quarter,
  );
  if (!phase) {
    throw new Error(
      `No fiscal phase matches quarter '${quarter}'; this build models ${FISCAL_YEAR}.`,
    );
  }
  return phase;
}

export function phaseWindow(phase: FiscalPhase): PhaseWindow {
  if (phase === 'fy') {
    const pipelineEnd = quarterWindow(FISCAL_QUARTERS[FISCAL_QUARTERS.length - 1]).end;
    return {
      phase,
      start: FISCAL_YEAR_START,
      end: minDate(pipelineEnd, SNAPSHOT_DATE),
      pipelineEnd,
      targetQuarters: [...FISCAL_QUARTERS],
    };
  }
  const quarter = FISCAL_QUARTERS[FISCAL_PHASES.indexOf(phase) - 1];
  const { start, end } = quarterWindow(quarter);
  return {
    phase,
    start,
    end: minDate(end, SNAPSHOT_DATE),
    pipelineEnd: end,
    targetQuarters: [quarter],
  };
}

/** The same calendar date one year earlier or later (UTC). */
function shiftYear(date: Date, years: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Prior-year closed-won over the same span of the year, for deltas.
 * In-progress phases compare snapshot-to-date against snapshot-to-date; a
 * future phase (Q4) compares against the full prior-year quarter, since
 * neither year has closed anything in that quarter yet.
 */
export function closedWonPriorYearForPhase(opps: Opportunity[], phase: FiscalPhase): number {
  const window = phaseWindow(phase);
  const currentEnd =
    window.end.getTime() > window.start.getTime() ? window.end : window.pipelineEnd;
  const priorStart = shiftYear(window.start, -1);
  const priorEnd = shiftYear(currentEnd, -1);
  return closedWonBetween(opps, priorStart, priorEnd);
}

function isInWindow(iso: string, window: PhaseWindow): boolean {
  const timestamp = new Date(iso).getTime();
  return timestamp >= window.start.getTime() && timestamp < window.end.getTime();
}

/**
 * The phase book of business. Open opportunities match by expected close
 * against the phase's full span (pipelineEnd), so pipeline scheduled later in
 * the phase stays visible; closed opportunities match by actual close against
 * the snapshot-truncated window, since outcomes only accrue through today.
 */
export function filterByPhase(opps: Opportunity[], phase: FiscalPhase): Opportunity[] {
  const window = phaseWindow(phase);
  const start = window.start.getTime();
  const closedEnd = window.end.getTime();
  const pipelineEnd = window.pipelineEnd.getTime();
  return opps.filter((opp) => {
    if (opp.outcome) {
      const closedAt = new Date(opp.closedAt ?? opp.expectedCloseDate).getTime();
      return closedAt >= start && closedAt < closedEnd;
    }
    const expectedClose = new Date(opp.expectedCloseDate).getTime();
    return expectedClose >= start && expectedClose < pipelineEnd;
  });
}

export function targetsForPhase(targets: Target[], phase: FiscalPhase): Target[] {
  const window = phaseWindow(phase);
  return targets.filter((target) => window.targetQuarters.includes(target.quarter));
}

export function closedWonForPhase(opps: Opportunity[], phase: FiscalPhase): number {
  const window = phaseWindow(phase);
  return closedWonBetween(opps, window.start, window.end);
}

/** Quota still to be closed for a fiscal phase. Zero once the target is met. */
export function remainingQuota(
  opps: Opportunity[],
  targets: Target[],
  phase: FiscalPhase = 'fy',
): number {
  const phaseTargets = targetsForPhase(targets, phase);
  const target = phaseTargets.reduce((sum, item) => sum + item.revenueTarget, 0);
  return Math.max(target - closedWonForPhase(opps, phase), 0);
}

/**
 * Target coverage as a three-way state, because a bare ratio cannot tell
 * "nothing was committed" apart from "the goal is already met" — both divide
 * by a zero gap, and neither is a coverage figure:
 *
 * - `no-target`: the phase carries no target rows (or only zero-value ones)
 *   for the scope. There is nothing to cover, so there is no coverage.
 * - `target-met`: closed-won has reached the target and the remaining gap is
 *   zero. Coverage of a zero gap is not a meaningful ratio.
 * - `coverage`: open in-phase pipeline over the quota still to close. The
 *   numerator spans the phase's full horizon — not just through the snapshot —
 *   because pipeline scheduled for the rest of the quarter/year is exactly
 *   what covers the remaining target.
 */
export type CoverageState =
  { kind: 'no-target' } | { kind: 'target-met' } | { kind: 'coverage'; value: number };

export function coverageState(
  opps: Opportunity[],
  targets: Target[],
  phase: FiscalPhase = 'fy',
): CoverageState {
  const phaseTargets = targetsForPhase(targets, phase);
  const target = phaseTargets.reduce((sum, item) => sum + item.revenueTarget, 0);
  if (target <= 0) return { kind: 'no-target' };
  const remaining = Math.max(target - closedWonForPhase(opps, phase), 0);
  if (remaining <= 0) return { kind: 'target-met' };
  return { kind: 'coverage', value: openPipeline(filterByPhase(opps, phase)).value / remaining };
}

/** Inputs are already access- and selection-scoped, with the phase applied. */
export function pipelineSummary(
  opportunities: Opportunity[],
  targets: Target[],
  phase: FiscalPhase,
) {
  const open = openPipeline(opportunities);
  const closedWon = closedWonForPhase(opportunities, phase);
  const target = targetsForPhase(targets, phase).reduce((sum, item) => sum + item.revenueTarget, 0);
  const remaining = Math.max(target - closedWon, 0);
  const coverage: CoverageState =
    target <= 0
      ? { kind: 'no-target' }
      : remaining <= 0
        ? { kind: 'target-met' }
        : { kind: 'coverage', value: open.value / remaining };
  return {
    openPipelineValue: open.value,
    openCount: open.count,
    closedWon,
    target,
    coverage,
    remainingQuota: remaining,
    avgOpenDealSize: open.count === 0 ? 0 : open.value / open.count,
    attainment: target > 0 ? closedWon / target : 0,
  };
}

export function formatCoverage(state: CoverageState): string {
  if (state.kind === 'no-target') return 'No target';
  if (state.kind === 'target-met') return 'Target met';
  return `${state.value.toFixed(1)}x`;
}

export interface LeaderboardRow {
  partner: Partner;
  openPipelineValue: number;
  openCount: number;
  closedWonValue: number;
  winRate: number;
}

export interface WeeklyActivityRow {
  weekStart: string;
  weekEnd: string;
  total: number;
  byType: Record<MeetingType, number>;
}

/**
 * Whether a meeting belongs to the requested manager/partner scope. The
 * session's classification, when one exists, reassigns the meeting, so
 * effective ownership is resolved FIRST: with a partner set in scope, the
 * classified-or-original partner alone decides inclusion. Applying the raw
 * calendar attribution on top would drop a cross-manager reclassification
 * from BOTH scopes — the old manager's partner set rejects it and the new
 * manager's raw manager rejects it — instead of moving it exactly once.
 * With no partner set, the raw manager decides, exactly as before.
 */
function inActivityScope(
  activity: ActivityMeeting,
  partnerManagerId: string | undefined,
  partnerIds: Set<string> | undefined,
  classification: MeetingClassification | undefined,
): boolean {
  if (partnerIds !== undefined) {
    return partnerIds.has(classification?.partnerId ?? activity.partnerId);
  }
  return partnerManagerId === undefined || activity.partnerManagerId === partnerManagerId;
}

export function weeklyActivity(
  activities: ActivityMeeting[],
  partnerManagerId?: string,
  partnerIds?: Set<string>,
  classifications?: Record<string, MeetingClassification>,
): WeeklyActivityRow[] {
  const currentWeek = startOfWeekUtc(SNAPSHOT_DATE);
  return Array.from({ length: 8 }, (_, index) => {
    const start = new Date(currentWeek.getTime() - (7 - index) * 7 * DAY);
    const end = new Date(start.getTime() + 7 * DAY);
    const byType = Object.fromEntries(MEETING_TYPES.map((type) => [type, 0])) as Record<
      MeetingType,
      number
    >;
    const filtered = activities.filter((activity) => {
      const occurredAt = new Date(activity.occurredAt).getTime();
      const inWeek = occurredAt >= start.getTime() && occurredAt < end.getTime();
      return (
        inWeek &&
        inActivityScope(activity, partnerManagerId, partnerIds, classifications?.[activity.id])
      );
    });
    for (const activity of filtered) {
      const type = classifications?.[activity.id]?.type ?? activity.type;
      byType[type] = (byType[type] ?? 0) + 1;
    }
    return {
      weekStart: start.toISOString(),
      weekEnd: new Date(end.getTime() - 1).toISOString(),
      total: filtered.length,
      byType,
    };
  });
}

export interface WeeklyGoalProgress {
  meetings: number;
  meetingsGoal: number;
  /** Meetings classified as Partner-Identified Opportunity Interlocks. */
  pioMeetings: number;
  pioGoal: number;
}

/** Days remaining in the given fiscal quarter as of the snapshot date. */
export function daysLeftInQuarter(quarter: string): number {
  const { end } = quarterWindow(quarter);
  return Math.max(0, Math.ceil((end.getTime() - SNAPSHOT_DATE.getTime()) / DAY));
}

/**
 * Current-week meeting volume toward the weekly goal, optionally scoped to a
 * partner manager and partner. Classified meetings use the manual override for
 * both partner and call type; unclassified meetings keep their snapshot values.
 * Membership resolves the classified partner before the manager filter — see
 * `inActivityScope` — so a cross-manager reclassification moves the meeting
 * exactly once.
 */
export function weeklyGoalProgress(
  activities: ActivityMeeting[],
  classifications: Record<string, MeetingClassification>,
  partnerManagerId?: string,
  partnerIds?: Set<string>,
): WeeklyGoalProgress {
  const weekStart = startOfWeekUtc(SNAPSHOT_DATE).getTime();
  const weekEnd = weekStart + 7 * DAY;
  let meetings = 0;
  let pioMeetings = 0;
  for (const activity of activities) {
    const occurredAt = new Date(activity.occurredAt).getTime();
    if (occurredAt < weekStart || occurredAt >= weekEnd) continue;
    const classification = classifications?.[activity.id];
    if (!inActivityScope(activity, partnerManagerId, partnerIds, classification)) continue;
    meetings += 1;
    if ((classification?.type ?? activity.type) === 'pio-interlock') pioMeetings += 1;
  }
  return {
    meetings,
    meetingsGoal: WEEKLY_MEETING_GOAL,
    pioMeetings,
    pioGoal: WEEKLY_PIO_GOAL,
  };
}

/**
 * The partner manager's current-week calendar meetings, oldest first. This is
 * the raw "Google Calendar import" the manager works from in Log Meetings.
 */
export function currentWeekMeetings(
  activities: ActivityMeeting[],
  partnerManagerId: string,
): ActivityMeeting[] {
  const weekStart = startOfWeekUtc(SNAPSHOT_DATE);
  const weekEnd = new Date(weekStart.getTime() + 7 * DAY);
  return activities
    .filter((activity) => {
      if (activity.partnerManagerId !== partnerManagerId) return false;
      const occurredAt = new Date(activity.occurredAt).getTime();
      return occurredAt >= weekStart.getTime() && occurredAt < weekEnd.getTime();
    })
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
}

/** Pending registrations, oldest first. Optionally scoped to one partner. */
export function pendingRegistrations(
  registrations: DealRegistration[],
  partnerId?: string,
): DealRegistration[] {
  return registrations
    .filter((reg) => reg.status === 'pending' && (!partnerId || reg.partnerId === partnerId))
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
}

/**
 * Registrations across every status, newest submission first with the id as
 * tiebreak: a total order over an immutable book, which is what makes a
 * cursor walk visit every row exactly once. This is the registration
 * history's stable order behind `listRecentRegistrations`.
 */
export function registrationsNewestFirst(registrations: DealRegistration[]): DealRegistration[] {
  return [...registrations].sort((a, b) =>
    a.submittedAt === b.submittedAt
      ? a.id.localeCompare(b.id)
      : new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
  );
}

/**
 * The notification roster with the session's overlays applied: status and
 * routing patches fold into the provider's roster by user id, and users
 * added this session append after it. The provider's roster stays the source
 * of truth — a patch naming an unknown id applies to nothing, and an
 * addition is the session's own row. Pure: inputs are not mutated.
 */
export function applyTeamRosterOverlays(
  users: readonly TeamUser[],
  overrides: Record<string, Partial<TeamUser>> = {},
  added: readonly TeamUser[] = [],
): TeamUser[] {
  const base = users.map((user) =>
    overrides[user.id] ? { ...user, ...overrides[user.id] } : user,
  );
  return [...base, ...added];
}

// ---- forecast quality ------------------------------------------------------

/** The bucket a forecast row sits in: its own category or the stage heuristic. */
export function forecastCategoryOf(opp: Opportunity): ForecastCategory {
  return opp.forecastCategory ?? FORECAST_CATEGORY_FOR_STAGE[opp.stage];
}

interface WeightedForecastRow {
  category: ForecastCategory;
  /** Probability-weighted value: Σ forecasted revenue × category weight. */
  value: number;
  count: number;
}

export interface WeightedForecast {
  total: number;
  rows: WeightedForecastRow[];
}

/**
 * Probability-weighted forecast over an open book: each deal contributes its
 * forecasted revenue times its category's probability weight, so the total is
 * the expected partner-sourced revenue rather than raw pipeline.
 */
export function weightedForecast(openOpps: Opportunity[]): WeightedForecast {
  const rows = FORECAST_CATEGORIES.map((category) => {
    let value = 0;
    let count = 0;
    for (const opp of openOpps) {
      if (forecastCategoryOf(opp) !== category) continue;
      value += opp.forecastedRevenue * FORECAST_CATEGORY_META[category].weight;
      count += 1;
    }
    return { category, value, count };
  });
  return {
    total: rows.reduce((sum, row) => sum + row.value, 0),
    rows,
  };
}

export interface WeeklyForecastRow {
  /** ISO start of the week bucket; the first bucket starts at the quarter start. */
  weekStart: string;
  /** ISO end of the week bucket (exclusive); the last bucket ends at the quarter end. */
  weekEnd: string;
  /** Open in-quarter pipeline per forecast category, raw dollars. */
  raw: Record<ForecastCategory, number>;
  /** The same pipeline per category, weighted by the category's probability. */
  weighted: Record<ForecastCategory, number>;
  /** Total open pipeline at the week's close (Σ raw). */
  total: number;
  /** Probability-weighted forecast at the week's close (Σ weighted). */
  weightedTotal: number;
  /** False until the week has begun as of the as-of date; future weeks carry zeros. */
  hasStarted: boolean;
  /**
   * When the week's state came from a recorded snapshot, the instant it was
   * taken. Undefined for a week reconstructed from the current book — the
   * in-progress week, or any week a provider has no history for.
   */
  recordedAt?: string;
}

/**
 * One recording instant of the quarter, folded to per-category open-pipeline
 * totals. This is the most history the metrics layer ever sees: the raw
 * snapshot rows are provider-private (they are ~87% of the payload at
 * production volume), and the provider folds them behind its seam — the
 * mock's `weeklyRecordingTotals` in `src/data/mock/book.ts`, a warehouse's
 * weekly fact query in production. One entry per recording instant, sorted
 * oldest first; the count is the quarter's week count, not the book's size.
 */
export interface RecordedWeekTotals {
  /** When the recording was taken (ISO 8601, UTC). */
  takenAt: string;
  /** Open in-quarter pipeline per forecast category, as recorded. */
  raw: Record<ForecastCategory, number>;
}

/**
 * Week-over-week state of one quarter's partner-sourced pipeline, one bucket
 * per week of the quarter: Monday-aligned, clipped at the quarter end, and
 * spanning the entire quarter so a new bucket lights up as each week begins.
 *
 * A quarter rarely starts on a Monday, so the days before the first Monday
 * join the first week rather than forming their own bucket: a two-day stub
 * beside a full week reads as two comparable weeks on a bar chart when it is
 * nothing of the kind.
 *
 * A bucket's values are the open book as it stood at the week's close,
 * counting only deals expected to close inside the quarter. Closed weeks come
 * from the recorded weekly totals, so they are immutable: an amount raised,
 * a deal re-called, or a close date slipped this week moves this week's bar
 * and leaves the earlier ones alone. Without history — a provider that
 * supplies none — a week is reconstructed from the current book instead,
 * which is only faithful about deals entering and leaving, and silently
 * backdates every other change. `recordedAt` says which kind of week a
 * caller is looking at.
 *
 * The in-progress week is always reconstructed from the live book (no
 * recording exists yet), so it equals the forecasting tiles and moves with
 * in-app edits.
 */
export function weeklyForecastRows(
  opps: Opportunity[],
  quarter: string,
  asOf: Date = SNAPSHOT_DATE,
  recorded: RecordedWeekTotals[] = [],
): WeeklyForecastRow[] {
  const { start, end } = quarterWindow(quarter);
  const qStart = start.getTime();
  const qEnd = end.getTime();
  const asOfTs = asOf.getTime();

  const startsOnMonday = startOfWeekUtc(start).getTime() === qStart;
  const starts = [qStart];
  // A quarter that opens mid-week gives its first bucket the stub days plus
  // the following full week, so every bucket on the axis is at least a week.
  let cursor = startOfWeekUtc(start).getTime() + (startsOnMonday ? 7 : 14) * DAY;
  while (cursor < qEnd) {
    starts.push(cursor);
    cursor += 7 * DAY;
  }

  const byInstant = new Map<number, RecordedWeekTotals>();
  for (const recording of recorded) {
    byInstant.set(new Date(recording.takenAt).getTime(), recording);
  }
  const instants = [...byInstant.keys()].sort((a, b) => a - b);

  return starts.map((weekStart, index) => {
    const weekEnd = index + 1 < starts.length ? starts[index + 1] : qEnd;
    const hasStarted = weekStart <= asOfTs;
    // State at the week's close; the in-progress week freezes at the as-of date.
    const at = Math.min(weekEnd, asOfTs);
    // The latest recording inside this bucket. Requiring it past weekStart is
    // what keeps the in-progress week from reusing last week's recording.
    const recordedAt = instants.reduce<number | undefined>(
      (latest, instant) => (instant > weekStart && instant <= at ? instant : latest),
      undefined,
    );

    const raw = Object.fromEntries(FORECAST_CATEGORIES.map((category) => [category, 0])) as Record<
      ForecastCategory,
      number
    >;
    const weighted = { ...raw };
    const add = (category: ForecastCategory, revenue: number) => {
      raw[category] += revenue;
      weighted[category] += revenue * FORECAST_CATEGORY_META[category].weight;
    };

    if (hasStarted && recordedAt !== undefined) {
      const totals = byInstant.get(recordedAt)!.raw;
      for (const category of FORECAST_CATEGORIES) {
        add(category, totals[category]);
      }
    } else if (hasStarted) {
      for (const opp of opps) {
        const expectedClose = new Date(opp.expectedCloseDate).getTime();
        if (expectedClose < qStart || expectedClose >= qEnd) continue;
        if (new Date(opp.createdAt).getTime() > at) continue;
        const closedAt = opp.closedAt ? new Date(opp.closedAt).getTime() : undefined;
        if (closedAt !== undefined && closedAt <= at) continue;
        add(forecastCategoryOf(opp), opp.forecastedRevenue);
      }
    }

    return {
      weekStart: new Date(weekStart).toISOString(),
      weekEnd: new Date(weekEnd).toISOString(),
      raw,
      weighted,
      total: FORECAST_CATEGORIES.reduce((sum, category) => sum + raw[category], 0),
      weightedTotal: FORECAST_CATEGORIES.reduce((sum, category) => sum + weighted[category], 0),
      hasStarted,
      ...(hasStarted && recordedAt !== undefined
        ? { recordedAt: new Date(recordedAt).toISOString() }
        : {}),
    };
  });
}

interface CategoryMismatch {
  opportunity: Opportunity;
  /** The category the deal's stage implies. */
  fromStage: ForecastCategory;
  /** The category actually called on the deal. */
  called: ForecastCategory;
  /** 'above' when called more confidently than the stage implies. */
  direction: 'above' | 'below';
}

export interface CategoryMismatches {
  above: CategoryMismatch[];
  below: CategoryMismatch[];
  /** Forecasted revenue carried by each side, for sizing the exposure. */
  aboveValue: number;
  belowValue: number;
}

/**
 * Open deals whose called forecast category disagrees with the category their
 * stage implies.
 *
 * This is the point of tracking a category separately from a stage. A deal
 * called Commit while sitting in Discovery is either a stale stage or an
 * unsupported call, and a Long Shot in late-stage review usually means the
 * deal is dying in a way the pipeline report still shows as healthy. Both are
 * conversations; neither is visible from stage alone.
 */
export function categoryStageMismatches(openOpps: Opportunity[]): CategoryMismatches {
  const above: CategoryMismatch[] = [];
  const below: CategoryMismatch[] = [];

  for (const opportunity of openOpps) {
    const fromStage = FORECAST_CATEGORY_FOR_STAGE[opportunity.stage];
    const called = forecastCategoryOf(opportunity);
    if (called === fromStage) continue;
    const direction =
      FORECAST_CATEGORIES.indexOf(called) > FORECAST_CATEGORIES.indexOf(fromStage)
        ? 'above'
        : 'below';
    (direction === 'above' ? above : below).push({
      opportunity,
      fromStage,
      called,
      direction,
    });
  }

  const sum = (rows: CategoryMismatch[]) =>
    rows.reduce((total, row) => total + row.opportunity.forecastedRevenue, 0);

  return { above, below, aboveValue: sum(above), belowValue: sum(below) };
}

// ---- deal-registration ops -------------------------------------------------

/** Whole calendar days between two ISO dates (snapshot-relative comparisons). */
export function calendarDaysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY);
}

export type SlaState = 'within-sla' | 'past-sla';

/**
 * Pending-registration SLA state: within target while the submission is less
 * than REGISTRATION_SLA_BUSINESS_DAYS business days old, past it otherwise.
 */
export function registrationSlaState(reg: DealRegistration): SlaState {
  return businessDaysBetween(reg.submittedAt, SNAPSHOT_DATE.toISOString()) >=
    REGISTRATION_SLA_BUSINESS_DAYS
    ? 'past-sla'
    : 'within-sla';
}

/** Pending registrations currently outside the response SLA, oldest first. */
export function registrationsPastSla(registrations: DealRegistration[]): DealRegistration[] {
  return registrations
    .filter((reg) => reg.status === 'pending' && registrationSlaState(reg) === 'past-sla')
    .sort((a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime());
}

/** Approved registrations that never produced an opportunity, oldest decision first. */
export function approvedNotConverted(registrations: DealRegistration[]): DealRegistration[] {
  return registrations
    .filter((reg) => reg.status === 'approved' && reg.decisionAt !== undefined && !reg.convertedTo)
    .sort((a, b) => new Date(a.decisionAt!).getTime() - new Date(b.decisionAt!).getTime());
}

/**
 * Exclusivity window: the lead keeps exclusivity for
 * REGISTRATION_EXCLUSIVITY_DAYS calendar days after approval. Approved leads
 * still without an opportunity past that window have lapsed exclusivity.
 */
export function exclusivityLapsed(reg: DealRegistration): boolean {
  return (
    reg.status === 'approved' &&
    reg.decisionAt !== undefined &&
    !reg.convertedTo &&
    calendarDaysBetween(reg.decisionAt, SNAPSHOT_DATE.toISOString()) > REGISTRATION_EXCLUSIVITY_DAYS
  );
}

/** Business days a pending registration has been waiting as of the snapshot. */
export function businessDaysWaiting(reg: DealRegistration): number {
  return businessDaysBetween(reg.submittedAt, SNAPSHOT_DATE.toISOString());
}

type RegistrationSlaAlertState = 'approaching' | 'breached';

/**
 * A pending registration that has reached (or is about to reach) the response
 * SLA, paired with the internal user expected to act on it.
 */
export interface RegistrationSlaAlert {
  registration: DealRegistration;
  /** The submitting partner, when the book still carries it. */
  partner?: Partner;
  /** Resolved owner: the aligned partner manager, or the deal desk. */
  owner?: TeamUser;
  /** Business days the submission has been waiting at the snapshot. */
  businessDaysWaiting: number;
  /** Business days left before the SLA lapses; at or below zero once past it. */
  businessDaysRemaining: number;
  state: RegistrationSlaAlertState;
  /** The day the response falls due, the SLA's business days after submission. */
  dueAt: string; // ISO 8601
}

/**
 * Pending registrations that need their owner's attention now: those already
 * past REGISTRATION_SLA_BUSINESS_DAYS, and those within
 * REGISTRATION_SLA_WARNING_BUSINESS_DAYS of it — one business day before the
 * deadline, which is the heads-up the partner team asked for. Business days
 * are not hours: when the deadline is a Monday, the warning fires on Friday.
 *
 * Ownership is resolved the way the data model routes it: the submitting
 * partner's aligned partner manager, and the deal desk for anything with no
 * active manager (the queue is theirs either way). An alert with no owner is
 * still returned — it is a roster gap, not something to hide.
 *
 * The one-business-day-out warnings lead the queue: they are the ones with a
 * working day left in them, so acting on one prevents the lapse rather than
 * reporting it. Past-SLA registrations follow, most overdue first.
 */
export function registrationSlaAlerts(
  registrations: DealRegistration[],
  partners: Partner[],
  teamUsers: TeamUser[],
  warningBusinessDays = REGISTRATION_SLA_WARNING_BUSINESS_DAYS,
): RegistrationSlaAlert[] {
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const orderedUsers = [...teamUsers].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const managerUserByManagerId = new Map<string, TeamUser>();
  for (const user of orderedUsers) {
    if (user.role !== 'partner-manager' || user.status !== 'active') continue;
    // Match Action Center's stable ID ordering, independent of roster input order.
    if (user.partnerManagerId && !managerUserByManagerId.has(user.partnerManagerId)) {
      managerUserByManagerId.set(user.partnerManagerId, user);
    }
  }
  // The deal desk works the whole queue, so it catches alerts whose manager
  // has left, been suspended, or was never set.
  const fallbackOwner = orderedUsers.find(
    (user) => user.role === 'deal-desk-ops' && user.status === 'active',
  );

  const alerts: RegistrationSlaAlert[] = [];
  for (const registration of registrations) {
    if (registration.status !== 'pending') continue;
    const waiting = businessDaysBetween(registration.submittedAt, SNAPSHOT_DATE.toISOString());
    const remaining = REGISTRATION_SLA_BUSINESS_DAYS - waiting;
    const state: RegistrationSlaAlertState | null =
      remaining <= 0 ? 'breached' : remaining <= warningBusinessDays ? 'approaching' : null;
    if (!state) continue;
    const partner = partnerById.get(registration.partnerId);
    alerts.push({
      registration,
      partner,
      owner: (partner && managerUserByManagerId.get(partner.partnerManagerId)) ?? fallbackOwner,
      businessDaysWaiting: waiting,
      businessDaysRemaining: remaining,
      state,
      dueAt: businessDaysAfter(
        registration.submittedAt,
        REGISTRATION_SLA_BUSINESS_DAYS,
      ).toISOString(),
    });
  }

  return alerts.sort((a, b) => {
    if (a.state !== b.state) return a.state === 'approaching' ? -1 : 1;
    return a.businessDaysRemaining - b.businessDaysRemaining;
  });
}

export interface RegistrationConversionTimes {
  /**
   * Avg business days from submission to approval (approved registrations
   * only). This is the hop the response SLA clocks, so it is measured in the
   * SLA's own unit — a calendar-day average read against a 5-business-day SLA
   * compares two different clocks.
   */
  submittedToApprovedBusinessDays: number | null;
  /** Avg elapsed calendar days from approval to opportunity creation (converted registrations only). */
  approvedToOpportunityCalendarDays: number | null;
  /** Avg elapsed calendar days from opportunity creation to closed-won (converted + won only). */
  opportunityToWinCalendarDays: number | null;
  /** Avg elapsed calendar days from submission to closed-won (converted + won only). */
  submittedToWinCalendarDays: number | null;
}

/**
 * Average conversion times across a registration book, chained as
 * submitted → approved → opportunity created → win. Every hop is averaged
 * only over the registrations that reached it; null when nothing has.
 *
 * Units are part of the contract and part of the field names: the approval
 * hop is business days, so it can be read directly against the response SLA,
 * and every other hop is elapsed calendar days.
 */
export function registrationConversionTimes(
  registrations: DealRegistration[],
  opportunities: Opportunity[],
): RegistrationConversionTimes {
  const oppById = new Map(opportunities.map((opp) => [opp.id, opp]));
  const average = (durations: number[]) =>
    durations.length === 0
      ? null
      : Math.round((durations.reduce((sum, d) => sum + d, 0) / durations.length) * 10) / 10;

  const approved = registrations.filter(
    (reg) => reg.status === 'approved' && reg.decisionAt !== undefined,
  );
  const submittedToApproved = approved.map((reg) =>
    businessDaysBetween(reg.submittedAt, reg.decisionAt!),
  );
  const converted = approved.filter(
    (reg) => reg.convertedTo !== undefined && oppById.has(reg.convertedTo),
  );
  const approvedToOpportunity = converted.map((reg) => {
    const opp = oppById.get(reg.convertedTo!)!;
    return calendarDaysBetween(reg.decisionAt!, opp.createdAt);
  });
  const won = converted.filter((reg) => {
    const opp = oppById.get(reg.convertedTo!)!;
    return opp.outcome === 'won' && opp.closedAt !== undefined;
  });
  const opportunityToWin = won.map((reg) => {
    const opp = oppById.get(reg.convertedTo!)!;
    return calendarDaysBetween(opp.createdAt, opp.closedAt!);
  });
  const submittedToWin = won.map((reg) => {
    const opp = oppById.get(reg.convertedTo!)!;
    return calendarDaysBetween(reg.submittedAt, opp.closedAt!);
  });

  return {
    submittedToApprovedBusinessDays: average(submittedToApproved),
    approvedToOpportunityCalendarDays: average(approvedToOpportunity),
    opportunityToWinCalendarDays: average(opportunityToWin),
    submittedToWinCalendarDays: average(submittedToWin),
  };
}

export interface DuplicateRegistrationGroup {
  accountName: string;
  /** Every registration for this client, oldest submission first. */
  registrations: DealRegistration[];
  /** The first partner to submit for this client. */
  firstSubmitted: DealRegistration;
  /** How many distinct partners registered the same client. */
  distinctPartners: number;
}

/**
 * Conflicting deal registrations: one client registered by two or more
 * different partners, so the earliest submission and the overlap must be
 * tracked and qualified closely. Internal view only.
 */
export function duplicateRegistrationGroups(
  registrations: DealRegistration[],
  partners: Partner[],
): DuplicateRegistrationGroup[] {
  const byAccount = new Map<string, DealRegistration[]>();
  for (const reg of registrations) {
    const list = byAccount.get(reg.accountName);
    if (list) list.push(reg);
    else byAccount.set(reg.accountName, [reg]);
  }
  const groups: DuplicateRegistrationGroup[] = [];
  for (const [accountName, regs] of byAccount) {
    const sorted = [...regs].sort(
      (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime(),
    );
    const distinct = new Set(sorted.map((reg) => reg.partnerId));
    if (distinct.size < 2) continue;
    const valid = sorted.filter((reg) => partners.some((partner) => partner.id === reg.partnerId));
    if (valid.length < 2) continue;
    groups.push({
      accountName,
      registrations: valid,
      firstSubmitted: valid[0],
      distinctPartners: distinct.size,
    });
  }
  return groups.sort(
    (a, b) =>
      new Date(a.firstSubmitted.submittedAt).getTime() -
      new Date(b.firstSubmitted.submittedAt).getTime(),
  );
}
