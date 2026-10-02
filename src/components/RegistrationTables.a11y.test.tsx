import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeRegistration } from '../test/fixtures';
import RegistrationsTable from './RegistrationsTable';
import ExclusivityTable from './ExclusivityTable';

describe('VAL-A11Y-005 registration and exclusivity explanations', () => {
  it.each([
    ['DS-009', 'light'],
    ['DS-010', 'light'],
    ['DS-011', 'dark'],
  ] as const)('%s exposes business-day SLA state as visible text, not titles', (_, tone) => {
    const { container } = render(
      <RegistrationsTable
        variant="queue"
        tone={tone}
        partners={[]}
        registrations={[
          makeRegistration(),
          makeRegistration({ id: 'late', submittedAt: '2026-09-01T00:00:00Z' }),
        ]}
      />,
    );
    expect(screen.getByText('4 business days waiting')).toBeVisible();
    expect(screen.getByText('Within the 5-business-day SLA')).toBeVisible();
    expect(screen.getByText('13 business days waiting')).toBeVisible();
    expect(screen.getByText('Past the 5-business-day SLA')).toBeVisible();
    expect(container.querySelector('[title]')).toBeNull();
  });

  it('DS-012 keeps history reason and decision dates visible without queue-only SLA copy', () => {
    render(
      <RegistrationsTable
        variant="history"
        showPartner={false}
        partners={[]}
        registrations={[
          makeRegistration({
            id: 'rejected',
            status: 'rejected',
            reason: 'Outside program terms',
            decisionAt: '2026-09-16T00:00:00Z',
          }),
          makeRegistration({ id: 'approved', status: 'approved' }),
          makeRegistration(),
        ]}
      />,
    );
    expect(screen.getByText('Outside program terms')).toBeVisible();
    expect(screen.getByText('Sep 16, 2026')).toBeVisible();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText(/business days waiting/)).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Partner' })).not.toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeVisible();
    expect(screen.getByText('Approved')).toBeVisible();
    expect(screen.getByText('Pending review')).toBeVisible();
  });

  it.each(['DS-013', 'DS-014', 'DS-015'])(
    '%s exposes the complete calendar-day exclusivity rule beside status',
    (id) => {
      const { container } = render(
        <ExclusivityTable
          showPartner={id !== 'DS-015'}
          partners={[]}
          registrations={[
            makeRegistration({ status: 'approved', decisionAt: '2026-09-10T00:00:00Z' }),
            makeRegistration({
              id: 'lapsed',
              status: 'approved',
              decisionAt: '2026-06-01T00:00:00Z',
            }),
          ]}
        />,
      );
      expect(screen.getByText('In window')).toBeVisible();
      expect(screen.getByText('Exclusivity lapsed')).toBeVisible();
      expect(
        screen.getAllByText(
          '60-calendar-day window from approval; the partner must introduce the lead within it.',
        ),
      ).toHaveLength(2);
      expect(screen.getByText('8 calendar days')).toBeVisible();
      expect(screen.getByText('109 calendar days')).toBeVisible();
      expect(container.querySelector('[title]')).toBeNull();
    },
  );
});
