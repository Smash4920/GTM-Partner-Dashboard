import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NotificationComposer, { type ComposerState } from './NotificationComposer';
import type { ActionItem, TeamUser } from '../data/types';

const active: TeamUser = {
  id: 'owner',
  name: 'Demo owner',
  email: 'owner@example.test',
  role: 'partner-manager',
  status: 'active',
  channels: ['email', 'slack'],
  addedAt: '2026-01-01T00:00:00Z',
};
const action: ActionItem = {
  id: 'opportunity:opp-1',
  entityKind: 'opportunity',
  entityId: 'opp-1',
  partnerId: 'p-1',
  severity: 'high',
  exposure: 400_000,
  owner: { userId: active.id, basis: 'manager' },
  reasons: [
    {
      category: 'missing-next-step',
      severity: 'high',
      recommendedAction: 'Record a next step.',
      evidence: { causes: ['high-value'], daysUntilClose: 30 },
    },
  ],
};

function mount(users = [active], item: ActionItem | null = action) {
  const send = vi.fn();
  const changed = vi.fn();
  function Session() {
    const [state, setState] = useState<ComposerState>({
      userId: active.id,
      template: item ? 'missing-next-step' : 'custom',
      registrationId: null,
      subject: 'Missing next step: opp-1',
      body: 'Evidence: blank next step.',
    });
    return (
      <NotificationComposer
        users={users}
        partners={[]}
        registrations={[]}
        alerts={[]}
        state={state}
        action={item ?? undefined}
        onChange={(next) => {
          changed(next);
          setState(next);
        }}
        onSend={send}
        describe={() => ({ subject: 'Recomposed', body: 'Evidence.' })}
      />
    );
  }
  render(<Session />);
  return { send, changed };
}

describe('generalized notification composer', () => {
  it('links multi-field errors, focuses the first invalid field and clears corrected associations', () => {
    const { send } = mount();
    const subject = screen.getByLabelText('Subject');
    const message = screen.getByLabelText('Message');
    fireEvent.change(subject, { target: { value: ' ' } });
    fireEvent.change(message, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo owner' }));
    expect(send).not.toHaveBeenCalled();
    expect(subject).toHaveFocus();
    expect(subject).toHaveAttribute('aria-invalid', 'true');
    expect(subject).toHaveAccessibleDescription('A subject is required.');
    expect(message).toHaveAccessibleDescription('A message is required.');
    fireEvent.change(subject, { target: { value: 'Corrected subject' } });
    expect(subject).not.toHaveAttribute('aria-describedby');
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo owner' }));
    expect(message).toHaveFocus();
    fireEvent.change(message, { target: { value: 'Corrected message' } });
    expect(message).not.toHaveAttribute('aria-describedby');
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo owner' }));
    expect(send).toHaveBeenCalledOnce();
  });

  it('focuses and describes the first configured channel after an invalid submission', () => {
    const { send } = mount();
    const email = screen.getByRole('checkbox', { name: 'Use Email' });
    const slack = screen.getByRole('checkbox', { name: 'Use Slack' });
    fireEvent.click(email);
    fireEvent.click(slack);
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo owner' }));
    expect(send).not.toHaveBeenCalled();
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Select at least one configured channel.');
    fireEvent.click(email);
    expect(email).not.toHaveAttribute('aria-describedby');
  });
  it('prefills an action entity and locked routed owner, allowing configured channel selection', () => {
    const { send, changed } = mount();
    expect(screen.getByLabelText('To')).toBeDisabled();
    expect(screen.getByLabelText('Template')).toHaveValue('missing-next-step');
    expect(screen.queryByLabelText('Registration')).not.toBeInTheDocument();
    expect(screen.getByText('Entity: opportunity:opp-1')).toBeInTheDocument();
    expect(screen.getByText(/session-only.*Refresh clears/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Slack' }));
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ channels: ['email'] }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo owner' }));
    expect(send).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Use Email' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to Demo owner' }));
    expect(send).toHaveBeenCalledOnce();
    expect(screen.getByText('Select at least one configured channel.')).toBeInTheDocument();
  });

  it.each(['invited', 'suspended'] as const)(
    'excludes %s recipients and preserves unowned state',
    (status) => {
      mount([{ ...active, status }]);
      expect(screen.queryByRole('option', { name: /Demo owner/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Send to a teammate' })).toBeDisabled();
    },
  );

  it('updates custom recipients and blocks blank subject or message', () => {
    const { changed, send } = mount([active, { ...active, id: 'other', name: 'Other' }], null);
    fireEvent.change(screen.getByLabelText('To'), { target: { value: 'other' } });
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'other' }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Other' }));
    expect(screen.getByLabelText('Subject')).toHaveFocus();
    expect(send).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Note' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to Other' }));
    expect(screen.getByLabelText('Message')).toHaveFocus();
    expect(send).not.toHaveBeenCalled();
  });
});
