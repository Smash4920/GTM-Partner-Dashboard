import {
  FISCAL_PHASES,
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
  SNAPSHOT_DATE,
  STAGES,
  WEEKLY_MEETING_GOAL,
  WEEKLY_PIO_GOAL,
} from '../data/constants';
import type {
  ActivityMeeting,
  DashboardData,
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
} from '../data/types';
import { fiscalQuarterOfDate, quarterWindow, startOfWeekUtc } from './fiscal';

const DAY = 86_400_000;

export function isOpen(opp: Opportunity): boolean {
  return opp.outcome === undefined;
}

export function openOpportunities(opps: Opportunity[]): Opportunity[] {
  return opps.filter(isOpen);
}

export function filterByType(
  opps: Opportunity[],
  oppType: OpportunityType | 'all',
): Opportunity[] {
  return oppType === 'all' ? opps : opps.filter((opp) => opp.oppType === oppType);
}

export function openPipeline(opps: Opportunity[]): { value: number; count: number } {
  const open = openOpportunities(opps);
  return {
    value: open.reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
    count: open.length,
  };
}

/** Closed-won revenue whose close date falls in [start, end). */
export function closedWonBetween(opps: Opportunity[], startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
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
export function activePartnerCount(
  opps: Opportunity[],
  registrations: DealRegistration[],
): number {
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
          opp.outcome === 'won' &&
          opp.closedAt &&
          fiscalQuarterOfDate(opp.closedAt) === quarter,
      )
      .reduce((sum, opp) => sum + opp.forecastedRevenue, 0),
    target: targetByQuarter.get(quarter) ?? 0,
  }));
}

export function ytdTarget(targets: Target[]): number {
  return targets
    .filter((target) => target.quarter.startsWith(FISCAL_YEAR))
    .reduce((sum, target) => sum + target.revenueTarget, 0);
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
  return new Date(
    Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()),
  );
}

/**
 * Prior-year closed-won over the same span of the year, for deltas.
 * In-progress phases compare snapshot-to-date against snapshot-to-date; a
 * future phase (Q4) compares against the full prior-year quarter, since
 * neither year has closed anything in that quarter yet.
 */
export function closedWonPriorYearForPhase(
  opps: Opportunity[],
  phase: FiscalPhase,
): number {
  const window = phaseWindow(phase);
  const currentEnd = window.end.getTime() > window.start.getTime() ? window.end : window.pipelineEnd;
  const priorStart = shiftYear(window.start, -1);
  const priorEnd = shiftYear(currentEnd, -1);
  return closedWonBetween(opps, priorStart.toISOString(), priorEnd.toISOString());
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
  return opps
    .filter((opp) => opp.outcome === 'won' && opp.closedAt && isInWindow(opp.closedAt, window))
    .reduce((sum, opp) => sum + opp.forecastedRevenue, 0);
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
 * Open pipeline scheduled anywhere in the phase, over the quota still to be
 * closed for that phase. The numerator spans the phase's full horizon — not
 * just through the snapshot — because pipeline scheduled for the rest of the
 * quarter/year is exactly what covers the remaining target. Null when the
 * target is already met, since coverage of a zero gap is not a meaningful
 * ratio.
 */
export function coverageRatio(
  opps: Opportunity[],
  targets: Target[],
  phase: FiscalPhase = 'fy',
): number | null {
  const remaining = remainingQuota(opps, targets, phase);
  if (remaining <= 0) return null;
  return openPipeline(filterByPhase(opps, phase)).value / remaining;
}

export function formatCoverage(coverage: number | null): string {
  return coverage === null ? 'Target met' : `${coverage.toFixed(1)}x`;
}

export interface LeaderboardRow {
  partner: Partner;
  openPipelineValue: number;
  openCount: number;
  closedWonValue: number;
  winRate: number;
}

/** Ranks partners on closed-won for the given phase, then on open pipeline. */
export function partnerLeaderboard(
  data: DashboardData,
  oppType: OpportunityType | 'all',
  partnerIds?: Set<string>,
  phase: FiscalPhase = 'fy',
): LeaderboardRow[] {
  const opps = filterByType(data.opportunities, oppType);
  const rows = data.partners
    .filter((partner) => !partnerIds || partnerIds.has(partner.id))
    .map((partner) => {
      const partnerOpps = opps.filter((opp) => opp.partnerId === partner.id);
      const pipeline = openPipeline(partnerOpps);
      return {
        partner,
        openPipelineValue: pipeline.value,
        openCount: pipeline.count,
        closedWonValue: closedWonForPhase(partnerOpps, phase),
        winRate: winRateForPhase(partnerOpps, phase),
      };
    });
  return rows.sort(
    (a, b) => b.closedWonValue - a.closedWonValue || b.openPipelineValue - a.openPipelineValue,
  );
}

export interface WeeklyActivityRow {
  weekStart: string;
  weekEnd: string;
  total: number;
  byType: Record<MeetingType, number>;
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
    const byType = Object.fromEntries(
      MEETING_TYPES.map((type) => [type, 0]),
    ) as Record<MeetingType, number>;
    const filtered = activities.filter((activity) => {
      const occurredAt = new Date(activity.occurredAt).getTime();
      const inWeek = occurredAt >= start.getTime() && occurredAt < end.getTime();
      const inManager = !partnerManagerId || activity.partnerManagerId === partnerManagerId;
      // Classified meetings count toward the partner scope of the override.
      const classification = classifications?.[activity.id];
      const partnerId = classification?.partnerId ?? activity.partnerId;
      const inPartner = !partnerIds || partnerIds.has(partnerId);
      return inWeek && inManager && inPartner;
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
    if (partnerManagerId && activity.partnerManagerId !== partnerManagerId) continue;
    const classification = classifications?.[activity.id];
    const partnerId = classification?.partnerId ?? activity.partnerId;
    if (partnerIds && !partnerIds.has(partnerId)) continue;
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

/** Most recent registrations for one partner. */
export function recentRegistrations(
  registrations: DealRegistration[],
  partnerId: string,
  limit: number,
): DealRegistration[] {
  return registrations
    .filter((reg) => reg.partnerId === partnerId)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
    .slice(0, limit);
}

/** Days a registration has been waiting as of the snapshot date. */
export function daysWaiting(reg: DealRegistration): number {
  return Math.round((SNAPSHOT_DATE.getTime() - new Date(reg.submittedAt).getTime()) / DAY);
}

// ---- forecast quality ------------------------------------------------------

/** The bucket a forecast row sits in: its own category or the stage heuristic. */
export function forecastCategoryOf(opp: Opportunity): ForecastCategory {
  return opp.forecastCategory ?? FORECAST_CATEGORY_FOR_STAGE[opp.stage];
}

export interface WeightedForecastRow {
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

// ---- deal-registration ops -------------------------------------------------

/** Weekdays (Mon–Fri, UTC) between two ISO dates, exclusive of the start day. */
export function businessDaysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const startMs = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const endMs = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let days = 0;
  for (let timestamp = startMs + DAY; timestamp <= endMs; timestamp += DAY) {
    const weekday = new Date(timestamp).getUTCDay();
    if (weekday !== 0 && weekday !== 6) days += 1;
  }
  return days;
}

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

export interface RegistrationConversionTimes {
  /** Avg days from submission to approval (approved registrations only). */
  submittedToApproved: number | null;
  /** Avg days from approval to opportunity creation (converted registrations only). */
  approvedToOpportunity: number | null;
  /** Avg days from opportunity creation to closed-won (converted + won only). */
  opportunityToWin: number | null;
  /** Avg days from submission to closed-won (converted + won only). */
  submittedToWin: number | null;
}

/**
 * Average conversion times across a registration book, chained as
 * submitted → approved → opportunity created → win. Every hop is averaged
 * only over the registrations that reached it; null when nothing has.
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
    calendarDaysBetween(reg.submittedAt, reg.decisionAt!),
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
    submittedToApproved: average(submittedToApproved),
    approvedToOpportunity: average(approvedToOpportunity),
    opportunityToWin: average(opportunityToWin),
    submittedToWin: average(submittedToWin),
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
    const valid = sorted.filter((reg) =>
      partners.some((partner) => partner.id === reg.partnerId),
    );
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
