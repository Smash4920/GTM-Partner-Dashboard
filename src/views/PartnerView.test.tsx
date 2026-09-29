import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PartnerView from './PartnerView';
import { makeCertification, makeDashboardData } from '../test/fixtures';

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
