import { describe, expect, it } from 'vitest';
import {
  CURRENT_FISCAL_QUARTER,
  FISCAL_QUARTERS,
  FISCAL_YEAR_START,
  FORECAST_CATEGORIES,
  FORECAST_CATEGORY_FOR_STAGE,
  REGISTRATION_SLA_WARNING_BUSINESS_DAYS,
  SNAPSHOT_DATE,
} from '../constants';
import { quarterWindow } from '../../lib/fiscal';
import {
  approvedNotConverted,
  avgOpenDealSize,
  closedWonPriorYearForPhase,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  filterByPhase,
  phaseWindow,
  registrationSlaAlerts,
  registrationsPastSla,
} from '../../lib/metrics';
import { generateDashboardData } from './generate';
import { MockDataProvider } from './MockDataProvider';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';

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

  it('covers every partner with a target in every FY27 quarter but one', () => {
    // The most recently onboarded partner has not committed a target for the
    // upcoming quarter (see generateTargets), so the "no target" coverage
    // state exists in the demo data rather than only in fixtures.
    const upcomingQuarter = FISCAL_QUARTERS[FISCAL_QUARTERS.length - 1];
    const newest = data.partners.reduce((latest, partner) =>
      new Date(partner.joinedAt).getTime() > new Date(latest.joinedAt).getTime() ? partner : latest,
    );
    expect(data.targets).toHaveLength(25 * FISCAL_QUARTERS.length - 1);
    for (const quarter of FISCAL_QUARTERS) {
      expect(data.targets.filter((target) => target.quarter === quarter)).toHaveLength(
        quarter === upcomingQuarter ? 24 : 25,
      );
    }
    expect(
      data.targets.some(
        (target) => target.partnerId === newest.id && target.quarter === upcomingQuarter,
      ),
    ).toBe(false);
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

  it('records a weekly snapshot of the open book, Monday-aligned, never past the snapshot', () => {
    expect(data.snapshots.length).toBeGreaterThan(0);
    const oppById = new Map(data.opportunities.map((opportunity) => [opportunity.id, opportunity]));
    const instants = new Set<string>();
    for (const row of data.snapshots) {
      instants.add(row.takenAt);
      const takenAt = new Date(row.takenAt);
      expect(takenAt.getUTCDay()).toBe(1); // Monday
      expect(takenAt.getTime()).toBeLessThanOrEqual(SNAPSHOT_DATE.getTime());
      expect(takenAt.getTime()).toBeGreaterThanOrEqual(FISCAL_YEAR_START.getTime());
      const opportunity = oppById.get(row.opportunityId);
      expect(opportunity).toBeDefined();
      expect(row.forecastedRevenue).toBeGreaterThan(0);
      // Only deals that existed and had not yet resolved are in the open book.
      expect(new Date(opportunity!.createdAt).getTime()).toBeLessThanOrEqual(takenAt.getTime());
      if (opportunity!.closedAt) {
        expect(new Date(opportunity!.closedAt).getTime()).toBeGreaterThan(takenAt.getTime());
      }
    }
    // One recording per week from the first Monday of FY27 to the snapshot week.
    expect(instants.size).toBe(33);
    // No opportunity is recorded twice in one week.
    const keys = new Set(data.snapshots.map((row) => `${row.takenAt}|${row.opportunityId}`));
    expect(keys.size).toBe(data.snapshots.length);
  });

  it('drifts amounts, calls, and close dates so week-over-week movement is real', () => {
    const oppById = new Map(data.opportunities.map((opportunity) => [opportunity.id, opportunity]));
    const moved = { amount: 0, call: 0, stage: 0, closeDate: 0, grew: 0, cut: 0 };
    for (const row of data.snapshots) {
      const current = oppById.get(row.opportunityId)!;
      if (row.forecastedRevenue !== current.forecastedRevenue) {
        moved.amount += 1;
        if (row.forecastedRevenue < current.forecastedRevenue) moved.grew += 1;
        else moved.cut += 1;
      }
      if (row.forecastCategory !== current.forecastCategory) moved.call += 1;
      if (row.stage !== current.stage) moved.stage += 1;
      if (row.expectedCloseDate !== current.expectedCloseDate) moved.closeDate += 1;
    }
    // Every field a forecast conversation turns on must have moved for some
    // deal at some point, or history is just today's book repeated weekly.
    expect(moved.amount).toBeGreaterThan(0);
    expect(moved.call).toBeGreaterThan(0);
    expect(moved.stage).toBeGreaterThan(0);
    expect(moved.closeDate).toBeGreaterThan(0);
    // Both directions: deals that grew as scope firmed up, and deals cut back.
    expect(moved.grew).toBeGreaterThan(0);
    expect(moved.cut).toBeGreaterThan(0);
  });

  it('seeds a slip out of Q3 and a pull-in, so the quarter shows both moves', () => {
    const { start, end } = quarterWindow('FY27-Q3');
    const inQuarter = (iso: string) => {
      const time = new Date(iso).getTime();
      return time >= start.getTime() && time < end.getTime();
    };
    const oppById = new Map(data.opportunities.map((opportunity) => [opportunity.id, opportunity]));
    // A slip: recorded inside Q3, now expected after it, so the week it moved
    // reads as a drop rather than the deal never having been there.
    const slips = data.snapshots.filter(
      (row) =>
        inQuarter(row.expectedCloseDate) &&
        !inQuarter(oppById.get(row.opportunityId)!.expectedCloseDate),
    );
    expect(slips.length).toBeGreaterThan(0);
    // A pull-in: recorded outside Q3, now expected inside it.
    const pullIns = data.snapshots.filter(
      (row) =>
        !inQuarter(row.expectedCloseDate) &&
        inQuarter(oppById.get(row.opportunityId)!.expectedCloseDate),
    );
    expect(pullIns.length).toBeGreaterThan(0);
  });

  it('leaves the latest recording in step with the current book', () => {
    // The most recent Monday is the handoff between recorded history and the
    // live book, so the two must not disagree about a deal open in both.
    const latest = data.snapshots
      .map((row) => row.takenAt)
      .reduce((max, takenAt) => (takenAt > max ? takenAt : max));
    expect(latest).toBe('2026-09-14T00:00:00.000Z');
    const oppById = new Map(data.opportunities.map((opportunity) => [opportunity.id, opportunity]));
    for (const row of data.snapshots.filter((candidate) => candidate.takenAt === latest)) {
      const opportunity = oppById.get(row.opportunityId)!;
      expect(row.forecastedRevenue).toBe(opportunity.forecastedRevenue);
      expect(row.forecastCategory).toBe(opportunity.forecastCategory);
      expect(row.expectedCloseDate).toBe(opportunity.expectedCloseDate);
      expect(row.stage).toBe(opportunity.stage);
    }
  });

  it('seeds an internal partner-team roster with a manager alignment per manager', () => {
    expect(data.teamUsers).toHaveLength(8);
    const emails = new Set(data.teamUsers.map((user) => user.email));
    expect(emails.size).toBe(data.teamUsers.length);
    expect(new Set(data.teamUsers.map((user) => user.id)).size).toBe(data.teamUsers.length);

    // Every partner manager has an authorized user aligned to them, which is
    // what turns a registration into somebody's notification.
    const managerUsers = data.teamUsers.filter((user) => user.role === 'partner-manager');
    expect(managerUsers).toHaveLength(5);
    for (const partnerManager of data.partnerManagers) {
      expect(
        managerUsers.some(
          (user) => user.partnerManagerId === partnerManager.id && user.status === 'active',
        ),
      ).toBe(true);
    }

    const managerIds = new Set(data.partnerManagers.map((manager) => manager.id));
    for (const user of data.teamUsers) {
      if (user.partnerManagerId) expect(managerIds.has(user.partnerManagerId)).toBe(true);
      if (user.status === 'active') expect(user.authorizedAt).toBeDefined();
      else expect(user.authorizedAt).toBeUndefined();
    }

    // The roster carries an unaligned role (the queue owner) and a user still
    // awaiting authorization, so both states are visible in the access panel.
    expect(data.teamUsers.some((user) => user.role === 'deal-desk-ops')).toBe(true);
    expect(data.teamUsers.some((user) => user.status === 'invited')).toBe(true);
  });

  it('seeds pending registrations in the one-business-day-out SLA warning window', () => {
    const alerts = registrationSlaAlerts(data.registrations, data.partners, data.teamUsers);
    const approaching = alerts.filter((alert) => alert.state === 'approaching');
    // One per seeded partner, so the warning reaches several owners at once.
    expect(approaching).toHaveLength(3);
    expect(new Set(approaching.map((alert) => alert.registration.partnerId)).size).toBe(
      approaching.length,
    );
    for (const alert of approaching) {
      expect(alert.businessDaysRemaining).toBe(REGISTRATION_SLA_WARNING_BUSINESS_DAYS);
      expect(alert.owner).toBeDefined();
    }
    // And the lapsed side of the rule has real rows too.
    expect(alerts.some((alert) => alert.state === 'breached')).toBe(true);
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
      teamUsers,
    ] = await Promise.all([
      provider.listPartnerManagers(INTERNAL_DEMO_SCOPE),
      provider.listPartners(INTERNAL_DEMO_SCOPE),
      provider.listRegistrations(INTERNAL_DEMO_SCOPE),
      provider.listOpportunities(INTERNAL_DEMO_SCOPE),
      provider.getTargets(INTERNAL_DEMO_SCOPE),
      provider.listActivities(INTERNAL_DEMO_SCOPE),
      provider.listCertifications(INTERNAL_DEMO_SCOPE),
      provider.listTeamUsers(INTERNAL_DEMO_SCOPE),
    ]);
    expect(managers).toHaveLength(5);
    expect(partners).toHaveLength(25);
    expect(registrations).toHaveLength(180);
    expect(opportunities.length).toBeGreaterThan(200);
    expect(targets).toHaveLength(99);
    expect(activities.length).toBeGreaterThan(100);
    expect(certifications).toHaveLength(25);
    expect(teamUsers).toHaveLength(8);
  });

  it('keeps weekly history off the client contract', async () => {
    const provider = new MockDataProvider();
    // The collection that used to cross the seam — ~1,900 rows here, ~2.3 M at
    // production volume — is gone from the contract entirely. History leaves
    // only as the week-over-week series, which is ~13 buckets.
    expect('listPipelineSnapshots' in provider).toBe(false);

    const { data: weeks, meta } = await provider.getWeeklyForecastSeries(INTERNAL_DEMO_SCOPE, {
      quarter: CURRENT_FISCAL_QUARTER,
    });
    expect(weeks.length).toBeGreaterThan(10);
    expect(weeks.length).toBeLessThan(20);
    expect(weeks.some((week) => week.recordedAt !== undefined)).toBe(true);
    // Every bucket has a recorded basis, so the answer is complete.
    expect(meta.completeness).toBe('complete');
  });
});
