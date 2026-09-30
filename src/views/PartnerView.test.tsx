import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PartnerView from './PartnerView';
import {
  makeCertification,
  makeDashboardData,
  makeOpportunity,
  makePartner,
  makeRegistration,
  makeTarget,
} from '../test/fixtures';

describe('PartnerView picker limitation (VAL-GOV-008)', () => {
  it('labels the picker as an untrusted demo selector, not authorization', () => {
    render(<PartnerView data={makeDashboardData()} />);

    // The picker stays unchanged; the visible copy states its boundary.
    expect(screen.getByText(/Demo selector/)).toBeInTheDocument();
    expect(screen.getByText(/client filtering is not authorization/i)).toBeInTheDocument();
    expect(screen.getByText(/trusted sign-in and server-enforced row access/i)).toBeInTheDocument();
    expect(screen.queryByText(/scoped by partner SSO/i)).not.toBeInTheDocument();
  });
});

describe('PartnerView coverage states (VAL-DATA-002)', () => {
  /** The open-pipeline KPI tile, whose sub carries the coverage state. */
  function pipelineTile(): HTMLElement {
    const label = screen.getByText('Open pipeline');
    const tile = label.closest('div');
    if (!tile) throw new Error('pipeline tile not found');
    return tile;
  }

  it('shows a finite coverage ratio while the target is open', () => {
    // 250k open in Q3 against the partner's 500k Q3 target.
    render(<PartnerView data={makeDashboardData()} />);

    expect(within(pipelineTile()).getByText('1 open · 0.5x coverage')).toBeInTheDocument();
  });

  it('shows target met once closed-won reaches the target, never a ratio over a zero gap', () => {
    render(
      <PartnerView
        data={makeDashboardData({
          opportunities: [
            makeOpportunity({
              id: 'opp-won',
              outcome: 'won',
              forecastedRevenue: 600_000,
              createdAt: '2026-08-01T00:00:00.000Z',
              expectedCloseDate: '2026-09-01T00:00:00.000Z',
              closedAt: '2026-09-01T00:00:00.000Z',
            }),
          ],
          targets: [makeTarget({ revenueTarget: 500_000 })],
        })}
      />,
    );

    expect(within(pipelineTile()).getByText('0 open · target met')).toBeInTheDocument();
    expect(within(pipelineTile()).queryByText(/coverage$/)).not.toBeInTheDocument();
  });

  it('shows no target when the partner has no target rows, never target met', () => {
    render(<PartnerView data={makeDashboardData({ targets: [] })} />);

    const tile = pipelineTile();
    expect(within(tile).getByText('1 open · no target')).toBeInTheDocument();
    expect(within(tile).queryByText(/target met/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/∞|NaN/)).not.toBeInTheDocument();
  });
});

describe('PartnerView certification attainment', () => {
  it('shows attainment against a real goal', () => {
    render(
      <PartnerView
        data={makeDashboardData({
          certifications: [
            makeCertification({
              partnerStrategistsCertified: 1,
              partnerStrategistsGoal: 4,
              partnerEngineersCertified: 3,
              partnerEngineersGoal: 4,
            }),
          ],
        })}
      />,
    );
    expect(screen.getByText('1/4')).toBeInTheDocument();
    expect(screen.getByText('25% of goal')).toBeInTheDocument();
    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.getByText('75% of goal')).toBeInTheDocument();
  });

  // Regression: a zero goal is a real state in an enablement system, and the
  // unguarded division reached Intl.NumberFormat as Infinity, rendering
  // "∞% of goal" to a partner.
  it('does not divide by a zero goal', () => {
    render(
      <PartnerView
        data={makeDashboardData({
          certifications: [
            makeCertification({
              partnerStrategistsCertified: 0,
              partnerStrategistsGoal: 0,
              partnerEngineersCertified: 2,
              partnerEngineersGoal: 0,
            }),
          ],
        })}
      />,
    );

    expect(screen.getAllByText('No goal set')).toHaveLength(2);
    expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('says so when the partner has no certification record at all', () => {
    render(<PartnerView data={makeDashboardData({ certifications: [] })} />);
    expect(screen.getAllByText('No certification data')).toHaveLength(2);
  });
});

describe('PartnerView partner isolation (VAL-DATA-003)', () => {
  /**
   * The view renders one partner's slice of a two-partner book. The picker is
   * an untrusted demo selector (VAL-GOV-008), so its options legitimately
   * name every partner; what must never render is another partner's data —
   * their deals, accounts, or certification standing — nor the viewer's own
   * Sell To deals, which are internal revenue, not the partner's pipeline.
   */
  it('never renders another partner’s rows or the partner’s own Sell To deals', () => {
    render(
      <PartnerView
        data={makeDashboardData({
          partners: [
            makePartner({ id: 'partner-1', name: 'Northwind Systems' }),
            makePartner({ id: 'partner-2', name: 'Contoso Partners', partnerManagerId: 'pm-2' }),
          ],
          opportunities: [
            makeOpportunity({ id: 'opp-mine', accountName: 'Acme Freight' }),
            makeOpportunity({
              id: 'opp-sell-to',
              accountName: 'Northwind Internal Sell',
              oppType: 'sell-to',
            }),
            makeOpportunity({
              id: 'opp-theirs',
              partnerId: 'partner-2',
              accountName: 'Contoso Exclusive Account',
            }),
          ],
          registrations: [
            makeRegistration({ id: 'reg-mine', accountName: 'Acme Freight' }),
            makeRegistration({
              id: 'reg-theirs',
              partnerId: 'partner-2',
              accountName: 'Contoso Exclusive Account',
            }),
          ],
          certifications: [
            makeCertification({ partnerId: 'partner-1' }),
            makeCertification({
              partnerId: 'partner-2',
              partnerStrategistsCertified: 9,
              partnerStrategistsGoal: 9,
            }),
          ],
        })}
      />,
    );

    // Default selection is the first partner; their deal renders.
    expect(screen.getAllByText('Acme Freight').length).toBeGreaterThan(0);
    // The other partner's account never leaves the picker's option list.
    expect(screen.queryByText('Contoso Exclusive Account')).not.toBeInTheDocument();
    // A Sell To deal on the selected partner is internal revenue: hidden here.
    expect(screen.queryByText('Northwind Internal Sell')).not.toBeInTheDocument();
    // The other partner's certification standing (9/9) never shows.
    expect(screen.queryByText('9/9')).not.toBeInTheDocument();
  });
});
