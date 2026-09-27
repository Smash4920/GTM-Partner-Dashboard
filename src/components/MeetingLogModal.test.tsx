import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MeetingLogModal from './MeetingLogModal';
import { makeMeeting, makePartner } from '../test/fixtures';
import type { MeetingClassification } from '../data/types';

function renderModal(options: { dirty?: boolean; classifications?: Record<string, MeetingClassification> } = {}) {
  const handlers = {
    onChange: vi.fn(),
    onAddPartner: vi.fn(() => 'prospect-1'),
    onClose: vi.fn(),
    onSubmit: vi.fn(),
  };
  render(
    <MeetingLogModal
      managerName="J. Alvarez"
      meetings={[makeMeeting()]}
      roster={[makePartner(), makePartner({ id: 'partner-2', name: 'Beacon Consulting' })]}
      classifications={options.classifications ?? {}}
      dirty={options.dirty ?? false}
      {...handlers}
    />,
  );
  return handlers;
}

const discardPrompt = () => screen.queryByText('Discard unsubmitted classifications?');

describe('MeetingLogModal', () => {
  it('renders the week of calendar meetings', () => {
    renderModal();
    expect(screen.getByRole('dialog', { name: 'Log meetings' })).toBeInTheDocument();
    expect(screen.getByText(/Log meetings · J. Alvarez/)).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: /Partner for .* meeting/ }),
    ).toBeInTheDocument();
  });

  it('reports a reclassification', async () => {
    const user = userEvent.setup();
    const { onChange } = renderModal();

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Partner for .* meeting/ }),
      'partner-2',
    );

    expect(onChange).toHaveBeenCalledWith('meeting-1', {
      partnerId: 'partner-2',
      type: 'discovery',
    });
  });

  it('submits and closes', async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderModal({ dirty: true });

    await user.click(screen.getByRole('button', { name: 'Submit classifications' }));

    expect(onSubmit).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  describe('with no unsubmitted work', () => {
    it('closes on a backdrop click', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal({ dirty: false });

      await user.click(screen.getByRole('dialog').parentElement!);

      expect(onClose).toHaveBeenCalledOnce();
      expect(discardPrompt()).not.toBeInTheDocument();
    });

    it('closes on Escape', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal({ dirty: false });

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  // Regression: a stray backdrop click used to discard a manager's whole week
  // of classifications with no confirmation and no way back.
  describe('with unsubmitted work', () => {
    it('asks before discarding on a backdrop click', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal({ dirty: true });

      await user.click(screen.getByRole('dialog').parentElement!);

      expect(onClose).not.toHaveBeenCalled();
      expect(discardPrompt()).toBeInTheDocument();
    });

    it('asks before discarding on Escape', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal({ dirty: true });

      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
      expect(discardPrompt()).toBeInTheDocument();
    });

    it('asks before discarding on Cancel', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal({ dirty: true });

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onClose).not.toHaveBeenCalled();
      expect(discardPrompt()).toBeInTheDocument();
    });

    it('keeps the draft when the manager backs out of the prompt', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal({ dirty: true });

      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: 'Keep editing' }));

      expect(onClose).not.toHaveBeenCalled();
      expect(discardPrompt()).not.toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('closes once the discard is confirmed', async () => {
      const user = userEvent.setup();
      const { onClose } = renderModal({ dirty: true });

      await user.keyboard('{Escape}');
      await user.click(screen.getByRole('button', { name: 'Discard' }));

      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('focus management', () => {
    it('moves focus into the dialog on open', () => {
      renderModal();
      expect(screen.getByRole('dialog')).toHaveFocus();
    });

    it('returns focus to the opener on close', () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();
      expect(opener).toHaveFocus();

      const { unmount } = render(
        <MeetingLogModal
          managerName="J. Alvarez"
          meetings={[makeMeeting()]}
          roster={[makePartner()]}
          classifications={{}}
          dirty={false}
          onChange={vi.fn()}
          onAddPartner={vi.fn(() => 'p')}
          onClose={vi.fn()}
          onSubmit={vi.fn()}
        />,
      );
      expect(screen.getByRole('dialog')).toHaveFocus();

      unmount();
      expect(opener).toHaveFocus();
      opener.remove();
    });

    it('keeps Tab inside the dialog', async () => {
      const user = userEvent.setup();
      renderModal();
      const dialog = screen.getByRole('dialog');

      // Walk well past the end of the dialog's focusable elements; a missing
      // trap would land focus on document.body instead.
      for (let press = 0; press < 12; press += 1) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }
    });
  });
});
