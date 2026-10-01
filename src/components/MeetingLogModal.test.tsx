import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MeetingLogModal from './MeetingLogModal';
import { makeMeeting, makePartner } from '../test/fixtures';
import type { ActivityMeeting, MeetingClassification } from '../data/types';

function renderModal(
  options: { dirty?: boolean; classifications?: Record<string, MeetingClassification> } = {},
) {
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
    expect(screen.getByRole('combobox', { name: /Partner for .* meeting/ })).toBeInTheDocument();
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

  /**
   * The cursor-paginated calendar's failure surfaces. The regression these
   * pin: a failed load-more used to be invisible whenever retained rows
   * existed — the ordinary Load more button stayed and nothing named the
   * failure or offered the failed page's retry.
   */
  describe('calendar pagination failure', () => {
    interface TestCalendar {
      loading: boolean;
      error: string | null;
      retry: () => void;
      hasMore: boolean;
      loadingMore: boolean;
      loadMore: () => void;
    }

    function calendarFor(overrides: Partial<TestCalendar> = {}): TestCalendar {
      return {
        loading: false,
        error: null,
        retry: vi.fn(),
        hasMore: true,
        loadingMore: false,
        loadMore: vi.fn(),
        ...overrides,
      };
    }

    function calendarModal() {
      const handlers = {
        onChange: vi.fn(),
        onAddPartner: vi.fn(() => 'prospect-1'),
        onClose: vi.fn(),
        onSubmit: vi.fn(),
      };
      const element = (
        calendar: ReturnType<typeof calendarFor>,
        options: {
          meetings?: ActivityMeeting[];
          classifications?: Record<string, MeetingClassification>;
          dirty?: boolean;
        } = {},
      ) => (
        <MeetingLogModal
          managerName="J. Alvarez"
          meetings={options.meetings ?? [makeMeeting()]}
          roster={[makePartner(), makePartner({ id: 'partner-2', name: 'Beacon Consulting' })]}
          classifications={options.classifications ?? {}}
          dirty={options.dirty ?? false}
          calendar={calendar}
          {...handlers}
        />
      );
      return { handlers, element };
    }

    it('a failed load-more keeps rows and draft controls mounted and replaces Load more with a targeted retry', async () => {
      const user = userEvent.setup();
      const calendar = calendarFor({ error: 'Failed to load more meetings' });
      const modal = calendarModal();
      render(modal.element(calendar));
      const dialog = screen.getByRole('dialog', { name: 'Log meetings' });

      // The retained row and its draft controls stay mounted and operable.
      const partnerSelect = within(dialog).getByRole('combobox', {
        name: /Partner for .* meeting/,
      });
      await user.selectOptions(partnerSelect, 'partner-2');
      expect(modal.handlers.onChange).toHaveBeenCalledWith('meeting-1', {
        partnerId: 'partner-2',
        type: 'discovery',
      });

      // Stable failure copy and the targeted retry replace the ordinary
      // Load more — the failed cursor is still the next page.
      expect(within(dialog).getByText('The next page failed:')).toBeInTheDocument();
      expect(within(dialog).getByText('Failed to load more meetings')).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('button', { name: /Load more meetings/ }),
      ).not.toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Retry meeting calendar' }));
      expect(calendar.retry).toHaveBeenCalledTimes(1);
      expect(calendar.loadMore).not.toHaveBeenCalled();
    });

    it('restores the ordinary Load more after the cursor recovers and lands focus inside the dialog', async () => {
      const user = userEvent.setup();
      const modal = calendarModal();
      const failing = calendarFor({ error: 'Failed to load more meetings' });
      const { rerender } = render(modal.element(failing));
      const dialog = screen.getByRole('dialog', { name: 'Log meetings' });

      await user.click(within(dialog).getByRole('button', { name: 'Retry meeting calendar' }));
      rerender(modal.element(calendarFor()));

      // The retry's success unmounts the failure UI it lived in; the
      // recovery region claims the orphaned focus back inside the dialog.
      expect(
        within(dialog).getByRole('button', { name: 'Load more meetings' }),
      ).toBeInTheDocument();
      expect(within(dialog).queryByText('The next page failed:')).not.toBeInTheDocument();
      const region = within(dialog).getByRole('group', { name: 'meeting calendar' });
      expect(document.activeElement).toBe(region);
      expect(dialog.contains(document.activeElement)).toBe(true);
    });

    it('keeps the unsubmitted draft mounted through the failure', () => {
      const modal = calendarModal();
      render(
        modal.element(calendarFor({ error: 'Failed to load more meetings' }), {
          classifications: { 'meeting-1': { partnerId: 'partner-2', type: 'pio-interlock' } },
          dirty: true,
        }),
      );
      const dialog = screen.getByRole('dialog', { name: 'Log meetings' });

      expect(within(dialog).getByRole('combobox', { name: /Partner for .* meeting/ })).toHaveValue(
        'partner-2',
      );
      expect(
        within(dialog).getByRole('combobox', { name: /Call type for .* meeting/ }),
      ).toHaveValue('pio-interlock');
      expect(within(dialog).getByText('Failed to load more meetings')).toBeInTheDocument();
    });

    it('names the initial calendar failure retry and lands focus on the region after recovery', async () => {
      const user = userEvent.setup();
      const modal = calendarModal();
      const failing = calendarFor({
        error: 'Failed to load the week’s meetings',
        hasMore: false,
      });
      const { rerender } = render(modal.element(failing, { meetings: [] }));
      const dialog = screen.getByRole('dialog', { name: 'Log meetings' });

      await user.click(within(dialog).getByRole('button', { name: 'Retry meeting calendar' }));
      expect(failing.retry).toHaveBeenCalledTimes(1);

      // The page request clears the error the moment it starts: the failure
      // UI unmounts for the loading render before the answer arrives. The
      // recovery region must survive that intermediate state to catch the
      // orphaned focus — this is the sequence the live provider produces.
      rerender(modal.element(calendarFor({ hasMore: false, loading: true }), { meetings: [] }));
      expect(within(dialog).getByText('Loading meetings…')).toBeInTheDocument();

      rerender(modal.element(calendarFor({ hasMore: false })));
      expect(within(dialog).queryByText('Failed to load the week’s meetings')).toBeNull();
      const region = within(dialog).getByRole('group', { name: 'meeting calendar' });
      expect(document.activeElement).toBe(region);
    });
  });
});
