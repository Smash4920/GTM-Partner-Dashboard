import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ROADMAP_LAST_UPDATED, ROADMAP_STATUSES, ROADMAP_STATUS_META } from '../data/constants';
import { formatDate } from '../lib/format';
import ProductionRequirementsView from './ProductionRequirementsView';

/**
 * The Production Requirements view is a static board, so these tests pin the
 * thing the board exists for: every item carries a status, and the statuses
 * agree with what the code actually does. Spot checks below are the marquee
 * calls — if one of them drifts, the board is lying.
 */

/** The list item holding the matched roadmap text, scoped for status lookups. */
function itemRow(matcher: RegExp) {
  const row = screen.getByText(matcher).closest('li');
  expect(row).not.toBeNull();
  return within(row as HTMLElement);
}

const statusLabels = () => ROADMAP_STATUSES.map((status) => ROADMAP_STATUS_META[status].label);

describe('ProductionRequirementsView', () => {
  it('renders the three boards', () => {
    render(<ProductionRequirementsView />);

    expect(
      screen.getByRole('heading', { name: 'Production Requirements', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Migration Path', level: 2 })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Utility Improvements', level: 2 }),
    ).toBeInTheDocument();
  });

  it('legends all four statuses with their definitions', () => {
    render(<ProductionRequirementsView />);

    for (const status of ROADMAP_STATUSES) {
      const meta = ROADMAP_STATUS_META[status];
      // One chip in the legend, plus one per stamped item elsewhere.
      expect(screen.getAllByText(meta.label).length).toBeGreaterThan(0);
      expect(screen.getByText(meta.description)).toBeInTheDocument();
    }
  });

  it('stamps every roadmap item with exactly one status', () => {
    render(<ProductionRequirementsView />);

    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const chips = statusLabels().flatMap((label) => within(row).queryAllByText(label));
      expect(chips, 'every roadmap item carries exactly one status chip').toHaveLength(1);
    }

    // No status may fall out of use, or the legend is selling a vocabulary the
    // board does not speak.
    for (const label of statusLabels()) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(1);
    }
  });

  it('stamps when the statuses were last reviewed against the code', () => {
    render(<ProductionRequirementsView />);

    expect(
      screen.getByText(`Statuses last updated ${formatDate(ROADMAP_LAST_UPDATED.toISOString())}`),
    ).toBeInTheDocument();
  });

  it('marks the landed demo capabilities as Complete', () => {
    render(<ProductionRequirementsView />);

    expect(
      itemRow(/Live sketch: probability-weighted forecast/).getByText('Complete'),
    ).toBeInTheDocument();
    expect(
      itemRow(/Leakage: approved registrations without an opportunity/).getByText('Complete'),
    ).toBeInTheDocument();
    expect(
      itemRow(/jsdom, Testing Library, and a coverage provider/).getByText('Complete'),
    ).toBeInTheDocument();
  });

  it('marks the in-flight migration work as WIP', () => {
    render(<ProductionRequirementsView />);

    expect(
      itemRow(/Serve aggregated, paginated API responses/).getByText('WIP'),
    ).toBeInTheDocument();
    expect(itemRow(/Optimistic client updates/).getByText('WIP')).toBeInTheDocument();
  });

  it('marks the production-blocked steps as Prod Only', () => {
    render(<ProductionRequirementsView />);

    expect(
      itemRow(/Authenticate internal users and partners/).getByText('Prod Only'),
    ).toBeInTheDocument();
    expect(itemRow(/Idempotent weekly snapshot job/).getByText('Prod Only')).toBeInTheDocument();
  });

  it('marks the not-started, demo-buildable work as Pending', () => {
    render(<ProductionRequirementsView />);

    expect(
      itemRow(/Remove the partner picker outside an internal demo mode/).getByText('Pending'),
    ).toBeInTheDocument();
    expect(
      itemRow(/Define the system of record and write-back workflow/).getByText('Pending'),
    ).toBeInTheDocument();
  });
});
