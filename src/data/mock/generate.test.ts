import { describe, expect, it } from 'vitest';
import { FISCAL_QUARTERS, FISCAL_YEAR_START, SNAPSHOT_DATE } from '../constants';
import { closedWonPriorYearForPhase, filterByPhase, phaseWindow } from '../../lib/metrics';
import { generateDashboardData } from './generate';
import { MockDataProvider } from './MockDataProvider';

const PHASES = ['fy', 'q1', 'q2', 'q3', 'q4'] as const;

describe('generateDashboardData', () => {
  const data = generateDashboardData();

  it('is deterministic for the fixed seed', () => {
    expect(generateDashboardData()).toEqual(data);
  });

  it('keeps every cross-record reference intact', () => {
    const partnerIds = new Set(data.partners.map((partner) => partner.id));
    const managerIds = new Set(data.partnerManagers.map((manager) => manager.id));
    expect(partnerIds.size).toBe(25);
    expect(managerIds.size).toBe(5);
    for (const partner of data.partners) {
      expect(managerIds.has(partner.partnerManagerId)).toBe(true);
    }
    for (const opportunity of data.opportunities) {
      expect(partnerIds.has(opportunity.partnerId)).toBe(true);
      expect(opportunity.forecastedRevenue).toBeGreaterThan(0);
    }
    for (const registration of data.registrations) {
      expect(partnerIds.has(registration.partnerId)).toBe(true);
    }
    for (const activity of data.activities) {
      expect(partnerIds.has(activity.partnerId)).toBe(true);
      expect(managerIds.has(activity.partnerManagerId)).toBe(true);
    }
    for (const certification of data.certifications) {
      expect(partnerIds.has(certification.partnerId)).toBe(true);
      expect(certification.partnerStrategistsCertified).toBeLessThanOrEqual(
        certification.partnerStrategistsGoal,
      );
      expect(certification.partnerEngineersCertified).toBeLessThanOrEqual(
        certification.partnerEngineersGoal,
      );
    }
  });

  it('covers every partner with a target in every FY27 quarter', () => {
    expect(data.targets).toHaveLength(25 * FISCAL_QUARTERS.length);
    for (const quarter of FISCAL_QUARTERS) {
      expect(data.targets.filter((target) => target.quarter === quarter)).toHaveLength(25);
    }
  });

  it('never closes an opportunity after the snapshot, and never dates an open one', () => {
    const snapshot = SNAPSHOT_DATE.getTime();
    for (const opportunity of data.opportunities) {
      if (opportunity.outcome) {
        expect(opportunity.closedAt).toBeDefined();
        // Closes may land exactly on the snapshot day; never after it.
        expect(new Date(opportunity.closedAt!).getTime()).toBeLessThanOrEqual(snapshot);
      } else {
        expect(opportunity.closedAt).toBeUndefined();
      }
    }
  });

  it('seeds prior-year closed-won for every phase delta', () => {
    for (const phase of PHASES) {
      expect(closedWonPriorYearForPhase(data.opportunities, phase)).toBeGreaterThan(0);
    }
  });

  it('keeps the prior-year book out of every FY27 phase window', () => {
    const fiscalStart = FISCAL_YEAR_START.getTime();
    const priorCloses = data.opportunities.filter(
      (opportunity) =>
        opportunity.outcome &&
        opportunity.closedAt !== undefined &&
        new Date(opportunity.closedAt).getTime() < fiscalStart,
    );
    expect(priorCloses.length).toBeGreaterThan(0);
    for (const phase of PHASES) {
      const inPhase = filterByPhase(data.opportunities, phase);
      expect(
        inPhase.some(
          (opportunity) =>
            opportunity.outcome &&
            opportunity.closedAt !== undefined &&
            new Date(opportunity.closedAt).getTime() < fiscalStart,
        ),
      ).toBe(false);
    }
  });

  it('produces the documented volumes', () => {
    expect(data.registrations).toHaveLength(180);
    expect(data.opportunities).toHaveLength(213); // FY27 book + prior-year book
    // 163 = past seven weeks (seeded pool) + current week, one calendar per
    // partner manager sized for the 10-meeting weekly goal.
    expect(data.activities).toHaveLength(163);
    // The current week yields a full working calendar for every manager.
    const weekStart = new Date('2026-09-14T00:00:00Z').getTime();
    const weekEnd = new Date('2026-09-21T00:00:00Z').getTime();
    const currentWeek = data.activities.filter((activity) => {
      const occurredAt = new Date(activity.occurredAt).getTime();
      return occurredAt >= weekStart && occurredAt < weekEnd;
    });
    expect(currentWeek).toHaveLength(44);
    for (const manager of data.partnerManagers) {
      const managerWeek = currentWeek.filter(
        (activity) => activity.partnerManagerId === manager.id,
      );
      expect(managerWeek.length).toBeGreaterThanOrEqual(7);
    }
  });

  it('matches the documented realized win rate over FY27 closed deals', () => {
    const window = phaseWindow('fy');
    const closed = data.opportunities.filter((opportunity) => {
      if (!opportunity.outcome || !opportunity.closedAt) return false;
      const closedAt = new Date(opportunity.closedAt).getTime();
      return closedAt >= window.start.getTime() && closedAt < window.end.getTime();
    });
    const won = closed.filter((opportunity) => opportunity.outcome === 'won').length;
    // 20 of 44 closed FY27 deals won ≈ 45% realized win rate (README).
    expect(closed.length).toBe(44);
    expect(won).toBe(20);
  });
});

describe('MockDataProvider', () => {
  it('fills every DataProvider collection', async () => {
    const provider = new MockDataProvider();
    const [
      managers,
      partners,
      registrations,
      opportunities,
      targets,
      activities,
      certifications,
    ] = await Promise.all([
      provider.listPartnerManagers(),
      provider.listPartners(),
      provider.listRegistrations(),
      provider.listOpportunities(),
      provider.getTargets(),
      provider.listActivities(),
      provider.listCertifications(),
    ]);
    expect(managers).toHaveLength(5);
    expect(partners).toHaveLength(25);
    expect(registrations).toHaveLength(180);
    expect(opportunities.length).toBeGreaterThan(200);
    expect(targets).toHaveLength(100);
    expect(activities.length).toBeGreaterThan(100);
    expect(certifications).toHaveLength(25);
  });
});
