import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import HomeView from './HomeView';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { NO_SESSION_EDITS } from '../data/sessionEdits';
import { makeOpportunity, makeProviderBook, makeTarget } from '../test/fixtures';
import type { ProviderBook } from '../data/types';
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
