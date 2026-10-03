import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeView from './HomeView';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { createSimulatedRemoteProvider } from '../data/mock/createSimulatedRemoteProvider';
import { NO_SESSION_EDITS } from '../data/sessionEdits';
import { makeOpportunity, makeProviderBook, makeTarget } from '../test/fixtures';
import type { ProviderBook } from '../data/mock/book';
import type { MeetingClassification } from '../data/types';

/**
 * Home's coverage tile is a three-way state, not a number with a null
 * overloaded onto it: a finite ratio while quota is open, `Target met` once
 * closed-won reaches the target, and `No target` when the scope carries no
 * committed target. The view reads scoped provider queries, so every case
 * awaits the summary answer rather than rendering synchronously. Dates are
 * pinned to the fixed SNAPSHOT_DATE fiscal calendar (FY27 Q3 runs Aug–Oct
 * 2026), never to the wall clock.
 */

const NO_CLASSIFICATIONS: Record<string, MeetingClassification> = {};

function renderView(book: ProviderBook = makeProviderBook()) {
  render(
    <HomeView
      provider={new MockDataProvider(book)}
      edits={NO_SESSION_EDITS}
      classifications={NO_CLASSIFICATIONS}
      prospects={[]}
    />,
  );
}

/** The coverage KPI tile, found by its label so other cards cannot leak in. */
async function coverageTile(): Promise<HTMLElement> {
  const label = await screen.findByText('Partner sourced pipeline coverage');
  const tile = label.closest('div');
  if (!tile) throw new Error('coverage tile not found');
  return tile;
}

describe('HomeView coverage states (VAL-DATA-002)', () => {
  it('shows a finite coverage ratio while quota is still open', async () => {
    // 250k open in Q3 against a 500k target, nothing closed yet.
    renderView();

    const tile = await coverageTile();
    expect(within(tile).getByText('0.5x')).toBeInTheDocument();
    expect(within(tile).getByText('$500K sourced target remaining')).toBeInTheDocument();
    expect(within(tile).queryByText('Target met')).not.toBeInTheDocument();
    expect(within(tile).queryByText('No target')).not.toBeInTheDocument();
  });

  it('shows Target met once closed-won reaches the target, never a ratio over a zero gap', async () => {
    renderView(
      makeProviderBook({
        opportunities: [
          makeOpportunity({
            id: 'opp-won',
            outcome: 'won',
            forecastedRevenue: 600_000,
            createdAt: '2026-08-01T00:00:00.000Z',
            expectedCloseDate: '2026-09-01T00:00:00.000Z',
            closedAt: '2026-09-01T00:00:00.000Z',
          }),
        ],
        targets: [makeTarget({ revenueTarget: 500_000 })],
      }),
    );

    const tile = await coverageTile();
    expect(within(tile).getByText('Target met')).toBeInTheDocument();
    expect(within(tile).getByText('Sourced target achieved')).toBeInTheDocument();
  });

  it('shows No target when the scope carries no target rows', async () => {
    renderView(makeProviderBook({ targets: [] }));

    const tile = await coverageTile();
    expect(within(tile).getByText('No target')).toBeInTheDocument();
    expect(within(tile).getByText('No sourced target set')).toBeInTheDocument();
    expect(within(tile).queryByText('Target met')).not.toBeInTheDocument();
    expect(screen.queryByText(/∞|NaN/)).not.toBeInTheDocument();
  });

  it('reads a zero-value target row as no target', async () => {
    renderView(makeProviderBook({ targets: [makeTarget({ revenueTarget: 0 })] }));

    expect(within(await coverageTile()).getByText('No target')).toBeInTheDocument();
  });
});

describe('HomeView optional roster resilience (VAL-RES-009)', () => {
  it('a failed partner roster is named beside the queue, keeps the widgets live, and retries only the roster', async () => {
    // The regression this pins: Home used to start the roster query but never
    // render its failure — the aligned-partner count silently vanished and
    // the review queue fell back to raw partner ids with no way to recover
    // the roster short of remounting the route.
    const user = userEvent.setup();
    const inner = new MockDataProvider(makeProviderBook());
    const rosterSpy = vi.spyOn(inner, 'getPartnerRoster');
    const summarySpy = vi.spyOn(inner, 'getPerformanceSummary');
    render(
      <HomeView
        provider={createSimulatedRemoteProvider(inner, {
          latencyMs: 0,
          failMethods: { getPartnerRoster: 1 },
        })}
        edits={NO_SESSION_EDITS}
        classifications={NO_CLASSIFICATIONS}
        prospects={[]}
      />,
    );

    // The successful widgets answer right through the roster failure.
    expect(within(await coverageTile()).getByText('0.5x')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Deal registration funnel' })).toBeInTheDocument();

    // The roster's own named failure surface names the resource and the
    // explicit id fallback; the review queue renders with raw partner ids.
    const region = await screen.findByRole('group', { name: 'partner roster' });
    expect(
      within(region).getByText('Partner names unavailable — showing partner ids:'),
    ).toBeInTheDocument();
    expect(within(region).getByText('Failed to load the partner roster')).toBeInTheDocument();
    expect(screen.queryByText(/failed in transit/)).not.toBeInTheDocument();
    const queueHeading = screen.getByRole('heading', { name: 'Registrations awaiting review' });
    const queue = queueHeading.closest('section');
    if (!queue) throw new Error('no review queue card');
    expect(within(queue).getByText('partner-1')).toBeInTheDocument();
    // The header's aligned-partner count is omitted while the roster is down
    // rather than showing a plausible wrong number.
    expect(screen.queryByText(/aligned partners/)).not.toBeInTheDocument();

    // The planned failure never reached the inner provider, so the retry's
    // roster call is the inner provider's first — and the summary, which
    // already answered, is not re-asked.
    expect(rosterSpy).not.toHaveBeenCalled();
    const summaryCalls = summarySpy.mock.calls.length;
    await user.click(within(region).getByRole('button', { name: 'Retry partner roster' }));

    // Recovery resolves the queue's partner names, restores the header
    // count, and lands focus on the roster's named region.
    await within(queue).findByText('Northwind Systems');
    expect(rosterSpy).toHaveBeenCalledTimes(1);
    expect(summarySpy.mock.calls.length).toBe(summaryCalls);
    expect(screen.getByText(/· 1 aligned partners/)).toBeInTheDocument();
    expect(within(region).queryByText(/Partner names unavailable/)).not.toBeInTheDocument();
    expect(region).toHaveFocus();
  });
});
