import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActivityTracker from './ActivityTracker';
import RevenueTrend from './RevenueTrend';
import { FISCAL_QUARTERS, MEETING_TYPES, MEETING_TYPE_META } from '../data/constants';
import type { WeeklyActivityRow } from '../lib/metrics';

describe('RevenueTrend alternatives (CH-003/008/022; DS-019/020/021)', () => {
  it('exposes all four quarter USD pairs without hovering, including zero target/revenue', async () => {
    const user = userEvent.setup();
    render(
      <RevenueTrend
        data={FISCAL_QUARTERS.map((quarter, index) => ({
          quarter,
          closedWon: index * 123456,
          target: index * 234567,
        }))}
      />,
    );
    const figure = screen.getByRole('figure', { name: 'Quarterly revenue vs. target' });
    expect(figure.querySelector('figcaption')).toHaveTextContent('USD');
    await user.click(within(figure).getByText('View chart data'));
    const table = within(figure).getByRole('table', { name: 'Quarterly revenue vs. target data' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((el) => el.textContent),
    ).toEqual(['Quarter', 'Closed-won (USD)', 'Target (USD)']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      'FY27-Q1$0$0',
      'FY27-Q2$123,456$234,567',
      'FY27-Q3$246,912$469,134',
      'FY27-Q4$370,368$703,701',
    ]);
    expect(figure.querySelector('[title]')).toBeNull();
  });

  it('names an empty revenue chart and makes its missing data explicit', async () => {
    const user = userEvent.setup();
    render(<RevenueTrend data={[]} />);
    await user.click(screen.getByText('View chart data'));
    expect(screen.getByRole('figure', { name: 'Quarterly revenue vs. target' })).toHaveTextContent(
      'No data',
    );
  });
});

describe('ActivityTracker alternatives (CH-004/009/020; DS-016/017/018)', () => {
  it('exposes all eight week buckets, all full meeting types and every zero/count', async () => {
    const user = userEvent.setup();
    const rows: WeeklyActivityRow[] = Array.from({ length: 8 }, (_, index) => {
      const byType = Object.fromEntries(
        MEETING_TYPES.map((type, typeIndex) => [type, index === typeIndex ? index + 1 : 0]),
      ) as WeeklyActivityRow['byType'];
      return {
        weekStart: new Date(Date.UTC(2026, 7, 3 + 7 * index)).toISOString(),
        weekEnd: new Date(Date.UTC(2026, 7, 9 + 7 * index)).toISOString(),
        total: index + 1,
        byType,
      };
    });
    render(<ActivityTracker rows={rows} />);
    const figure = screen.getByRole('figure', { name: 'Weekly partner activity' });
    expect(figure.querySelector('figcaption')).toHaveTextContent('meetings');
    const disclosure = within(figure).getByText('View chart data');
    disclosure.focus();
    await user.keyboard('{Enter}');
    const table = within(figure).getByRole('table', { name: 'Weekly partner activity data' });
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((el) => el.textContent);
    expect(headers).toEqual([
      'Week',
      'Total meetings',
      ...MEETING_TYPES.map((type) => `${MEETING_TYPE_META[type].fullLabel} (meetings)`),
    ]);
    const tableRows = within(table).getAllByRole('row').slice(1);
    expect(tableRows).toHaveLength(8);
    rows.forEach((row, index) => {
      const cells = within(tableRows[index])
        .getAllByRole('cell')
        .map((el) => el.textContent);
      expect(cells).toEqual([
        `${row.total}`,
        ...MEETING_TYPES.map((type) => `${row.byType[type]}`),
      ]);
      expect(within(tableRows[index]).getByRole('rowheader')).toHaveTextContent('2026');
    });
    expect(tableRows[7]).toHaveTextContent('This week');
    expect(figure.querySelector('[title]')).toBeNull();
  });

  it('keeps zero-total weeks distinct from an empty activity result', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ActivityTracker
        rows={[
          {
            weekStart: '2026-09-14T00:00:00Z',
            weekEnd: '2026-09-20T23:59:59Z',
            total: 0,
            byType: {} as WeeklyActivityRow['byType'],
          },
        ]}
      />,
    );
    await user.click(screen.getByText('View chart data'));
    expect(screen.getAllByRole('cell').map((el) => el.textContent)).toEqual(
      Array.from({ length: 9 }, () => '0'),
    );
    rerender(<ActivityTracker rows={[]} />);
    expect(screen.getByRole('figure', { name: 'Weekly partner activity' })).toHaveTextContent(
      'No data',
    );
  });
});
