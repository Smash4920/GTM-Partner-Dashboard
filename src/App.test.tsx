import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { createFeatureFlagClient, type FeatureFlagClient } from './lib/featureFlags';

/**
 * Whole-app smoke tests against the real MockDataProvider.
 *
 * Deliberately shallow on numbers — those are pinned in the metric suites from
 * hand-built fixtures, so they do not move when the generator is retuned. What
 * these assert is that the shell wires up: the book loads through the provider
 * seam, every route mounts against real generated data, and no view trips the
 * error boundary.
 */
async function renderApp(flagClient?: FeatureFlagClient) {
  const user = userEvent.setup();
  render(<App flagClient={flagClient} />);
  await screen.findByRole(
    'heading',
    { name: 'Partner Performance Overview', level: 1 },
    { timeout: 10_000 },
  );
  return user;
}

const nav = () => within(screen.getByRole('navigation', { name: 'Primary' }));

/** Sidebar label paired with the h1 the route renders; null where it is data-driven. */
const ROUTES: [label: string, heading: string | null][] = [
  ['Partner Performance', 'Partner Performance'],
  ['Forecasting', 'Forecasting'],
  ['Deal Reg Ops', 'Deal Registration Operations'],
  ['Activity Tracking', 'Activity Tracking'],
  ['Partner View', null],
  ['Production Requirements', 'Production Requirements'],
  ['Data Connections', 'Data Connections'],
];

describe('App', () => {
  it('loads the book through the provider and lands on Home', async () => {
    await renderApp();
    expect(screen.queryByText('Loading dashboard data')).not.toBeInTheDocument();
    expect(screen.getByText('All Partners')).toBeInTheDocument();
  });

  it('mounts every route against real generated data', async () => {
    const user = await renderApp();

    for (const [label, heading] of ROUTES) {
      await user.click(nav().getByRole('button', { name: label }));

      if (heading) {
        expect(screen.getByRole('heading', { name: heading, level: 1 })).toBeInTheDocument();
      } else {
        expect(screen.getAllByRole('heading', { level: 1 })).not.toHaveLength(0);
      }
      // The boundary renders this in place of a view that threw.
      expect(screen.queryByText('Something went wrong here')).not.toBeInTheDocument();
    }
  }, 60_000);

  it('marks the active route for assistive tech', async () => {
    const user = await renderApp();
    expect(nav().getByRole('button', { name: 'Home' })).toHaveAttribute('aria-current', 'page');

    await user.click(nav().getByRole('button', { name: 'Forecasting' }));

    expect(nav().getByRole('button', { name: 'Forecasting' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(nav().getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current');
  }, 20_000);

  it('collapses and expands the sidebar', async () => {
    const user = await renderApp();
    const collapse = screen.getByRole('button', { name: 'Collapse sidebar' });
    expect(collapse).toHaveAttribute('aria-expanded', 'true');

    await user.click(collapse);

    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  }, 20_000);

  it('shows the staged migration plan on Production Requirements', async () => {
    const user = await renderApp();
    await user.click(nav().getByRole('button', { name: 'Production Requirements' }));

    expect(screen.getByRole('heading', { name: 'Migration Path' })).toBeInTheDocument();
    expect(screen.getByText(/Phase 0 · Test infrastructure/)).toBeInTheDocument();
    expect(screen.getByText(/Phase 1 · Contract rewrite against the mock/)).toBeInTheDocument();
  }, 20_000);

  it('removes a disabled feature from navigation', async () => {
    const disabledFlags = createFeatureFlagClient({
      VITE_FEATURE_PRODUCTION_REQUIREMENTS: 'false',
    });

    await renderApp(disabledFlags);

    expect(
      nav().queryByRole('button', { name: 'Production Requirements' }),
    ).not.toBeInTheDocument();
  });

  it('swaps the provider behind the seam from the header', async () => {
    const user = await renderApp();
    const selector = screen.getByLabelText('Data provider');
    expect(selector).toHaveValue('local');
    // The option labels are always in the DOM, so the notice is what says the
    // provider actually changed. The default is the fast one, so it is absent
    // to begin with.
    const remoteNotice = /round trips with a 15% simulated failure rate/;
    expect(screen.queryByText(remoteNotice)).not.toBeInTheDocument();

    await user.selectOptions(selector, 'remote');
    expect(await screen.findByText(remoteNotice)).toBeInTheDocument();
    // The views are the same views; only the answer's origin changed. This is
    // the whole claim of the abstraction, and it is one select.
    expect(
      screen.getByRole('heading', { name: 'Partner Performance Overview' }),
    ).toBeInTheDocument();

    await user.selectOptions(selector, 'local');
    expect(screen.queryByText(remoteNotice)).not.toBeInTheDocument();

    // The failure this guards: useDashboardData used to set `error` and never
    // clear it, so a provider that failed a call left its message on screen
    // over perfectly good data from the next provider.
    expect(screen.queryByText(/failed in transit/)).not.toBeInTheDocument();
  }, 30_000);
});
