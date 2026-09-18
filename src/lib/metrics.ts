import { CURRENT_YEAR, OPP_TYPES, QUARTERS, SNAPSHOT_DATE, STAGES } from '../data/constants';
import type {
  DashboardData,
  DealRegistration,
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
  return { value: open.reduce((sum, opp) => sum + opp.amount, 0), count: open.length };
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
    .reduce((sum, opp) => sum + opp.amount, 0);
}

export function closedWonYtd(opps: Opportunity[]): number {
  return closedWonBetween(opps, `${CURRENT_YEAR}-01-01`, SNAPSHOT_DATE.toISOString());
}

/** Prior-year closed-won over the same span of the year, for deltas. */
export function closedWonPriorYearSamePeriod(opps: Opportunity[]): number {
  const cutoff = new Date(
    Date.UTC(CURRENT_YEAR - 1, SNAPSHOT_DATE.getUTCMonth(), SNAPSHOT_DATE.getUTCDate()),
  ).toISOString();
  return closedWonBetween(opps, `${CURRENT_YEAR - 1}-01-01`, cutoff);
}

export function winRateYtd(opps: Opportunity[]): number {
  const start = new Date(`${CURRENT_YEAR}-01-01`).getTime();
  const end = SNAPSHOT_DATE.getTime();
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
  const cutoff = new Date(`${CURRENT_YEAR}-01-01`).getTime();
  for (const opp of opps) {
    if (new Date(opp.createdAt).getTime() >= cutoff) active.add(opp.partnerId);
  }
  for (const reg of registrations) {
    if (new Date(reg.submittedAt).getTime() >= cutoff) active.add(reg.partnerId);
  }
  return active.size;
}

export interface RegistrationFunnel {
  submitted: number;
  submittedValue: number;
  approved: number;
  approvedValue: number;
  converted: number;
  convertedValue: number;
  rejected: number;
  pending: number;
}

export function registrationFunnel(registrations: DealRegistration[]): RegistrationFunnel {
  let submittedValue = 0;
  let approved = 0;
  let approvedValue = 0;
  let converted = 0;
  let convertedValue = 0;
  let rejected = 0;
  let pending = 0;

  for (const reg of registrations) {
    submittedValue += reg.amount;
    if (reg.status === 'pending') {
      pending += 1;
    } else if (reg.status === 'rejected') {
      rejected += 1;
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
    pending,
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
      value: inStage.reduce((sum, opp) => sum + opp.amount, 0),
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
    wonValue: won.reduce((sum, opp) => sum + opp.amount, 0),
    lostCount: lost.length,
    lostValue: lost.reduce((sum, opp) => sum + opp.amount, 0),
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
      value: ofType.reduce((sum, opp) => sum + opp.amount, 0),
    };
  });
}

export interface QuarterRevenueRow {
  quarter: string;
  closedWon: number;
  target: number;
}

function quarterOfDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
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
  return QUARTERS.map((quarter) => ({
    quarter,
    closedWon: opps
      .filter(
        (opp) => opp.outcome === 'won' && opp.closedAt && quarterOfDate(opp.closedAt) === quarter,
      )
      .reduce((sum, opp) => sum + opp.amount, 0),
    target: targetByQuarter.get(quarter) ?? 0,
  }));
}

export function ytdTarget(targets: Target[]): number {
  return targets
    .filter((target) => target.quarter.startsWith(String(CURRENT_YEAR)))
    .reduce((sum, target) => sum + target.revenueTarget, 0);
}

/** YTD quota still to be closed. Zero once the target is met. */
export function remainingQuota(opps: Opportunity[], targets: Target[]): number {
  return Math.max(ytdTarget(targets) - closedWonYtd(opps), 0);
}

/**
 * Open pipeline over the YTD quota still to be closed. Null when the target is
 * already met, since coverage of a zero gap is not a meaningful ratio.
 */
export function coverageRatio(opps: Opportunity[], targets: Target[]): number | null {
  const remaining = remainingQuota(opps, targets);
  if (remaining <= 0) return null;
  return openPipeline(opps).value / remaining;
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
): LeaderboardRow[] {
  const opps = filterByType(data.opportunities, oppType);
  const rows = data.partners.map((partner) => {
    const partnerOpps = opps.filter((opp) => opp.partnerId === partner.id);
    const pipeline = openPipeline(partnerOpps);
    return {
      partner,
      openPipelineValue: pipeline.value,
      openCount: pipeline.count,
      closedWonYtdValue: closedWonYtd(partnerOpps),
      winRate: winRateYtd(partnerOpps),
    };
  });
  return rows.sort(
    (a, b) => b.closedWonYtdValue - a.closedWonYtdValue || b.openPipelineValue - a.openPipelineValue,
  );
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
