import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import Modal from './Modal';

describe('modal focus contract', () => {
  it('opens a labeled native modal, focuses its title and restores an exact opener', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const { unmount } = render(
      <Modal title="Example" onDismiss={vi.fn()}>
        <button>Done</button>
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: 'Example' })).toHaveAttribute('open');
    expect(screen.getByRole('heading', { name: 'Example' })).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('contains forward and reverse focus after controls change and guards native Escape', async () => {
    const dismiss = vi.fn();
    const element = (disabled: boolean) => (
      <Modal title="Example" onDismiss={dismiss}>
        <button disabled={disabled}>First</button>
        <button>Last</button>
      </Modal>
    );
    const { rerender } = render(element(false));
    const user = userEvent.setup({ delay: null });
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'First' })).toHaveFocus();
    rerender(element(true));
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus();
    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(screen.getByRole('dialog'), cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dismiss).toHaveBeenCalledOnce();
    await user.keyboard('{Escape}');
    expect(dismiss).toHaveBeenCalledTimes(2);
  });

  it('restores the route heading when the opener disappears', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const element = (open: boolean) => (
      <>
        <main>
          <div hidden>
            <h1>Retained route</h1>
          </div>
          <h1>Route</h1>
        </main>
        {open && <Modal title="Example" onDismiss={vi.fn()} />}
      </>
    );
    const { rerender } = render(element(true));
    const heading = screen.getByRole('heading', { name: 'Route' });
    opener.remove();
    rerender(element(false));
    expect(heading).toHaveFocus();
  });

  it('recovers orphaned focus during a query transition and handles an empty modal', async () => {
    const element = (loading: boolean) => (
      <Modal title="Example" onDismiss={vi.fn()}>
        {loading ? <p>Loading</p> : <button>Draft control</button>}
      </Modal>
    );
    const { rerender } = render(element(false));
    screen.getByRole('button').focus();
    rerender(element(true));
    await waitFor(() => expect(screen.getByRole('heading')).toHaveFocus());
    await userEvent.setup({ delay: null }).tab();
    expect(screen.getByRole('heading')).toHaveFocus();
  });

  it('retains the last draft focus when the backdrop itself takes focus', () => {
    const dismiss = vi.fn();
    render(
      <Modal title="Example" onDismiss={dismiss}>
        <button>Draft control</button>
      </Modal>,
    );
    const control = screen.getByRole('button');
    control.focus();
    const dialog = screen.getByRole('dialog');
    dialog.tabIndex = -1;
    dialog.focus();
    fireEvent.click(dialog, { clientX: -1, clientY: -1 });
    expect(dismiss).toHaveBeenCalledWith(control);
    fireEvent.click(dialog, { clientX: 0, clientY: 0 });
    expect(dismiss).toHaveBeenCalledOnce();
  });
});
