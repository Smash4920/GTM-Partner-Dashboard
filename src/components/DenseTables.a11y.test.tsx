import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  makeCertification,
  makeOpportunity,
  makePartner,
  makeRegistration,
  makeTeamUser,
} from '../test/fixtures';
import type { RegistrationSlaAlert } from '../lib/metrics';
import RegistrationsTable from './RegistrationsTable';
import Leaderboard from './Leaderboard';
import OpportunityTable from './OpportunityTable';
import ExclusivityTable from './ExclusivityTable';
import DuplicateRegistrationsTable from './DuplicateRegistrationsTable';
import TeamAccessPanel from './TeamAccessPanel';
import SlaAlertPanel from './SlaAlertPanel';

const REGISTRATION = makeRegistration();
const PARTNER = makePartner();
const LEADER = {
  partner: PARTNER,
  openPipelineValue: 250_000,
  openCount: 1,
  closedWonValue: 100_000,
  winRate: 0.5,
};
const GROUP = {
  accountName: REGISTRATION.accountName,
  registrations: [REGISTRATION, makeRegistration({ id: 'reg-2', partnerId: 'missing-partner' })],
  firstSubmitted: REGISTRATION,
  distinctPartners: 2,
};
const ALERT: RegistrationSlaAlert = {
  registration: REGISTRATION,
  partner: PARTNER,
  owner: makeTeamUser(),
  businessDaysWaiting: 4,
  businessDaysRemaining: 1,
  state: 'approaching',
  dueAt: '2026-09-21T00:00:00Z',
};

const TABLES: [string, string, (empty: boolean) => ReactNode][] = [
  ...(['DT-001', 'DT-004', 'DT-013', 'DT-016'] as const).map(
    (id): [string, string, (empty: boolean) => ReactNode] => [
      id,
      id === 'DT-016' ? 'Deal registrations' : 'Registrations awaiting review',
      (empty) => (
        <RegistrationsTable
          registrations={empty ? [] : [REGISTRATION]}
          partners={[]}
          variant={id === 'DT-016' ? 'history' : 'queue'}
          tone={id === 'DT-001' || id === 'DT-004' ? 'light' : 'dark'}
          showPartner={id !== 'DT-016'}
          onWorkflow={id === 'DT-013' ? vi.fn() : undefined}
        />
      ),
    ],
  ),
  ...(['DT-002', 'DT-005'] as const).map((id): [string, string, (empty: boolean) => ReactNode] => [
    id,
    id === 'DT-005' ? 'Partner leaderboard & enablement' : 'Partner leaderboard',
    (empty) => (
      <Leaderboard
        rows={empty ? [] : [LEADER]}
        certifications={id === 'DT-005' ? [makeCertification()] : undefined}
      />
    ),
  ]),
  ...(['DT-003', 'DT-018'] as const).map((id): [string, string, (empty: boolean) => ReactNode] => [
    id,
    'Pipeline opportunities',
    (empty) => <OpportunityTable opportunities={empty ? [] : [makeOpportunity()]} />,
  ]),
  ...(['DT-006', 'DT-014', 'DT-017'] as const).map(
    (id): [string, string, (empty: boolean) => ReactNode] => [
      id,
      'Exclusivity window',
      (empty) => (
        <ExclusivityTable
          registrations={empty ? [] : [makeRegistration({ status: 'approved' })]}
          partners={[]}
          showPartner={id !== 'DT-017'}
        />
      ),
    ],
  ),
  ...(['DT-007', 'DT-015'] as const).map((id): [string, string, (empty: boolean) => ReactNode] => [
    id,
    'Duplicate & conflicting registrations',
    (empty) => (
      <DuplicateRegistrationsTable
        groups={empty ? [] : [GROUP]}
        partners={[]}
        onWorkflow={id === 'DT-015' ? vi.fn() : undefined}
      />
    ),
  ]),
  [
    'DT-019',
    'Partner team notification routing',
    (empty) => (
      <TeamAccessPanel
        users={empty ? [] : [makeTeamUser()]}
        partnerManagers={[]}
        addedUserIds={new Set()}
        onAdd={vi.fn()}
        onSetStatus={vi.fn()}
        onRemove={vi.fn()}
      />
    ),
  ],
  [
    'DT-020',
    'Deal-registration SLA alert queue',
    (empty) => (
      <SlaAlertPanel
        alerts={empty ? [] : [ALERT]}
        users={[]}
        notifications={[]}
        onNotify={vi.fn()}
        onNotifyAll={vi.fn()}
      />
    ),
  ],
];

describe('VAL-A11Y-011 dense-table closed inventory', () => {
  it.each(TABLES)(
    '%s has a named focusable bounded scroll region and column headers',
    (_, label, table) => {
      render(table(false));
      const region = screen.getByRole('region', { name: `${label}, scrollable` });
      expect(region).toHaveAttribute('tabindex', '0');
      expect(region).toHaveClass('min-w-0', 'max-w-full', 'overflow-auto');
      region.focus();
      expect(region).toHaveFocus();
      const content = within(region).getByRole('table', { name: label });
      expect(content.className).toMatch(/min-w-\[/);
      for (const header of within(content).getAllByRole('columnheader')) {
        expect(header).toHaveAttribute('scope', 'col');
      }
    },
  );

  it.each(TABLES)('%s retains table names and headers in its empty state', (_, label, table) => {
    render(table(true));
    const region = screen.getByRole('region', { name: `${label}, scrollable` });
    expect(within(region).getByRole('table', { name: label })).toBeInTheDocument();
    expect(within(region).getAllByRole('columnheader').length).toBeGreaterThan(0);
  });

  it('keeps every conflicting registration and the spanning client header associated', () => {
    render(<DuplicateRegistrationsTable groups={[GROUP]} partners={[]} />);
    const client = screen.getByRole('rowheader', { name: GROUP.accountName });
    expect(client).toHaveAttribute('scope', 'rowgroup');
    expect(client).toHaveAttribute('rowspan', '2');
    expect(screen.getByText('missing-partner')).toBeVisible();
    expect(screen.getByText('First to submit')).toBeVisible();
    expect(screen.getByText('Conflict — track closely')).toBeVisible();
  });

  it('preserves missing and zero-goal certification values in the final columns', () => {
    render(
      <Leaderboard
        rows={[LEADER, { ...LEADER, partner: makePartner({ id: 'other', name: 'Other partner' }) }]}
        certifications={[makeCertification({ partnerEngineersGoal: 0 })]}
      />,
    );
    expect(screen.getByText('3/0')).toBeVisible();
    expect(screen.getByText('No goal')).toBeVisible();
    expect(screen.getAllByText('No data')).toHaveLength(2);
  });

  it('keeps pending Decide keyboard-operable in the final column', async () => {
    const user = userEvent.setup();
    const onWorkflow = vi.fn();
    render(
      <RegistrationsTable
        registrations={[REGISTRATION]}
        partners={[]}
        variant="queue"
        onWorkflow={onWorkflow}
      />,
    );
    const decide = screen.getByRole('button', { name: `Decide ${REGISTRATION.id}` });
    expect(decide).toHaveClass('min-h-6', 'min-w-6');
    decide.focus();
    await user.keyboard('{Enter}');
    expect(onWorkflow).toHaveBeenCalledExactlyOnceWith({
      kind: 'registration',
      entityIds: [REGISTRATION.id],
    });
  });

  it('keeps conflict disposition keyboard-operable and passes every contender once', async () => {
    const user = userEvent.setup();
    const onWorkflow = vi.fn();
    render(<DuplicateRegistrationsTable groups={[GROUP]} partners={[]} onWorkflow={onWorkflow} />);
    const disposition = screen.getByRole('button', { name: 'Disposition reg-1, reg-2' });
    expect(disposition).toHaveClass('min-h-6', 'min-w-6');
    disposition.focus();
    await user.keyboard(' ');
    expect(onWorkflow).toHaveBeenCalledExactlyOnceWith({
      kind: 'conflict',
      entityIds: ['reg-1', 'reg-2'],
    });
  });

  it('keeps owned SLA notification keyboard-operable and unowned action disabled', async () => {
    const user = userEvent.setup();
    const onNotify = vi.fn();
    render(
      <SlaAlertPanel
        alerts={[
          ALERT,
          {
            ...ALERT,
            registration: makeRegistration({ id: 'unowned' }),
            owner: undefined,
            state: 'breached',
            businessDaysWaiting: 7,
          },
        ]}
        users={[]}
        notifications={[]}
        onNotify={onNotify}
        onNotifyAll={vi.fn()}
      />,
    );
    const [owned, unowned] = screen.getAllByRole('button', { name: 'Notify owner' });
    expect(owned).toHaveClass('min-h-6', 'min-w-6');
    expect(unowned).toBeDisabled();
    owned.focus();
    await user.keyboard(' ');
    expect(onNotify).toHaveBeenCalledExactlyOnceWith(ALERT);
  });
});
