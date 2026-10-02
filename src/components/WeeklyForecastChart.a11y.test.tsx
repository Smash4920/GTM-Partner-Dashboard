import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import WeeklyForecastChart from './WeeklyForecastChart';
import { FORECAST_CATEGORIES, FORECAST_CATEGORY_META } from '../data/constants';
import type { WeeklyForecastRow } from '../lib/metrics';

function week(
  weekStart: string,
  total: number,
  options: Partial<WeeklyForecastRow> = {},
): WeeklyForecastRow {
  return {
    weekStart,
    weekEnd: new Date(new Date(weekStart).getTime() + 7 * 86400000).toISOString(),
    total,
    weightedTotal: total * 0.5,
    raw: {
      'long-shot': total * 0.1,
      pipeline: total * 0.2,
      'best-case': total * 0.3,
      commit: total * 0.4,
    },
    weighted: {
      'long-shot': total * 0.01,
      pipeline: total * 0.05,
      'best-case': total * 0.15,
      commit: total * 0.36,
    },
    hasStarted: true,
    ...options,
  };
}

describe('WeeklyForecastChart alternatives (CH-016; DS-022)', () => {
  it.each([1234567, 0, undefined])(
    'exposes every category, total, delta and source state with goal %s without hover',
    (goal) => {
      render(
        <WeeklyForecastChart
          goal={goal}
          rows={[
            week('2026-08-03T00:00:00Z', 10000, { recordedAt: '2026-08-09T23:00:00Z' }),
            week('2026-08-10T00:00:00Z', 12000),
            week('2026-08-17T00:00:00Z', 12000),
            week('2026-08-24T00:00:00Z', 9000),
            week('2026-09-14T00:00:00Z', 15000),
            week('2026-09-21T00:00:00Z', 0, { hasStarted: false }),
          ]}
        />,
      );
      const figure = screen.getByRole('figure', { name: 'Week-over-week pipeline' });
      expect(figure.querySelector('figcaption')).toHaveTextContent(/USD/);
      fireEvent.click(within(figure).getByText('View chart data'));
      const table = within(figure).getByRole('table', { name: 'Week-over-week pipeline data' });
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((el) => el.textContent);
      for (const category of FORECAST_CATEGORIES) {
        expect(headers).toContain(`${FORECAST_CATEGORY_META[category].label} raw (USD)`);
        expect(headers).toContain(`${FORECAST_CATEGORY_META[category].label} weighted (USD)`);
        expect(
          within(figure).getByText(
            `${FORECAST_CATEGORY_META[category].label} ${Math.round(FORECAST_CATEGORY_META[category].weight * 100)}%`,
          ),
        ).toBeVisible();
      }
      const rows = within(table).getAllByRole('row').slice(1);
      expect(rows).toHaveLength(6);
      expect(within(rows[0]).getByRole('rowheader')).toHaveTextContent('Aug 3, 2026');
      expect(rows[0]).toHaveTextContent('Snapshot recorded Aug 9, 2026');
      expect(rows[0]).toHaveTextContent('first week');
      expect(rows[1]).toHaveTextContent('Reconstructed from current book');
      expect(rows[1]).toHaveTextContent('+$2,000 WoW');
      expect(rows[1]).toHaveTextContent('+$1,000 WoW');
      expect(rows[2]).toHaveTextContent('flat WoW');
      expect(rows[3]).toHaveTextContent('−$3,000 WoW');
      expect(rows[3]).toHaveTextContent('−$1,500 WoW');
      expect(rows[4]).toHaveTextContent('Live book · moves with session edits');
      expect(rows[5]).toHaveTextContent("Hasn't started yet");
      expect(rows[5]).not.toHaveTextContent(/first week|flat WoW/);
      const values = within(rows[0])
        .getAllByRole('cell')
        .map((el) => el.textContent);
      expect(values.slice(1, 9)).toEqual([
        '$1,000',
        '$100',
        '$2,000',
        '$500',
        '$3,000',
        '$1,500',
        '$4,000',
        '$3,600',
      ]);
      expect(values).toContain('$10,000');
      expect(values).toContain('$5,000');
      if (goal === undefined) {
        expect(headers).not.toContain('Revenue goal (USD)');
        expect(figure).toHaveTextContent('Revenue goal unavailable');
      } else {
        expect(headers).toContain('Revenue goal (USD)');
        rows.forEach((row) => expect(row).toHaveTextContent(goal === 0 ? '$0' : '$1,234,567'));
      }
      expect(figure.querySelector('[title]')).toBeNull();
    },
  );

  it('compares only started weeks and labels missing future values instead of measured zeros', () => {
    render(
      <WeeklyForecastChart
        rows={[
          week('2026-09-14T00:00:00Z', 0),
          week('2026-09-21T00:00:00Z', 0, { hasStarted: false }),
          week('2026-09-28T00:00:00Z', 2000),
        ]}
      />,
    );
    fireEvent.click(screen.getByText('View chart data'));
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('$0');
    expect(rows[0]).toHaveTextContent('first week');
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((el) => el.textContent)
        .slice(1),
    ).toEqual(Array.from({ length: 12 }, () => 'Not started'));
    expect(rows[2]).toHaveTextContent('+$2,000 WoW');
  });

  it('retains an accessible empty chart', () => {
    render(<WeeklyForecastChart rows={[]} />);
    fireEvent.click(screen.getByText('View chart data'));
    expect(screen.getByRole('figure', { name: 'Week-over-week pipeline' })).toHaveTextContent(
      'No data',
    );
  });
});
