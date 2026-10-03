import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NOTIFICATION_CHANNEL_META, NOTIFICATION_CHANNELS } from '../data/constants';
import { makeTeamUser } from '../test/fixtures';
import TeamAccessPanel from './TeamAccessPanel';

function renderPanel() {
  const handlers = { onAdd: vi.fn(), onSetStatus: vi.fn(), onRemove: vi.fn() };
  render(
    <TeamAccessPanel
      users={[
        makeTeamUser(),
        makeTeamUser({ id: 'invited', status: 'invited' }),
        makeTeamUser({ id: 'paused', status: 'suspended' }),
      ]}
      partnerManagers={[{ id: 'pm-1', name: 'Aligned Manager' }]}
      addedUserIds={new Set(['invited'])}
      {...handlers}
    />,
  );
  return handlers;
}

describe('VAL-A11Y-005 team roster disclosures', () => {
  it('DS-038 keeps a stable controlled target and restores focus after Enter/Space/Cancel/Escape', async () => {
    const user = userEvent.setup();
    renderPanel();
    const toggle = screen.getByRole('button', { name: 'Add user' });
    const target = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(target).not.toBeNull();
    expect(target).toHaveAttribute('hidden');
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(target).not.toHaveAttribute('hidden');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(toggle).toHaveFocus();
    expect(target).toHaveAttribute('hidden');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{Escape}');
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    await user.click(toggle);
    expect(target).toHaveAttribute('hidden');
  });

  it('DS-038 successful addition closes the form and returns to its invoker', async () => {
    const user = userEvent.setup();
    const { onAdd } = renderPanel();
    const toggle = screen.getByRole('button', { name: 'Add user' });
    await user.click(toggle);
    const form = within(screen.getByRole('form', { name: 'Add internal user' }));
    fireEvent.change(form.getByLabelText('Name'), { target: { value: 'New Person' } });
    fireEvent.change(form.getByLabelText('Work email'), { target: { value: 'new@example.com' } });
    await user.click(form.getByRole('button', { name: 'Add to roster' }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('form', { name: 'Add internal user' })).not.toBeInTheDocument();
  });

  it('DS-039 exposes all three channel descriptions as visible associated text', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole('button', { name: 'Add user' }));
    for (const channel of NOTIFICATION_CHANNELS) {
      const meta = NOTIFICATION_CHANNEL_META[channel];
      const button = screen.getByRole('button', { name: meta.label });
      expect(screen.getByText(meta.description)).toBeVisible();
      expect(button).toHaveAccessibleDescription(meta.description);
      expect(button).not.toHaveAttribute('title');
      expect(button).toHaveClass('min-h-6', 'min-w-6');
    }
    expect(screen.getByRole('button', { name: 'Email' })).toBeDisabled();
    const slack = screen.getByRole('button', { name: 'Slack' });
    slack.focus();
    await user.keyboard(' ');
    expect(slack).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('{Enter}');
    expect(slack).toHaveAttribute('aria-pressed', 'true');
  });

  it('DT-019 exposes at least 24px final-column actions that work without pointer precision', async () => {
    const user = userEvent.setup();
    const { onSetStatus, onRemove } = renderPanel();
    for (const [name, id, status] of [
      ['Pause notifications', 'user-1', 'suspended'],
      ['Turn on notifications', 'invited', 'active'],
      ['Resume notifications', 'paused', 'active'],
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('min-h-6', 'min-w-6');
      button.focus();
      await user.keyboard('{Enter}');
      expect(onSetStatus).toHaveBeenLastCalledWith(id, status);
    }
    const remove = screen.getByRole('button', { name: 'Remove' });
    expect(remove).toHaveClass('min-h-6', 'min-w-6');
    remove.focus();
    await user.keyboard(' ');
    expect(onRemove).toHaveBeenCalledExactlyOnceWith('invited');
  });
});
