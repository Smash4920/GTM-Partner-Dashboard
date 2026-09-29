import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PartnerView from './PartnerView';
import {
  makeCertification,
  makeDashboardData,
  makeOpportunity,
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
