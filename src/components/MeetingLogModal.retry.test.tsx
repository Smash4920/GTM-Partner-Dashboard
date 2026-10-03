import { useLayoutEffect } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MeetingLogModal from './MeetingLogModal';
import { makeMeeting, makePartner } from '../test/fixtures';

// Model the Modal observer winning the post-commit race against passive
// effects. Explicit retry recovery must already own focus before that fallback.
function CalendarTransition({ state }: { state: 'failed' | 'loading' | 'ready' }) {
  useLayoutEffect(() => {
    const modal = document.querySelector('dialog')!;
    if (!modal.contains(document.activeElement)) modal.querySelector('h2')!.focus();
  }, [state]);
  return (
    <MeetingLogModal
      managerName="J. Alvarez"
      meetings={state === 'ready' ? [makeMeeting()] : []}
      roster={[makePartner()]}
      classifications={{}}
      dirty={false}
      calendar={{
        loading: state === 'loading',
        error: state === 'failed' ? 'Failed to load meetings' : null,
        retry: vi.fn(),
        hasMore: false,
        loadingMore: false,
        loadMore: vi.fn(),
      }}
      onChange={vi.fn()}
      onAddPartner={vi.fn(() => 'p')}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />
  );
}

describe('calendar retry focus ownership', () => {
  // These controlled-commit regressions dispatch the same focused Retry click
  // synchronously. User keyboard/pointer sequences remain in the modal/E2E suites.
  function retry() {
    const button = screen.getByLabelText('Retry meeting calendar');
    button.focus();
    fireEvent.click(button);
  }

  it('claims orphaned retry focus before Modal fallback and retains it through row insertion', () => {
    const { rerender } = render(<CalendarTransition state="failed" />);
    retry();
    const region = screen.getByLabelText('meeting calendar');
    rerender(<CalendarTransition state="loading" />);
    expect(region).toHaveFocus();
    rerender(<CalendarTransition state="ready" />);
    expect(region).toHaveFocus();
    expect(screen.getByLabelText(/Partner for/)).toBeInTheDocument();
  });

  it('does not reclaim deliberate movement outside the calendar before or after loading', () => {
    const { rerender } = render(<CalendarTransition state="failed" />);
    retry();
    const submit = screen.getByText('Submit classifications');
    submit.focus();
    rerender(<CalendarTransition state="loading" />);
    expect(submit).toHaveFocus();
    rerender(<CalendarTransition state="ready" />);
    expect(submit).toHaveFocus();
  });

  it('leaves deliberate movement after loading alone when rows arrive', () => {
    const { rerender } = render(<CalendarTransition state="failed" />);
    retry();
    rerender(<CalendarTransition state="loading" />);
    const cancel = screen.getByText('Cancel');
    cancel.focus();
    rerender(<CalendarTransition state="ready" />);
    expect(cancel).toHaveFocus();
  });

  it('retains generic Modal recovery when no explicit retry owns the transition', () => {
    const { rerender } = render(<CalendarTransition state="failed" />);
    screen.getByLabelText('Retry meeting calendar').focus();
    rerender(<CalendarTransition state="loading" />);
    expect(screen.getByText('Log meetings · J. Alvarez')).toHaveFocus();
  });
});
