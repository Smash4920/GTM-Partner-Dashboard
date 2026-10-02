import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import type DataConnectionsView from './views/DataConnectionsView';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { makeProviderBook, makeTeamUser } from './test/fixtures';
import { addGlobalSink, logger, type LogRecord } from './lib/logging';
import { telemetry } from './lib/telemetry/telemetry';

let current: ComponentProps<typeof DataConnectionsView>;
vi.mock('./views/system', () => ({
  ['DataConnectionsView']: (props: ComponentProps<typeof DataConnectionsView>) => {
    current = props;
    return <p>Notification fence test route</p>;
  },
  ['ProductionRequirementsView']: () => null,
}));
afterEach(() => vi.restoreAllMocks());

it('fences saves before IDs, records, logs and telemetry using current session state and committed generation', async () => {
  const recipient = makeTeamUser({ channels: ['email'] });
  const local = new MockDataProvider(makeProviderBook({ teamUsers: [recipient] }));
  const remote = new MockDataProvider(makeProviderBook({ teamUsers: [] }), {
    providerId: 'remote',
  });
  const probe = vi.fn().mockRejectedValueOnce(new Error('readiness')).mockResolvedValue(undefined);
  render(<App providerFactory={(id) => (id === 'local' ? local : remote)} probeProvider={probe} />);
  fireEvent.click(
    within(screen.getByRole('navigation', { name: 'Primary' })).getByRole('button', {
      name: 'Data Connections',
    }),
  );
  await screen.findByText('Notification fence test route');
  const draft = {
    userId: recipient.id,
    kind: 'manual' as const,
    subject: ' Subject ',
    body: ' Body ',
    channels: ['email', 'email'] as typeof recipient.channels,
  };
  const oldSend = current.onSendNotification;
  const evidence = { provider: local, recipient };
  const logs: LogRecord[] = [];
  logger.setLevel('info');
  const removeSink = addGlobalSink((record) => logs.push(record));
  const track = vi.spyOn(telemetry, 'track');
  try {
    act(() => {
      current.onSetTeamUserStatus(recipient.id, 'suspended');
      oldSend(draft, evidence);
    });
    expect(current.notifications).toHaveLength(0);
    expect(track).not.toHaveBeenCalledWith('notification_sent', expect.anything());
    expect(logs.filter((record) => record.msg === 'Notification sent')).toHaveLength(0);
    act(() => current.onSetTeamUserStatus(recipient.id, 'active'));
    act(() => current.onSendNotification(draft, { provider: remote, recipient }));
    act(() => current.onSendNotification({ ...draft, subject: ' ' }, evidence));
    act(() => current.onSendNotification({ ...draft, channels: [] }, evidence));
    expect(current.notifications).toHaveLength(0);
    act(() => current.onSendNotification(draft, evidence));
    expect(current.notifications[0]).toMatchObject({
      id: 'notification-1',
      subject: 'Subject',
      body: 'Body',
      channels: ['email'],
      status: 'simulated-local',
    });
    expect(logs.filter((record) => record.msg === 'Notification sent')).toHaveLength(1);
    expect(track.mock.calls.filter(([event]) => event === 'notification_sent')).toHaveLength(1);

    act(() =>
      current.onAddTeamUser({
        name: 'Demo addition',
        email: 'added@example.test',
        role: 'analyst',
        channels: ['email'],
      }),
    );
    const added = current.addedTeamUsers[0];
    const addedDraft = { ...draft, userId: added.id };
    act(() => current.onSendNotification(addedDraft, { provider: local, recipient: added }));
    expect(current.notifications).toHaveLength(1);
    act(() => current.onSetTeamUserStatus(added.id, 'active'));
    const activeAdded = current.addedTeamUsers[0];
    act(() => {
      current.onRemoveTeamUser(added.id);
      current.onSendNotification(addedDraft, { provider: local, recipient: activeAdded });
    });
    expect(current.notifications).toHaveLength(1);

    fireEvent.change(screen.getByLabelText('Data provider'), { target: { value: 'remote' } });
    await screen.findByText(/Couldn’t switch to Simulated remote/);
    act(() => oldSend(draft, evidence));
    expect(current.notifications[0].id).toBe('notification-2');
    fireEvent.click(screen.getByRole('button', { name: 'Retry switch to Simulated remote' }));
    await waitFor(() => expect(current.provider).toBe(remote));
    expect(current.notifications).toHaveLength(0);
    act(() => oldSend(draft, evidence));
    act(() => current.onSendNotification(draft, evidence));
    expect(current.notifications).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Data provider'), { target: { value: 'local' } });
    await waitFor(() => expect(current.provider).toBe(local));
    act(() => oldSend(draft, evidence));
    expect(current.notifications).toHaveLength(0);
    act(() => current.onSendNotification(draft, evidence));
    expect(current.notifications[0].id).toBe('notification-1');
  } finally {
    removeSink();
    logger.setLevel('warn');
  }
});
