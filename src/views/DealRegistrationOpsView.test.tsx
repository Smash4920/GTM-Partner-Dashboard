import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import DealRegistrationOpsView from './DealRegistrationOpsView';
import { REGISTRATION_SLA_BUSINESS_DAYS } from '../data/constants';
import { makeDashboardData, makeRegistration } from '../test/fixtures';

/**
 * Deal Registration Ops SLA presentation (VAL-DATA-007): the breach boundary
 * is inclusive — a pending registration that has waited exactly
 * REGISTRATION_SLA_BUSINESS_DAYS business days is past the SLA — and the
 * tile copy must describe that boundary rather than a strict ">" reading.
 *
 * Dates pin to the fixed snapshot (Friday 2026-09-18): Sunday 2026-09-13 is
 * exactly five business days back (Mon–Fri), Thursday 2026-09-17 is one.
 */

/** The KPI tile whose label matches, so neighboring tiles cannot leak in. */
function tileWith(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('div');
  if (!tile) throw new Error(`tile not found: ${label}`);
  return tile;
}

describe('DealRegistrationOpsView', () => {
  it('counts an exactly-five-business-day pending registration as past SLA (VAL-DATA-007)', () => {
    render(
      <DealRegistrationOpsView
        data={makeDashboardData({
          registrations: [
            // At the boundary exactly: five business days awaiting review.
            makeRegistration({
              id: 'reg-at-boundary',
              submittedAt: '2026-09-13T00:00:00.000Z',
              status: 'pending',
            }),
            // Still inside the SLA: one business day awaiting review.
            makeRegistration({
              id: 'reg-inside',
              submittedAt: '2026-09-17T00:00:00.000Z',
              status: 'pending',
            }),
          ],
        })}
      />,
    );

    // Only the boundary registration counts: the boundary is inclusive.
    const tile = tileWith('Pending past SLA');
    expect(tile).toHaveTextContent('1');
    // The copy describes the same inclusive boundary the counter uses.
    expect(tile).toHaveTextContent(
      `${REGISTRATION_SLA_BUSINESS_DAYS}+ business days awaiting review`,
    );
    expect(screen.queryByText(/> \d+ business days awaiting review/)).not.toBeInTheDocument();
  });

  it('states the response SLA in business days and exclusivity in calendar days', () => {
    render(<DealRegistrationOpsView data={makeDashboardData()} />);

    expect(
      screen.getByText(`avg business days · ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`),
    ).toBeInTheDocument();
    expect(screen.queryByText(/24\s*(h|hours)/i)).not.toBeInTheDocument();
  });
});
