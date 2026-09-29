import { describe, expect, it } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { DataProvider } from './data/DataProvider';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { generateDashboardData } from './data/mock/generate';
import { SimulatedRemoteProvider } from './data/mock/SimulatedRemoteProvider';
import { createProvider } from './data/providers';
import type { ProviderId } from './data/providers';
import type { ProviderBook } from './data/types';
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
interface RenderAppOptions {
  providerFactory?: (id: ProviderId) => DataProvider;
  probeProvider?: (candidate: DataProvider, signal: AbortSignal) => Promise<unknown>;
}

async function renderApp(flagClient?: FeatureFlagClient, options: RenderAppOptions = {}) {
  const user = userEvent.setup();
  render(
    <App
      flagClient={flagClient}
      providerFactory={options.providerFactory}
      probeProvider={options.probeProvider}
    />,
  );
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
    // A failure-free remote: this test is about the seam swapping, not the
    // failure draw (the transition suite below owns failure paths, and the
    // seeded 15% failure rate would make the first probe here fail).
    const steadyFactory = (id: ProviderId): DataProvider =>
      id === 'remote'
        ? new SimulatedRemoteProvider(new MockDataProvider(), { failureRate: 0, latencyMs: 0 })
        : createProvider(id);
    const user = await renderApp(undefined, { providerFactory: steadyFactory });
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

// ---------------------------------------------------------------------------
// VAL-RES-001 / VAL-RES-002: a provider switch is requested first and commits
// atomically — provider object, id, generation, and route state move in one
// batch once readiness succeeds — so no rendered frame ever pairs one
// provider's label with another provider's data.
// ---------------------------------------------------------------------------

/** A book whose rows and figures visibly belong to one provider. */
function taggedBook(tag: string, revenueMultiplier: number): ProviderBook {
  const base = generateDashboardData();
  return {
    ...base,
    opportunities: base.opportunities.map((opportunity) => ({
      ...opportunity,
      accountName: `${tag} ${opportunity.accountName}`,
      forecastedRevenue: opportunity.forecastedRevenue * revenueMultiplier,
    })),
  };
}

function taggedFactory(books: Partial<Record<ProviderId, ProviderBook>>) {
  return (id: ProviderId): DataProvider =>
    new MockDataProvider(books[id] ?? generateDashboardData());
}

interface ProbeGate {
  candidate: DataProvider;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

/** Every probe gets a hand-controlled gate, recorded in call order. */
function controllableProbe() {
  const probes: ProbeGate[] = [];
  const probe = (candidate: DataProvider): Promise<unknown> => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<unknown>((res, rej) => {
      resolve = () => res(undefined);
      reject = rej;
    });
    probes.push({ candidate, resolve, reject });
    return promise;
  };
  return { probes, probe };
}

/** The text of the pipeline tile on Forecasting. */
function pipelineTileValue(): string {
  const label = screen.getByText('Partner sourced pipeline');
  const value = label.parentElement?.querySelectorAll('p')[1];
  return value?.textContent ?? '';
}

const REMOTE_BANNER = /round trips with a 15% simulated failure rate/;
const SCALED_BANNER = /100 copies of the book/;

async function openForecasting(user: ReturnType<typeof userEvent.setup>) {
  await user.click(nav().getByRole('button', { name: 'Forecasting' }));
  await screen.findByText('Partner sourced pipeline');
}

/** Types a revenue override into the first editable row of the manager book. */
async function editFirstRowRevenue(user: ReturnType<typeof userEvent.setup>, value: string) {
  const table = await screen.findByRole('region', {
    name: 'In-quarter opportunities, scrollable',
  });
  const editButton = within(table).getAllByRole('button', {
    name: /^Edit revenue forecast for /,
  })[0]!;
  await user.click(editButton);
  const row = editButton.closest('tr')!;
  const input = within(row).getByRole('textbox', { name: /^Revenue forecast for / });
  await user.clear(input);
  await user.type(input, value);
  await user.click(within(row).getByRole('button', { name: 'Save revenue' }));
}

describe('App provider transitions', () => {
  it('provider transition: commits label, data, and generation together — no render ever mixes sources', async () => {
    const user = userEvent.setup();
    const factory = taggedFactory({
      local: taggedBook('LOCAL', 1),
      remote: taggedBook('REMOTE', 2),
    });
    const control = controllableProbe();

    // Render-by-render trace: a MutationObserver inspects every DOM state the
    // app passes through, and flags any frame where the committed-provider
    // banner and the rows on screen disagree about the source — candidate
    // label over prior data, or candidate data under the prior label.
    const mixedFrames: string[] = [];
    const observer = new MutationObserver(() => {
      const text = document.body.textContent ?? '';
      const remoteLabel = REMOTE_BANNER.test(text);
      const localRows = text.includes('LOCAL ');
      const remoteRows = text.includes('REMOTE ');
      if ((remoteLabel && localRows) || (remoteRows && !remoteLabel)) {
        mixedFrames.push(text.slice(0, 300));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    render(<App providerFactory={factory} probeProvider={control.probe} />);
    await screen.findByRole(
      'heading',
      { name: 'Partner Performance Overview', level: 1 },
      { timeout: 10_000 },
    );
    await openForecasting(user);
    await screen.findAllByText(/LOCAL /);
    const localPipeline = pipelineTileValue();

    await user.selectOptions(screen.getByLabelText('Data provider'), 'remote');

    // Requested state only: the switch is announced, and the committed
    // provider's label, figures, and rows are untouched while it runs.
    expect(await screen.findByText(/Switching to Simulated remote/)).toBeInTheDocument();
    expect(pipelineTileValue()).toBe(localPipeline);
    expect(screen.getAllByText(/LOCAL /).length).toBeGreaterThan(0);
    expect(screen.queryByText(REMOTE_BANNER)).not.toBeInTheDocument();
    expect(screen.queryByText(/REMOTE /)).not.toBeInTheDocument();

    // Readiness succeeds: the commit is one batched update.
    expect(control.probes).toHaveLength(1);
    await act(async () => {
      control.probes[0]!.resolve();
    });

    expect(await screen.findByText(REMOTE_BANNER)).toBeInTheDocument();
    await screen.findAllByText(/REMOTE /);
    expect(screen.queryByText(/Switching to Simulated remote/)).not.toBeInTheDocument();
    expect(screen.queryByText(/LOCAL /)).not.toBeInTheDocument();
    expect(pipelineTileValue()).not.toBe(localPipeline);

    observer.disconnect();
    expect(mixedFrames).toEqual([]);
  }, 30_000);

  it('provider transition: failure keeps the prior provider and edits authoritative, with working cancel and retry', async () => {
    const user = userEvent.setup();
    const factory = taggedFactory({
      local: taggedBook('LOCAL', 1),
      remote: taggedBook('REMOTE', 2),
    });
    const control = controllableProbe();
    render(<App providerFactory={factory} probeProvider={control.probe} />);
    await screen.findByRole(
      'heading',
      { name: 'Partner Performance Overview', level: 1 },
      { timeout: 10_000 },
    );
    await openForecasting(user);
    await screen.findAllByText(/LOCAL /);
    const localPipeline = pipelineTileValue();

    // An edit recorded against the local provider's book.
    await editFirstRowRevenue(user, '987654321');
    await screen.findByText('$987,654,321');
    const editedPipeline = pipelineTileValue();
    expect(editedPipeline).not.toBe(localPipeline);

    await user.selectOptions(screen.getByLabelText('Data provider'), 'remote');
    await act(async () => {
      control.probes[0]!.reject(new Error('getForecastSummary failed in transit (simulated)'));
    });

    // Failure: the candidate stays requested-but-uncommitted. The alert names
    // both halves — what failed, and who is still in charge — and the edit
    // and figures on screen are still the local provider's.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Couldn’t switch to Simulated remote/);
    expect(alert).toHaveTextContent(/Still using Local mock/);
    expect(screen.queryByText(REMOTE_BANNER)).not.toBeInTheDocument();
    expect(pipelineTileValue()).toBe(editedPipeline);
    expect(screen.getByText('$987,654,321')).toBeInTheDocument();

    // Cancel abandons the switch without touching the session.
    await user.click(screen.getByRole('button', { name: 'Stay on Local mock' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Data provider')).toHaveValue('local');
    expect(screen.getByText('$987,654,321')).toBeInTheDocument();

    // A fresh request, failed again, then retried through to a commit.
    await user.selectOptions(screen.getByLabelText('Data provider'), 'remote');
    await act(async () => {
      control.probes[1]!.reject(new Error('getForecastSummary failed in transit (simulated)'));
    });
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Retry switch to Simulated remote' }));
    // The retry re-probes the same candidate instance.
    expect(control.probes).toHaveLength(3);
    expect(control.probes[2]!.candidate).toBe(control.probes[1]!.candidate);

    await act(async () => {
      control.probes[2]!.resolve();
    });
    expect(await screen.findByText(REMOTE_BANNER)).toBeInTheDocument();
    await screen.findAllByText(/REMOTE /);
    // The edit was scoped to the local provider's generation: it did not
    // cross the commit.
    expect(screen.queryByText('$987,654,321')).not.toBeInTheDocument();
    expect(pipelineTileValue()).not.toBe(editedPipeline);
    expect(pipelineTileValue()).not.toBe(localPipeline);
  }, 30_000);

  it('provider transition: a superseded request never commits, even when its probe resolves late', async () => {
    const user = userEvent.setup();
    const factory = taggedFactory({
      local: taggedBook('LOCAL', 1),
      remote: taggedBook('REMOTE', 2),
      scaled: taggedBook('SCALED', 3),
    });
    const control = controllableProbe();
    render(<App providerFactory={factory} probeProvider={control.probe} />);
    await screen.findByRole(
      'heading',
      { name: 'Partner Performance Overview', level: 1 },
      { timeout: 10_000 },
    );
    await openForecasting(user);
    await screen.findAllByText(/LOCAL /);

    await user.selectOptions(screen.getByLabelText('Data provider'), 'remote');
    await screen.findByText(/Switching to Simulated remote/);
    await user.selectOptions(screen.getByLabelText('Data provider'), 'scaled');
    await screen.findByText(/Switching to Scaled 100×/);
    expect(control.probes).toHaveLength(2);

    // The abandoned remote probe answers late — it must not commit.
    await act(async () => {
      control.probes[0]!.resolve();
    });
    expect(screen.queryByText(REMOTE_BANNER)).not.toBeInTheDocument();
    expect(screen.getAllByText(/LOCAL /).length).toBeGreaterThan(0);
    expect(screen.getByText(/Switching to Scaled 100×/)).toBeInTheDocument();

    await act(async () => {
      control.probes[1]!.resolve();
    });
    expect(await screen.findByText(SCALED_BANNER)).toBeInTheDocument();
    await screen.findAllByText(/SCALED /);
    expect(screen.queryByText(/LOCAL /)).not.toBeInTheDocument();
    expect(screen.queryByText(/REMOTE /)).not.toBeInTheDocument();
  }, 30_000);

  it('provider transition: view selections reset to defaults when a new provider commits', async () => {
    const user = userEvent.setup();
    const factory = taggedFactory({
      local: taggedBook('LOCAL', 1),
      remote: taggedBook('REMOTE', 2),
    });
    const control = controllableProbe();
    render(<App providerFactory={factory} probeProvider={control.probe} />);
    await screen.findByRole(
      'heading',
      { name: 'Partner Performance Overview', level: 1 },
      { timeout: 10_000 },
    );
    await openForecasting(user);
    await screen.findAllByText(/LOCAL /);

    // Narrow the manager filter to one manager — a selection that only means
    // something against this provider's directory.
    const filter = screen.getByLabelText('Partner manager');
    const firstManager = within(filter).getAllByRole('option')[1]!;
    await user.selectOptions(filter, firstManager);
    expect(filter).toHaveValue(firstManager.getAttribute('value'));

    await user.selectOptions(screen.getByLabelText('Data provider'), 'remote');
    await act(async () => {
      control.probes[0]!.resolve();
    });
    await screen.findAllByText(/REMOTE /);

    // The commit remounted the route: the selection is back at its explicit
    // default rather than pointing into another provider's directory.
    expect(screen.getByLabelText('Partner manager')).toHaveValue('all');
  }, 30_000);
});
