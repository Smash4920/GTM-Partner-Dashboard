import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PartnerPerformanceView from './PartnerPerformanceView';
import {
  makeCertification,
  makeDashboardData,
  makeMeeting,
  makeOpportunity,
  makePartner,
  makeRegistration,
  makeTarget,
} from '../test/fixtures';
import type { DashboardData, MeetingClassification } from '../data/types';

/**
 * Partner Performance: the manager → partner → phase drill-down, the guarded
 * attainment math when a target row is missing or zero, and the empty copy
 * every panel falls back to. Branch behaviour is the point — the view is a wall
 * of conditional labels, and its attainment ratio is the same division that
 * once rendered "∞% of goal" elsewhere in the app.
 *
 * Dates are pinned to the fixed SNAPSHOT_DATE fiscal calendar (FY27 Q3 runs
 * Aug–Oct 2026 through the snapshot of 18 Sep), never to the wall clock.
 */

const NO_CLASSIFICATIONS: Record<string, MeetingClassification> = {};

/** A book with one open Q3 deal, a Q3 win, a loss, a prior-year win and a Q4 deal. */
function makeBook(): DashboardData {
  return makeDashboardData({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({
        id: 'partner-1',
        name: 'Northwind Systems',
        partnerManagerId: 'pm-1',
        tier: 'gold',
        region: 'na',
      }),
      makePartner({
        id: 'partner-2',
        name: 'Beacon Consulting',
        partnerManagerId: 'pm-1',
        tier: 'silver',
        region: 'emea',
      }),
      makePartner({
        id: 'partner-3',
        name: 'Cobalt Group',
        partnerManagerId: 'pm-2',
        tier: 'platinum',
        region: 'apac',
      }),
    ],
    opportunities: [
      // Open, scheduled inside Q3 and after the snapshot.
      makeOpportunity({
        id: 'opp-open',
        partnerId: 'partner-1',
        forecastedRevenue: 250_000,
        createdAt: '2026-08-03T00:00:00.000Z',
        expectedCloseDate: '2026-10-15T00:00:00.000Z',
      }),
      makeOpportunity({
        id: 'opp-won',
        partnerId: 'partner-1',
        outcome: 'won',
        forecastedRevenue: 120_000,
        createdAt: '2026-08-01T00:00:00.000Z',
        expectedCloseDate: '2026-09-01T00:00:00.000Z',
        closedAt: '2026-09-01T00:00:00.000Z',
      }),
      makeOpportunity({
        id: 'opp-lost',
        partnerId: 'partner-2',
        outcome: 'lost',
        forecastedRevenue: 60_000,
        createdAt: '2026-08-05T00:00:00.000Z',
        expectedCloseDate: '2026-09-05T00:00:00.000Z',
        closedAt: '2026-09-05T00:00:00.000Z',
      }),
      // The same span of last year: the only source of the prior-period delta.
      makeOpportunity({
        id: 'opp-prior-year',
        partnerId: 'partner-1',
        outcome: 'won',
        forecastedRevenue: 100_000,
        createdAt: '2025-08-01T00:00:00.000Z',
        expectedCloseDate: '2025-09-10T00:00:00.000Z',
        closedAt: '2025-09-10T00:00:00.000Z',
      }),
      // Open but scheduled for Q4, so outside every Q3 window.
      makeOpportunity({
        id: 'opp-q4',
        partnerId: 'partner-3',
        forecastedRevenue: 90_000,
        createdAt: '2026-08-06T00:00:00.000Z',
        expectedCloseDate: '2026-11-20T00:00:00.000Z',
      }),
    ],
    registrations: [
      // Pending, inside the 5-business-day SLA as of the snapshot.
      makeRegistration({
        id: 'reg-pending-new',
        partnerId: 'partner-1',
        accountName: 'Acme Freight',
        amount: 180_000,
        submittedAt: '2026-09-14T00:00:00.000Z',
        status: 'pending',
      }),
      // Pending and long past it.
      makeRegistration({
        id: 'reg-pending-old',
        partnerId: 'partner-2',
        accountName: 'Borealis Labs',
        amount: 90_000,
        submittedAt: '2026-08-20T00:00:00.000Z',
        status: 'pending',
      }),
      // Approved, never converted, and past the 60-day exclusivity window.
      makeRegistration({
        id: 'reg-lapsed',
        partnerId: 'partner-1',
        accountName: 'Cobalt Health',
        amount: 140_000,
        submittedAt: '2026-06-01T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-06-03T00:00:00.000Z',
      }),
      // Approved and converted into the Q3 win: the one row that fills every
      // conversion hop.
      makeRegistration({
        id: 'reg-converted',
        partnerId: 'partner-2',
        accountName: 'Delta Energy',
        amount: 110_000,
        submittedAt: '2026-07-20T00:00:00.000Z',
        status: 'approved',
        decisionAt: '2026-07-25T00:00:00.000Z',
        convertedTo: 'opp-won',
      }),
      // A second partner registering a client the first one already holds.
      makeRegistration({
        id: 'reg-conflict',
        partnerId: 'partner-2',
        accountName: 'Cobalt Health',
        amount: 130_000,
        submittedAt: '2026-06-05T00:00:00.000Z',
        status: 'pending',
      }),
    ],
    targets: [makeTarget({ partnerId: 'partner-1', quarter: 'FY27-Q3', revenueTarget: 100_000 })],
    certifications: [
      makeCertification({
        partnerId: 'partner-1',
        partnerStrategistsCertified: 2,
        partnerStrategistsGoal: 4,
        partnerEngineersCertified: 3,
        partnerEngineersGoal: 6,
      }),
    ],
    activities: [
      makeMeeting({
        id: 'meeting-mon',
        partnerId: 'partner-1',
        occurredAt: '2026-09-14T15:00:00.000Z',
        type: 'pio-interlock',
      }),
      makeMeeting({
        id: 'meeting-tue',
        partnerId: 'partner-2',
        occurredAt: '2026-09-15T09:00:00.000Z',
        type: 'discovery',
      }),
    ],
  });
}

function renderView(data: DashboardData = makeBook()) {
  render(<PartnerPerformanceView data={data} classifications={NO_CLASSIFICATIONS} />);
}

/** The card whose <h2> carries this title, so queries cannot leak across panels. */
function cardWith(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  return heading.closest('section') as HTMLElement;
}

/** The signal label above the h1, which carries the manager/partner selection. */
function scopeLabel(): HTMLElement {
  const heading = screen.getByRole('heading', { name: 'Partner Performance' });
  return heading.parentElement as HTMLElement;
}

/** A KPI row's display value, found by its label rather than by position. */
function metricRowValue(card: HTMLElement, label: string): HTMLElement {
  const row = within(card).getByText(label).closest('li') as HTMLElement;
  return row;
}

describe('PartnerPerformanceView', () => {
  it('renders the whole-org book against the snapshot quarter', () => {
    renderView();

    expect(within(scopeLabel()).getByText('All Partners')).toBeInTheDocument();
    expect(screen.getByText('Scope · whole org · 3 partners')).toBeInTheDocument();

    // 250k open in Q3, 120k closed-won against a 100k target, 100k a year
    // earlier: +20% on the prior period and 120% of target.
    expect(screen.getByText('1 open Q3 opps')).toBeInTheDocument();
    // The pipeline tile, the average-open-deal tile, and the Scope stage bar
    // all read the same single open deal.
    expect(screen.getAllByText('$250K')).toHaveLength(3);
    expect(screen.getByText('120% of Q3 target')).toBeInTheDocument();
    expect(screen.getByText('▲ +20% vs prior period')).toBeInTheDocument();
    // Closed-won already exceeds the target, so there is no gap to cover.
    expect(screen.getByText('Target met')).toBeInTheDocument();
    expect(screen.getByText('Sourced target achieved')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('with FY activity · of 3 aligned')).toBeInTheDocument();

    // Two calls this week, one of them a PIO interlock.
    expect(within(cardWith('Weekly partner activity')).getByText('2 meetings')).toBeInTheDocument();
    expect(within(cardWith('Progress to weekly goal')).getByText('2/10')).toBeInTheDocument();
    expect(within(cardWith('Progress to weekly goal')).getByText('1/3')).toBeInTheDocument();

    // The pending queue is phase-filtered; ops leakage deliberately is not, so
    // the Q2 registrations still count against the SLAs and the funnel.
    expect(
      screen.getByText(
        '2 pending in scope · oldest first · colored against the 5-business-day SLA',
      ),
    ).toBeInTheDocument();
    expect(metricRowValue(cardWith('Registration leakage'), 'Pending past SLA')).toHaveTextContent(
      '2',
    );
    expect(
      screen.getByText(
        '1 approved registrations without an opportunity · 1 past the 60-day exclusivity window',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/^1 clients registered by more than one partner/)).toBeInTheDocument();

    // The leaderboard ranks on closed-won for the phase.
    const leaderboardRows = within(cardWith('Partner leaderboard & enablement'))
      .getAllByRole('row')
      .slice(1);
    expect(leaderboardRows).toHaveLength(3);
    expect(within(leaderboardRows[0]).getByText('Northwind Systems')).toBeInTheDocument();
  });

  it('describes the registration SLA breach boundary as inclusive (VAL-DATA-007)', () => {
    renderView();

    // registrationSlaState lapses at exactly 5 business days, so the leakage
    // row must say 5+, not "> 5" — at the due-date boundary the count and
    // its explanation would otherwise disagree.
    const leakage = cardWith('Registration leakage');
    expect(within(leakage).getByText('5+ business days awaiting review')).toBeInTheDocument();
    expect(within(leakage).queryByText(/> 5 business days/)).not.toBeInTheDocument();
  });

  it('re-scopes to one partner and then to one manager', async () => {
    const user = userEvent.setup();
    renderView();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-1');

    expect(within(scopeLabel()).getByText('Northwind Systems')).toBeInTheDocument();
    expect(screen.getByText('Scope · whole org · 1 partner')).toBeInTheDocument();
    expect(screen.getByText('with FY activity · of 1 aligned')).toBeInTheDocument();
    expect(
      screen.getByText('1 partner in this scope · certification counts show attainment below'),
    ).toBeInTheDocument();

    // A single selected partner gets its own enablement card.
    const certifications = cardWith('Northwind Systems certifications');
    expect(within(certifications).getByText('2/4')).toBeInTheDocument();
    expect(within(certifications).getByText('3/6')).toBeInTheDocument();

    // Changing the manager resets the partner dropdown to the new book.
    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner manager' }), 'pm-2');

    expect(screen.getByRole('combobox', { name: 'Partner' })).toHaveValue('all');
    expect(screen.getByRole('option', { name: 'All Partners (1 aligned)' })).toBeInTheDocument();
    expect(within(scopeLabel()).getByText('R. Diaz · All Partners')).toBeInTheDocument();
    expect(screen.getByText('Scope · R. Diaz · 1 partner')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Northwind Systems certifications' }),
    ).not.toBeInTheDocument();
  });

  it('says a partner has no certification record rather than inventing one', async () => {
    const user = userEvent.setup();
    renderView();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner' }), 'partner-2');

    const certifications = cardWith('Beacon Consulting certifications');
    expect(within(certifications).getAllByText('No certification data')).toHaveLength(2);
    expect(within(certifications).getAllByText('0/1')).toHaveLength(2);
  });

  it('switches the fiscal phase, including year-to-date and an empty quarter', async () => {
    const user = userEvent.setup();
    renderView();

    await user.click(screen.getByRole('button', { name: 'FY' }));

    expect(screen.getByText('Won (FY27 to date)')).toBeInTheDocument();
    expect(screen.getByText('Lost (FY27 to date)')).toBeInTheDocument();
    expect(screen.getByText('120% of FY27 target')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pipeline opportunities · FY' }),
    ).toBeInTheDocument();

    // Q4 has a deal but no target row, so attainment reads 0% and coverage
    // reports the missing target honestly rather than as "Target met".
    await user.click(screen.getByRole('button', { name: 'Q4' }));

    expect(screen.getByText('Won (FY27 Q4)')).toBeInTheDocument();
    expect(screen.getByText('0% of Q4 target')).toBeInTheDocument();
    expect(screen.getByText('No target')).toBeInTheDocument();
    expect(screen.getByText('No sourced target set')).toBeInTheDocument();
    expect(screen.queryByText('Target met')).not.toBeInTheDocument();

    // Q1 closed before the snapshot with nothing in it at all.
    await user.click(screen.getByRole('button', { name: 'Q1' }));

    expect(screen.getByText('No Q1 opportunities for this scope.')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Pipeline opportunities · Q1' }),
    ).toBeInTheDocument();
  });

  describe('attainment guards', () => {
    // Regression shape: the app has shipped an unguarded division that reached
    // Intl.NumberFormat as Infinity and printed "∞% of goal" to a partner.
    it('reads a missing target row as no target, never as target met', () => {
      renderView(makeDashboardData({ targets: [] }));

      expect(screen.getByText('0% of Q3 target')).toBeInTheDocument();
      expect(screen.getByText('No target')).toBeInTheDocument();
      expect(screen.getByText('No sourced target set')).toBeInTheDocument();
      expect(screen.queryByText('Target met')).not.toBeInTheDocument();
      // With no win a year earlier there is no prior period to measure against.
      expect(screen.queryByText(/vs prior period/)).not.toBeInTheDocument();
      expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
      expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    it('reads a zero-value target as no target', () => {
      renderView(makeDashboardData({ targets: [makeTarget({ revenueTarget: 0 })] }));

      expect(screen.getByText('0% of Q3 target')).toBeInTheDocument();
      expect(screen.getByText('No target')).toBeInTheDocument();
      expect(screen.queryByText('Target met')).not.toBeInTheDocument();
      expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
      expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    it('reports the quota still to source while the target is unmet', () => {
      renderView(
        makeDashboardData({
          // 100k of open Q3 pipeline covering a 300k target, nothing closed yet.
          opportunities: [
            makeOpportunity({
              id: 'opp-open',
              forecastedRevenue: 100_000,
              createdAt: '2026-08-03T00:00:00.000Z',
              expectedCloseDate: '2026-10-15T00:00:00.000Z',
            }),
          ],
          targets: [makeTarget({ revenueTarget: 300_000 })],
        }),
      );

      expect(screen.getByText('0% of Q3 target')).toBeInTheDocument();
      expect(screen.getByText('$300K sourced target remaining')).toBeInTheDocument();
      expect(screen.getByText('0.3x')).toBeInTheDocument();
      expect(screen.queryByText('Target met')).not.toBeInTheDocument();
    });

    it('reports a shortfall against the prior period as a negative delta', () => {
      renderView(
        makeDashboardData({
          // 50k closed against 200k a year earlier, on a 40k target.
          opportunities: [
            makeOpportunity({
              id: 'opp-won',
              outcome: 'won',
              forecastedRevenue: 50_000,
              createdAt: '2026-08-01T00:00:00.000Z',
              expectedCloseDate: '2026-09-01T00:00:00.000Z',
              closedAt: '2026-09-01T00:00:00.000Z',
            }),
            makeOpportunity({
              id: 'opp-prior-year',
              outcome: 'won',
              forecastedRevenue: 200_000,
              createdAt: '2025-08-01T00:00:00.000Z',
              expectedCloseDate: '2025-09-10T00:00:00.000Z',
              closedAt: '2025-09-10T00:00:00.000Z',
            }),
          ],
          targets: [makeTarget({ revenueTarget: 40_000 })],
        }),
      );

      expect(screen.getByText('▼ -75% vs prior period')).toBeInTheDocument();
      expect(screen.getByText('125% of Q3 target')).toBeInTheDocument();
      expect(screen.getByText('Sourced target achieved')).toBeInTheDocument();
    });
  });

  it('falls back to empty copy for a book with nothing in it', () => {
    renderView(
      makeDashboardData({
        partnerManagers: [],
        partners: [],
        opportunities: [],
        registrations: [],
        targets: [],
        certifications: [],
        activities: [],
      }),
    );

    expect(screen.getByText('Scope · whole org · 0 partners')).toBeInTheDocument();
    expect(screen.getByText('0% of Q3 target')).toBeInTheDocument();
    expect(screen.getByText('No target')).toBeInTheDocument();
    expect(screen.getByText('No sourced target set')).toBeInTheDocument();
    expect(screen.getByText('No Q3 opportunities for this scope.')).toBeInTheDocument();
    expect(screen.getByText('Nothing here — the queue is clear.')).toBeInTheDocument();
    expect(
      screen.getByText('No approved registrations without an opportunity — nothing leaking.'),
    ).toBeInTheDocument();
    expect(screen.getByText('No conflicting registrations in this scope.')).toBeInTheDocument();

    // No registration reached any hop, so none of the four averages is a number.
    expect(within(cardWith('Registration conversion time')).getAllByText('—')).toHaveLength(4);
    expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});
