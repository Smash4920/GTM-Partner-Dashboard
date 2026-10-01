import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import WorkflowPanel from './WorkflowPanel';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

function mount() {
  const onRecord = vi.fn();
  const onClose = vi.fn();
  const provider = new MockDataProvider();
  render(
    <WorkflowPanel
      provider={provider}
      roster={{}}
      records={[]}
      changes={[]}
      target={{ kind: 'registration', entityIds: ['reg-0044'] }}
      onRecord={onRecord}
      onClose={onClose}
      onWorkflow={vi.fn()}
      now={() => '2026-10-01T12:34:56.789Z'}
    />,
  );
  return { onRecord, onClose, provider };
}

describe('session workflow dialog', () => {
  it('associates errors, focuses first invalid field, and records trimmed fields', async () => {
    const user = userEvent.setup();
    const { onRecord, onClose } = mount();
    await screen.findByLabelText('Demo actor (not authenticated)');
    await user.click(screen.getByRole('button', { name: 'Record session outcome' }));
    const actor = screen.getByLabelText('Demo actor (not authenticated)');
    expect(actor).toHaveFocus();
    expect(actor).toHaveAttribute('aria-invalid', 'true');
    expect(actor).toHaveAttribute('aria-describedby', 'workflow-actorId-error');
    expect(onRecord).not.toHaveBeenCalled();
    await user.selectOptions(actor, 'user-01');
    await user.selectOptions(screen.getByLabelText('Outcome'), 'approved');
    await user.type(screen.getByLabelText('Reason'), '  local review  ');
    await user.click(screen.getByRole('button', { name: 'Record session outcome' }));
    expect(onRecord).toHaveBeenCalledWith({
      kind: 'registration',
      entityIds: ['reg-0044'],
      actorId: 'user-01',
      outcome: 'approved',
      reason: 'local review',
      recordedAt: '2026-10-01T12:34:56.789Z',
      delivery: 'simulated/local-only',
    });
    expect(screen.getByRole('heading', { name: 'Session outcome recorded' })).toBeInTheDocument();
    expect(screen.getAllByText(/Refresh loses/)).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('requires explicit discard for dirty Escape and supports keep editing', async () => {
    const user = userEvent.setup();
    const { onClose } = mount();
    await screen.findByLabelText('Reason');
    await user.type(screen.getByLabelText('Reason'), 'unsaved');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    expect(screen.getByRole('heading', { name: 'Discard unsaved workflow?' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Reason')).toHaveValue('unsaved');
    fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('prevents native Escape closure through repeated dirty dismissal', async () => {
    const user = userEvent.setup();
    const { onClose, onRecord } = mount();
    await screen.findByLabelText('Reason');
    await user.type(screen.getByLabelText('Reason'), 'unsaved');
    for (const title of [
      'Discard unsaved workflow?',
      'Registration decision',
      'Discard unsaved workflow?',
    ]) {
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(screen.getByRole('dialog'), escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(screen.getByRole('heading', { name: title })).toHaveFocus();
      expect(screen.getByRole('dialog')).toHaveAttribute('open');
    }
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Reason')).toHaveValue('unsaved');
    expect(onClose).not.toHaveBeenCalled();
    expect(onRecord).not.toHaveBeenCalled();
  });

  it('closes clean Escape and restores exact opener on unmount', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <WorkflowPanel
        provider={new MockDataProvider()}
        roster={{}}
        target={{ kind: 'forecast', entityIds: ['opp-1'], changeId: 'change-1' }}
        records={[]}
        changes={[]}
        onRecord={vi.fn()}
        onClose={vi.fn()}
        onWorkflow={vi.fn()}
      />,
    );
    await screen.findByRole('dialog');
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps records and current-session changes visible without claiming history', async () => {
    const onWorkflow = vi.fn();
    render(
      <WorkflowPanel
        provider={new MockDataProvider()}
        roster={{}}
        target={null}
        records={[
          {
            kind: 'conflict',
            entityIds: ['reg-1', 'reg-2'],
            outcome: 'escalate',
            actorId: 'user-01',
            reason: 'local reason',
            recordedAt: '2026-10-01T12:34:56.789Z',
            delivery: 'simulated/local-only',
          },
        ]}
        changes={[{ id: 'change-1', opportunityId: 'opp-1', field: 'revenue', value: 500000 }]}
        onRecord={vi.fn()}
        onClose={vi.fn()}
        onWorkflow={onWorkflow}
      />,
    );
    expect(screen.getByText(/not source history/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Review change-1' }));
    await waitFor(() =>
      expect(onWorkflow).toHaveBeenCalledWith({
        kind: 'forecast',
        entityIds: ['opp-1'],
        changeId: 'change-1',
      }),
    );
  });
});
