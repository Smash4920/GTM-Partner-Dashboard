import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  ROADMAP_DEMO_STATUSES,
  ROADMAP_LAST_UPDATED,
  ROADMAP_PRODUCTION_STATUSES,
  ROADMAP_STATUS_META,
} from '../data/constants';
import type { RoadmapItem } from '../data/types';
import { formatDate } from '../lib/format';
import ProductionRequirementsView, {
  MIGRATION_PHASES,
  REQUIREMENTS,
  UTILITY_REQUIREMENTS,
} from './ProductionRequirementsView';
import { ROADMAP_BASELINE } from './__fixtures__/productionRequirements';

/**
 * The Production Requirements view is a static board. These tests pin the thing
 * the board exists for: every row carries a Demo status that reports only client
 * behavior, and a production dependency is only ever shown as a separate,
 * intentionally paused Production status — never as a completed step. Spot
 * checks below are the marquee calls; if one drifts, the board is lying.
 */

/** The list item holding the matched roadmap text, scoped for status lookups. */
function itemRow(matcher: RegExp) {
  const row = screen.getByText(matcher).closest('li');
  expect(row).not.toBeNull();
  return within(row as HTMLElement);
}

const demoLabel = (status: (typeof ROADMAP_DEMO_STATUSES)[number]) =>
  `Demo: ${ROADMAP_STATUS_META[status].label}`;
const prodOnlyLabel = `Production: ${ROADMAP_STATUS_META['prod-only'].label}`;
const allBadgeLabels = () => [
  ...ROADMAP_DEMO_STATUSES.map((status) => `Demo: ${ROADMAP_STATUS_META[status].label}`),
  ...ROADMAP_PRODUCTION_STATUSES.map(
    (status) => `Production: ${ROADMAP_STATUS_META[status].label}`,
  ),
];

describe('ProductionRequirementsView', () => {
  it('preserves every baseline record, ordered field value, and optional-property omission', () => {
    const current = { REQUIREMENTS, UTILITY_REQUIREMENTS, MIGRATION_PHASES };
    expect(current).toStrictEqual(ROADMAP_BASELINE);

    for (const board of ['REQUIREMENTS', 'UTILITY_REQUIREMENTS', 'MIGRATION_PHASES'] as const) {
      for (const [groupIndex, group] of current[board].entries()) {
        const baselineGroup = ROADMAP_BASELINE[board][groupIndex];
        expect(Object.keys(group).sort()).toStrictEqual(Object.keys(baselineGroup).sort());
        for (const [itemIndex, item] of group.items.entries()) {
          const baselineItem = baselineGroup.items[itemIndex];
          expect(Object.keys(item).sort()).toStrictEqual(Object.keys(baselineItem).sort());
          for (const optional of ['demoScope', 'production'] as const) {
            expect(Object.hasOwn(item, optional)).toBe(Object.hasOwn(baselineItem, optional));
          }
        }
      }
    }
  });

  it('renders all 66 full baseline rows in board and group order, with no added or missing details', () => {
    render(<ProductionRequirementsView />);

    const groups = [
      ...ROADMAP_BASELINE.REQUIREMENTS,
      ...ROADMAP_BASELINE.MIGRATION_PHASES,
      ...ROADMAP_BASELINE.UTILITY_REQUIREMENTS,
    ];
    const expectedRows = groups.flatMap<RoadmapItem>((group) => group.items);
    expect(expectedRows).toHaveLength(66);
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toStrictEqual(
      expectedRows.map(
        (item) =>
          item.text +
          (item.demoScope === undefined ? '' : `Demo today: ${item.demoScope}`) +
          (item.production === undefined ? '' : `Production blocker: ${item.production.blocker}`) +
          demoLabel(item.demo) +
          (item.production === undefined
            ? ''
            : `Production: ${ROADMAP_STATUS_META[item.production.status].label}`),
      ),
    );
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(20);
    expect(
      lists.map((list) =>
        within(list)
          .getAllByRole('listitem')
          .map((row) => row.querySelector('span.block')?.textContent),
      ),
    ).toStrictEqual(groups.map((group) => group.items.map((item) => item.text)));
    expect(
      lists.map((list) => list.closest('section')?.querySelector('h2')?.textContent),
    ).toStrictEqual(
      groups.map((group) => ('phase' in group ? `${group.phase} · ${group.title}` : group.title)),
    );
    for (const phase of ROADMAP_BASELINE.MIGRATION_PHASES) {
      const section = screen
        .getByRole('heading', { name: `${phase.phase} · ${phase.title}` })
        .closest('section');
      expect(section).not.toBeNull();
      const phaseCard = within(section as HTMLElement);
      expect(phaseCard.getByText(phase.subtitle)).toBeInTheDocument();
      if ('status' in phase) expect(phaseCard.getByText(phase.status)).toBeInTheDocument();
    }
  });

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

  it('legends every demo and production status separately with its definition', () => {
    render(<ProductionRequirementsView />);

    for (const status of ROADMAP_DEMO_STATUSES) {
      const meta = ROADMAP_STATUS_META[status];
      expect(screen.getAllByText(`Demo: ${meta.label}`).length).toBeGreaterThan(0);
      expect(screen.getByText(meta.description)).toBeInTheDocument();
    }
    for (const status of ROADMAP_PRODUCTION_STATUSES) {
      const meta = ROADMAP_STATUS_META[status];
      expect(screen.getAllByText(`Production: ${meta.label}`).length).toBeGreaterThan(0);
      expect(screen.getByText(meta.description)).toBeInTheDocument();
    }
  });

  it('gives every roadmap row exactly one Demo status', () => {
    render(<ProductionRequirementsView />);

    const rows = screen.getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const demoChips = ROADMAP_DEMO_STATUSES.flatMap((status) =>
        within(row).queryAllByText(demoLabel(status)),
      );
      expect(demoChips, 'every roadmap row carries exactly one Demo status').toHaveLength(1);
    }

    // WIP remains a valid legend value, but the final approved demo work is
    // complete. Pending production/deferred work must still remain visible.
    for (const status of ['complete', 'pending'] as const) {
      expect(screen.getAllByText(demoLabel(status)).length).toBeGreaterThan(1);
    }
  });

  it('VAL-GOV-002 completes every approved mixed-scope demo while retaining Prod Only blockers', () => {
    render(<ProductionRequirementsView />);
    const items = [...REQUIREMENTS, ...UTILITY_REQUIREMENTS, ...MIGRATION_PHASES].flatMap(
      (group) => group.items,
    );
    const mixed = items.filter(
      (item) => item.demoScope && item.production && item.demo !== 'pending',
    );
    expect(mixed).toHaveLength(12);
    expect(items.filter((item) => item.demo === 'wip')).toEqual([]);
    for (const item of mixed) {
      expect(item.demo, item.text).toBe('complete');
      const row = within(screen.getByText(item.text).closest('li') as HTMLElement);
      expect(row.getByText(demoLabel('complete'))).toBeInTheDocument();
      expect(row.getByText(prodOnlyLabel)).toBeInTheDocument();
      expect(row.getByText(item.production?.blocker ?? '')).toBeInTheDocument();
    }
  });

  it('never renders Prod Only as a Demo status', () => {
    render(<ProductionRequirementsView />);

    // "Prod Only" is a production-scope label only; it must never appear under
    // the Demo axis.
    expect(screen.queryByText(`Demo: ${ROADMAP_STATUS_META['prod-only'].label}`)).toBeNull();
    // Every Prod Only chip is explicitly production-scoped.
    expect(screen.queryAllByText('Prod Only').length).toBe(0);
    expect(screen.getAllByText(prodOnlyLabel).length).toBeGreaterThan(0);
  });

  it('stamps at most one Production status per row and only when applicable', () => {
    render(<ProductionRequirementsView />);

    for (const row of screen.getAllByRole('listitem')) {
      const prodChips = within(row).queryAllByText(prodOnlyLabel);
      expect(prodChips.length).toBeLessThanOrEqual(1);
      const badgeCount = allBadgeLabels().reduce(
        (total, label) => total + within(row).queryAllByText(label).length,
        0,
      );
      // A row is either demo-only (one badge) or a mixed row (Demo + Prod Only).
      expect(badgeCount === 1 || badgeCount === 2).toBe(true);
    }
  });

  it('stamps when the statuses were last reviewed against the code', () => {
    render(<ProductionRequirementsView />);

    expect(
      screen.getByText(`Statuses last updated ${formatDate(ROADMAP_LAST_UPDATED.toISOString())}`),
    ).toBeInTheDocument();
  });

  it('marks the landed demo capabilities as Demo: Complete with no production claim', () => {
    render(<ProductionRequirementsView />);

    const complete = /Live sketch: probability-weighted forecast/;
    expect(itemRow(complete).getByText(demoLabel('complete'))).toBeInTheDocument();
    expect(itemRow(complete).queryByText(prodOnlyLabel)).toBeNull();

    expect(
      itemRow(/Leakage: approved registrations without an opportunity/).getByText(
        demoLabel('complete'),
      ),
    ).toBeInTheDocument();
    expect(
      itemRow(/jsdom, Testing Library, and a coverage provider/).getByText(demoLabel('complete')),
    ).toBeInTheDocument();
  });

  it('splits mixed rows into a demo portion and a separate Prod Only continuation', () => {
    render(<ProductionRequirementsView />);

    const paginated = itemRow(/Serve aggregated, paginated API responses/);
    expect(paginated.getByText(demoLabel('complete'))).toBeInTheDocument();
    expect(paginated.getByText(prodOnlyLabel)).toBeInTheDocument();
    // The usable demo portion and the exact production blocker are both named.
    expect(paginated.getByText(/Demo today:/)).toBeInTheDocument();
    expect(paginated.getByText(/Production blocker:/)).toBeInTheDocument();

    const optimistic = itemRow(/Optimistic client updates/);
    expect(optimistic.getByText(demoLabel('complete'))).toBeInTheDocument();
    expect(optimistic.getByText(prodOnlyLabel)).toBeInTheDocument();
  });

  it('shows pure production dependencies as Demo: Pending plus Prod Only, never Complete', () => {
    render(<ProductionRequirementsView />);

    const idp = itemRow(/Authenticate internal users and partners/);
    expect(idp.getByText(demoLabel('pending'))).toBeInTheDocument();
    expect(idp.getByText(prodOnlyLabel)).toBeInTheDocument();
    expect(idp.queryByText(demoLabel('complete'))).toBeNull();

    const snapshotJob = itemRow(/Idempotent weekly snapshot job/);
    expect(snapshotJob.getByText(demoLabel('pending'))).toBeInTheDocument();
    expect(snapshotJob.getByText(prodOnlyLabel)).toBeInTheDocument();

    const controlPlane = itemRow(/authenticated control plane/);
    expect(controlPlane.getByText(demoLabel('pending'))).toBeInTheDocument();
    expect(controlPlane.getByText(prodOnlyLabel)).toBeInTheDocument();
  });

  it('keeps the excluded partner picker Demo: Pending with its limitation documented', () => {
    render(<ProductionRequirementsView />);

    const picker = itemRow(/Remove the partner picker outside an internal demo mode/);
    expect(picker.getByText(demoLabel('pending'))).toBeInTheDocument();
    // The picker is unchanged; the row documents that it is an untrusted demo
    // presentation selector and that client filtering is not authorization.
    expect(picker.getByText(/untrusted demo presentation selector/)).toBeInTheDocument();
    expect(picker.getByText(/filtering is not authorization/)).toBeInTheDocument();
    // Serving external partners is a production dependency: trusted sign-in
    // plus server-enforced row access, so the row carries the Prod Only axis.
    expect(picker.getByText(prodOnlyLabel)).toBeInTheDocument();
    expect(picker.getByText(/trusted sign-in and server-enforced row access/)).toBeInTheDocument();
  });

  it('keeps the deferred Forecast Quality trend Demo: Pending with its prerequisites named', () => {
    render(<ProductionRequirementsView />);

    const trend = itemRow(/Turn per-deal judgments into trend/);
    expect(trend.getByText(demoLabel('pending'))).toBeInTheDocument();
    // The trend waits on immutable historical ownership and authoritative
    // stage-entry events; snapshots, health alerts, and reviews are not
    // substitutes, so nothing marks it Complete or WIP.
    expect(trend.queryByText(demoLabel('complete'))).toBeNull();
    expect(trend.queryByText(demoLabel('wip'))).toBeNull();
    expect(trend.getByText(prodOnlyLabel)).toBeInTheDocument();
    expect(trend.getByText(/immutable historical partner-manager ownership/)).toBeInTheDocument();
    expect(trend.getByText(/authoritative stage-entry events/)).toBeInTheDocument();
    expect(trend.getByText(/not substitutes/)).toBeInTheDocument();
  });

  it('tracks feature-flag methodology and control-plane safeguards', () => {
    render(<ProductionRequirementsView />);

    expect(
      itemRow(/Define a feature-flag methodology/).getByText(demoLabel('complete')),
    ).toBeInTheDocument();

    const failSafeRow = itemRow(/authorization and data-access enforcement independent/);
    expect(failSafeRow.getByText(demoLabel('complete'))).toBeInTheDocument();
    expect(failSafeRow.getByText(/non-authoritative/)).toBeInTheDocument();
    expect(failSafeRow.getByText(/never alter demo access scope/)).toBeInTheDocument();
  });
});
