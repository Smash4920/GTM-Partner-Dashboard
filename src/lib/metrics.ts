import {
  FISCAL_PHASES,
  FISCAL_QUARTERS,
  FISCAL_YEAR,
  FISCAL_YEAR_START,
  MEETING_TYPES,
  OPP_TYPES,
  SNAPSHOT_DATE,
  STAGES,
} from '../data/constants';
import type {
  ActivityMeeting,
  DashboardData,
  DealRegistration,
  FiscalPhase,
  MeetingType,
  Opportunity,
  OpportunityStage,
  OpportunityType,
  Partner,
  Target,
} from '../data/types';

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

export function closedWonYtd(opps: Opportunity[]): number {
  return closedWonForPhase(opps, 'fy');
}

/** Prior-year closed-won over the same span of the year, for deltas. */
export function closedWonPriorYearSamePeriod(opps: Opportunity[]): number {
  return closedWonPriorYearForPhase(opps, 'fy');
}

export function winRateYtd(opps: Opportunity[]): number {
  return winRateForPhase(opps, 'fy');
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

/** Partners with an opportunity or registration created this calendar year. */
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

export function fiscalQuarterOfDate(iso: string): string {
  const date = new Date(iso);
  const month = date.getUTCMonth();
  const fiscalYear = month === 0 ? date.getUTCFullYear() : date.getUTCFullYear() + 1;
  const quarter = month === 0 || month === 10 || month === 11
    ? 4
    : month >= 1 && month <= 3
      ? 1
      : month >= 4 && month <= 6
        ? 2
        : 3;
  return `FY${String(fiscalYear).slice(-2)}-Q${quarter}`;
}

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
  start: Date;
  end: Date;
  targetQuarters: string[];
}

function quarterWindow(quarter: string): { start: Date; end: Date } {
  const [, fiscalYearText, quarterText] = quarter.match(/^FY(\d+)-Q(\d)$/) ?? [];
  const fiscalYear = Number(fiscalYearText);
  const q = Number(quarterText);
  const calendarStartYear = 2000 + fiscalYear - 1;
  const start = new Date(Date.UTC(calendarStartYear, 1 + (q - 1) * 3, 1));
  const end =
    q === 4
      ? new Date(Date.UTC(calendarStartYear + 1, 1, 1))
      : new Date(Date.UTC(calendarStartYear, 1 + q * 3, 1));
  return { start, end };
}

export function phaseWindow(phase: FiscalPhase): PhaseWindow {
  if (phase === 'fy') {
    return {
      phase,
      start: FISCAL_YEAR_START,
      end: SNAPSHOT_DATE,
      targetQuarters: [...FISCAL_QUARTERS],
    };
  }
  const quarter = FISCAL_QUARTERS[FISCAL_PHASES.indexOf(phase) - 1];
  const { start, end } = quarterWindow(quarter);
  return {
    phase,
    start,
    end: phase === 'q3' ? SNAPSHOT_DATE : end,
    targetQuarters: [quarter],
  };
}

export function closedWonPriorYearForPhase(
  opps: Opportunity[],
  phase: FiscalPhase,
): number {
  const window = phaseWindow(phase);
  const priorStart = new Date(
    Date.UTC(window.start.getUTCFullYear() - 1, window.start.getUTCMonth(), window.start.getUTCDate()),
  );
  const priorEnd = new Date(
    Date.UTC(window.end.getUTCFullYear() - 1, window.end.getUTCMonth(), window.end.getUTCDate()),
  );
  return closedWonBetween(opps, priorStart.toISOString(), priorEnd.toISOString());
}

function isInWindow(iso: string, window: PhaseWindow): boolean {
  const timestamp = new Date(iso).getTime();
  return timestamp >= window.start.getTime() && timestamp < window.end.getTime();
}

/**
 * Filters open opportunities by expected close and closed opportunities by
 * actual close. This keeps a phase useful for both pipeline and performance.
 */
export function filterByPhase(opps: Opportunity[], phase: FiscalPhase): Opportunity[] {
  const window = phaseWindow(phase);
  return opps.filter((opp) =>
    isInWindow(opp.outcome ? opp.closedAt ?? opp.expectedCloseDate : opp.expectedCloseDate, window),
  );
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
 * Open pipeline over the YTD quota still to be closed. Null when the target is
 * already met, since coverage of a zero gap is not a meaningful ratio.
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
  closedWonYtdValue: number;
  winRate: number;
}

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
      closedWonYtdValue: closedWonForPhase(partnerOpps, phase),
      winRate: winRateForPhase(partnerOpps, phase),
    };
    });
  return rows.sort(
    (a, b) => b.closedWonYtdValue - a.closedWonYtdValue || b.openPipelineValue - a.openPipelineValue,
  );
}

export interface WeeklyActivityRow {
  weekStart: string;
  weekEnd: string;
  total: number;
  byType: Record<MeetingType, number>;
}

function startOfWeek(date: Date): Date {
  const copy = new Date(date);
  const day = copy.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  copy.setUTCDate(copy.getUTCDate() - daysSinceMonday);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export function weeklyActivity(
  activities: ActivityMeeting[],
  partnerManagerId?: string,
  partnerIds?: Set<string>,
): WeeklyActivityRow[] {
  const currentWeek = startOfWeek(SNAPSHOT_DATE);
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
      const inPartner = !partnerIds || partnerIds.has(activity.partnerId);
      return inWeek && inManager && inPartner;
    });
    for (const activity of filtered) {
      byType[activity.type] = (byType[activity.type] ?? 0) + 1;
    }
    return {
      weekStart: start.toISOString(),
      weekEnd: new Date(end.getTime() - 1).toISOString(),
      total: filtered.length,
      byType,
    };
  });
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
