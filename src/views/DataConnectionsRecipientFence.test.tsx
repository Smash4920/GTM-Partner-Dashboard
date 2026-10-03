import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import DataConnectionsView from './DataConnectionsView';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import type { TeamUser } from '../data/types';
import { SNAPSHOT_DATE } from '../data/constants';
import { businessDaysBefore } from '../lib/fiscal';
import { prepareNotificationDraft } from '../lib/notificationRecords';
import { makePartner, makeProviderBook, makeRegistration, makeTeamUser } from '../test/fixtures';

function fixture(mode: 'digest-only' | 'both' | 'pending') {
  const users = [
    makeTeamUser({
      id: 'owner-1',
      name: 'First owner',
      partnerManagerId: 'pm-1',
      channels: ['email', 'slack'],
    }),
    makeTeamUser({
      id: 'owner-2',
      name: 'Second owner',
      partnerManagerId: 'pm-2',
      channels: ['email'],
    }),
    makeTeamUser({ id: 'fallback', role: 'deal-desk-ops' }),
  ];
  const provider = new MockDataProvider(
    makeProviderBook({
      teamUsers: users,
      partners: users
        .slice(0, 2)
        .map((user, index) =>
          makePartner({ id: `p-${index}`, partnerManagerId: user.partnerManagerId! }),
        ),
      registrations: users.slice(0, 2).map((_, index) =>
        makeRegistration({
          id: `reg-${index}`,
          partnerId: `p-${index}`,
          submittedAt: businessDaysBefore(SNAPSHOT_DATE, 4).toISOString(),
        }),
      ),
    }),
  );
  const readRoster = provider.getTeamRoster.bind(provider);
  const readAlerts = provider.getRegistrationSlaAlerts.bind(provider);
  const fail = () =>
    mode === 'pending'
      ? new Promise<never>(() => {})
      : Promise.reject(new Error('Private refresh failure'));
  const rosterSpy = vi
    .spyOn(provider, 'getTeamRoster')
    .mockImplementationOnce(readRoster)
    .mockImplementation(mode === 'digest-only' ? readRoster : fail);
  const alertsSpy = vi
    .spyOn(provider, 'getRegistrationSlaAlerts')
    .mockImplementationOnce(readAlerts)
    .mockImplementation(fail);
  const send = vi.fn();
  const view = (overrides: Record<string, Partial<TeamUser>>) => (
    <DataConnectionsView
      provider={provider}
      teamUserOverrides={overrides}
      addedTeamUsers={[]}
      notifications={[]}
      onAddTeamUser={vi.fn()}
      onRemoveTeamUser={vi.fn()}
      onSetTeamUserStatus={vi.fn()}
      onSendNotification={(draft, evidence) => {
        const prepared = prepareNotificationDraft(draft, evidence.recipient, { overrides });
        if (prepared) send(prepared, evidence);
      }}
    />
  );
  return { provider, users, rosterSpy, alertsSpy, readRoster, readAlerts, send, view };
}

it.each(['digest-only', 'both', 'pending'] as const)(
  'excludes suspended retained recipients without hiding %s evidence or rerouting a mixed batch',
  async (mode) => {
    const { view, send, users, rosterSpy, alertsSpy, readRoster } = fixture(mode);
    const { rerender } = render(view({}));
    await screen.findByRole('button', { name: 'Send to First owner' });
    const subject = (screen.getByLabelText('Subject') as HTMLInputElement).value;
    rerender(view({ 'owner-1': { status: 'suspended' } }));
    if (mode !== 'pending') {
      await screen.findByText('Failed to load the registration SLA alerts');
    } else {
      await waitFor(() => expect(alertsSpy).toHaveBeenCalledTimes(2));
    }
    expect(screen.getByLabelText('Subject')).toHaveValue(subject);
    // Both failed/pending resources retain the old active recipient UI.
    if (mode !== 'digest-only')
      fireEvent.click(screen.getByRole('button', { name: 'Send to First owner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notify all 2 owners' }));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-2', registrationId: 'reg-1' }),
      { provider: expect.anything(), recipient: users[1] },
    );
    expect(send.mock.calls.map(([draft]) => draft.userId)).not.toContain('fallback');
    expect(
      within(screen.getByRole('group', { name: 'The SLA alert queue' })).getByText('First owner'),
    ).toBeInTheDocument();
    if (mode === 'both') {
      rosterSpy.mockImplementation(readRoster);
      fireEvent.click(screen.getByRole('button', { name: 'Retry The team roster' }));
      await waitFor(() => expect(rosterSpy).toHaveBeenCalledTimes(3));
      expect(alertsSpy).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Failed to load the registration SLA alerts')).toBeInTheDocument();
    }
  },
);

it.each([
  { channels: ['slack'] as TeamUser['channels'] },
  { channels: [] as TeamUser['channels'] },
])(
  'shares current selected-channel preparation for retained batch and individual evidence: %j',
  async ({ channels }) => {
    const { view, send, users } = fixture('both');
    const { rerender } = render(view({}));
    await screen.findByRole('button', { name: 'Send to First owner' });
    rerender(view({ 'owner-1': { channels } }));
    await screen.findByText('Failed to load the registration SLA alerts');
    fireEvent.click(screen.getByRole('button', { name: 'Send to First owner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notify all 2 owners' }));
    const firstOwnerDrafts = send.mock.calls.filter(([draft]) => draft.userId === users[0].id);
    expect(firstOwnerDrafts).toHaveLength(channels.length ? 2 : 0);
    for (const [draft] of firstOwnerDrafts) expect(draft.channels).toEqual(channels);
    expect(send.mock.calls.filter(([draft]) => draft.userId === users[1].id)).toHaveLength(1);
    expect(screen.getAllByText('Latest refresh failed:')).toHaveLength(3);
  },
);
