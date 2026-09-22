import { describe, expect, it } from 'vitest';
import {
  FISCAL_QUARTERS,
  FISCAL_YEAR_START,
  FORECAST_CATEGORIES,
  FORECAST_CATEGORY_FOR_STAGE,
  SNAPSHOT_DATE,
} from '../constants';
import {
  approvedNotConverted,
  avgOpenDealSize,
  closedWonPriorYearForPhase,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  filterByPhase,
  phaseWindow,
  registrationsPastSla,
} from '../../lib/metrics';
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

  it('models a roughly $250k ACV with variance in the open Q3 book', () => {
    const average = avgOpenDealSize(filterByPhase(data.opportunities, 'q3'));
    expect(average).toBeGreaterThan(225_000);
    expect(average).toBeLessThan(275_000);
  });

  it('assigns every opportunity a forecast category', () => {
    for (const opportunity of data.opportunities) {
      expect(opportunity.forecastCategory).toBeDefined();
    }
  });

  it('derives closed opportunity categories from their final stage', () => {
    // A category is a forward-looking call, so once a deal resolves it simply
    // tracks the stage it ended in.
    for (const opportunity of data.opportunities) {
      if (!opportunity.outcome) continue;
      expect(opportunity.forecastCategory).toBe(FORECAST_CATEGORY_FOR_STAGE[opportunity.stage]);
    }
  });

  it('calls a minority of open deals off the category their stage implies', () => {
    // The point of a forecast category is that it can disagree with the stage:
    // a Commit still in Discovery, or a Long Shot in late-stage review. If the
    // two never diverged the category would carry no information at all, so
    // the generator seeds a deliberate minority of disagreements.
    const open = data.opportunities.filter((opportunity) => !opportunity.outcome);
    const offStage = open.filter(
      (opportunity) =>
        opportunity.forecastCategory !== FORECAST_CATEGORY_FOR_STAGE[opportunity.stage],
    );
    const share = offStage.length / open.length;
    expect(share).toBeGreaterThan(0.05);
    expect(share).toBeLessThan(0.25);
    // Both directions must appear, or the weighted forecast is biased one way.
    const rank = (category: (typeof FORECAST_CATEGORIES)[number]) =>
      FORECAST_CATEGORIES.indexOf(category);
    expect(
      offStage.some(
        (opportunity) =>
          rank(opportunity.forecastCategory!) >
          rank(FORECAST_CATEGORY_FOR_STAGE[opportunity.stage]),
      ),
    ).toBe(true);
    expect(
      offStage.some(
        (opportunity) =>
          rank(opportunity.forecastCategory!) <
          rank(FORECAST_CATEGORY_FOR_STAGE[opportunity.stage]),
      ),
    ).toBe(true);
  });

  it('seeds some open opportunities with a next step and leaves others blank', () => {
    const open = data.opportunities.filter((opportunity) => !opportunity.outcome);
    expect(open.length).toBeGreaterThan(0);
    expect(open.some((opportunity) => opportunity.nextStep)).toBe(true);
    expect(open.some((opportunity) => opportunity.nextStep === undefined)).toBe(true);
  });

  it('gives converted registrations a dwell time before their opportunity is created', () => {
    const converted = data.registrations.filter(
      (registration) => registration.status === 'approved' && registration.convertedTo,
    );
    expect(converted.length).toBeGreaterThan(0);
    const gaps = converted.map((registration) => {
      const opportunity = data.opportunities.find((opp) => opp.id === registration.convertedTo);
      expect(opportunity).toBeDefined();
      return (
        new Date(opportunity!.createdAt).getTime() - new Date(registration.decisionAt!).getTime()
      );
    });
    // Approvals near the snapshot clamp the opportunity at the snapshot date;
    // everything older carries the full 2–12 day document-handling dwell.
    expect(gaps.every((gap) => gap >= 0)).toBe(true);
    expect(gaps.some((gap) => gap >= 2 * 86_400_000)).toBe(true);
    const average = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    expect(average).toBeGreaterThan(86_400_000);
  });

  it('seeds exclusivity-lapsed, past-SLA, and duplicate registrations for the ops views', () => {
    expect(data.registrations.some(exclusivityLapsed)).toBe(true);
    const leaking = approvedNotConverted(data.registrations);
    expect(leaking.length).toBeGreaterThan(0);
    expect(leaking.some(exclusivityLapsed)).toBe(true);
    expect(registrationsPastSla(data.registrations).length).toBeGreaterThan(0);
    const groups = duplicateRegistrationGroups(data.registrations, data.partners);
    expect(groups.length).toBeGreaterThan(0);
    // Every duplicate groups at least two distinct partners on one client.
    for (const group of groups) {
      expect(group.distinctPartners).toBeGreaterThanOrEqual(2);
      expect(group.registrations.length).toBeGreaterThanOrEqual(2);
    }
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
