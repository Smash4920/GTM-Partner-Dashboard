import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionNotificationPanel from './ActionNotificationPanel';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { DEFAULT_ACTION_POLICY } from '../lib/actionPolicy';
import { recordNotification } from '../lib/notificationRecords';

async function fixture() {
  const provider = new MockDataProvider();
  const page = await provider.listActionItems(
    INTERNAL_DEMO_SCOPE,
    { policy: DEFAULT_ACTION_POLICY },
    {},
  );
  const action = page.data.rows.find((item) => item.reasons.length > 1)!;
  return { provider, action };
}

describe('Action Center local notification integration', () => {
  it('loads only the roster, recomposes merged reasons, records selected channels and confirms locally', async () => {
    const { provider, action } = await fixture();
    const roster = vi.spyOn(provider, 'getTeamRoster');
    const send = vi.fn();
    const props = { provider, action, onSend: send, notifications: [] };
    const { rerender } = render(<ActionNotificationPanel {...props} />);
    await screen.findByLabelText('Subject');
    expect(roster).toHaveBeenCalledOnce();
    const category = action.reasons[1].category;
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: category } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: ' Edited subject ' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Slack' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use In-app' }));
    fireEvent.click(screen.getByRole('button', { name: /Send to/ }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        actionId: action.id,
        entityId: action.entityId,
        entityKind: action.entityKind,
        actionCategory: category,
        subject: 'Edited subject',
        channels: ['email'],
      }),
    );
    const saved = recordNotification(
      send.mock.calls[0][0],
      'notification-1',
      '2026-10-01T12:34:56.000Z',
    );
    rerender(<ActionNotificationPanel {...props} notifications={[saved]} />);
    expect(screen.getByText('Simulated / local only · 12:34 · email')).toBeInTheDocument();
    expect(screen.queryByText(/Delivered/)).not.toBeInTheDocument();
  });

  it('shows focused roster retry without fetching business facts and excludes inactive owners', async () => {
    const { provider, action } = await fixture();
    const read = provider.getTeamRoster.bind(provider);
    const roster = vi.spyOn(provider, 'getTeamRoster').mockRejectedValueOnce(new Error('sentinel'));
    const send = vi.fn();
    const { rerender } = render(
      <ActionNotificationPanel
        provider={provider}
        action={action}
        onSend={send}
        notifications={[]}
      />,
    );
    await screen.findByText('Failed to load the notification roster');
    expect(screen.queryByText('sentinel')).not.toBeInTheDocument();
    roster.mockImplementation(read);
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
    await screen.findByLabelText('Subject');
    rerender(
      <ActionNotificationPanel
        provider={provider}
        action={action}
        onSend={send}
        notifications={[]}
        roster={{ overrides: { [action.owner!.userId!]: { status: 'suspended' } } }}
      />,
    );
    await screen.findByText(/Unowned — no eligible active demo recipient/);
    expect(screen.queryByRole('button', { name: /Send to/ })).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });

  it('blocks blank copy and empty channel selection without creating a record', async () => {
    const { provider, action } = await fixture();
    const send = vi.fn();
    render(
      <ActionNotificationPanel
        provider={provider}
        action={action}
        onSend={send}
        notifications={[]}
      />,
    );
    await screen.findByLabelText('Subject');
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: ' ' } });
    expect(screen.getByRole('button', { name: /Send to/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Demo message' } });
    for (const checkbox of screen.getAllByRole('checkbox')) fireEvent.click(checkbox);
    expect(screen.getByRole('button', { name: /Send to/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Send to/ }));
    expect(send).not.toHaveBeenCalled();
  });
});
