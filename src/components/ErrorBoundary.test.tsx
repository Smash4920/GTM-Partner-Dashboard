import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ErrorBoundary from './ErrorBoundary';

function Boom({ explode }: { explode: boolean }): React.JSX.Element {
  if (explode) throw new Error('stage breakdown read an empty book');
  return <p>view rendered</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error itself; silence it so a passing run is not
    // full of red that looks like a failure.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('view rendered')).toBeInTheDocument();
  });

  it('shows the failure instead of unmounting the tree', () => {
    render(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Something went wrong here')).toBeInTheDocument();
    // The message is surfaced, not swallowed: without it there is nothing to
    // report and no way to tell two different failures apart.
    expect(screen.getByText('stage breakdown read an empty book')).toBeInTheDocument();
  });

  it('recovers when the route changes, so navigating away is a way out', async () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="partner-view">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="home">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('view rendered')).toBeInTheDocument();
  });

  it('stays in the fallback while the route is unchanged', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="home">
        <Boom explode />
      </ErrorBoundary>,
    );
    rerender(
      <ErrorBoundary resetKey="home">
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('retries on demand', async () => {
    const user = userEvent.setup();
    let explode = true;
    function Flaky() {
      if (explode) throw new Error('transient');
      return <p>view rendered</p>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    explode = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    rerender(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(screen.getByText('view rendered')).toBeInTheDocument();
  });
});
