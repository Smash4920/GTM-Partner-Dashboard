import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MetricBars from './MetricBars';
import { conversionRows, funnelRows, stageRows } from '../views/performanceRows';
import { STAGES } from '../data/constants';

describe('MetricBars chart alternatives (CH-001/002/005/006/007/012/013/017/021/023/024)', () => {
  it.each(['count', 'value'] as const)(
    'preserves all funnel categories and %s values',
    (measure) => {
      const rows = funnelRows(
        {
          submitted: 5,
          approved: 3,
          converted: 2,
          rejected: 1,
          pending: 1,
          submittedValue: 2500123,
          approvedValue: 1800000,
          convertedValue: 900000,
          rejectedValue: 0,
          pendingValue: 700123,
        },
        measure,
      );
      render(<MetricBars rows={rows} />);
      const figure = screen.getByRole('figure', { name: 'Metric breakdown' });
      expect(figure.querySelector('figcaption')).toHaveTextContent(/categories/i);
      const items = within(figure).getAllByRole('listitem');
      expect(items).toHaveLength(5);
      for (const [index, row] of rows.entries()) {
        expect(items[index]).toHaveTextContent(row.label);
        expect(items[index]).toHaveTextContent(row.displayValue);
        expect(items[index]).toHaveTextContent(row.secondary!);
        expect(items[index].querySelector('[title]')).toBeNull();
        expect(items[index].querySelector('.truncate')).toBeNull();
        expect(items[index].querySelector('.hidden')).toBeNull();
      }
      if (measure === 'value') expect(items[0]).toHaveTextContent('2500123 USD');
    },
  );

  it('keeps every open stage, scoped Won/Lost outcome, amount and count', () => {
    const rows = stageRows(
      {
        stages: STAGES.map((stage, index) => ({ stage, value: index * 100001, count: index })),
        outcomes: { wonValue: 123456, wonCount: 3, lostValue: 0, lostCount: 0 },
      },
      'Q3',
    );
    render(<MetricBars rows={rows} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(STAGES.length + 2);
    rows.forEach((row, index) => {
      expect(items[index]).toHaveTextContent(row.label);
      expect(items[index]).toHaveTextContent(row.secondary!);
      expect(items[index]).toHaveTextContent(`${row.value} USD`);
    });
  });

  it('labels missing conversion averages without replacing them with zero', () => {
    const rows = conversionRows(
      {
        submittedToApprovedBusinessDays: 2.5,
        approvedToOpportunityCalendarDays: 60,
        opportunityToWinCalendarDays: null,
        submittedToWinCalendarDays: 70,
      },
      'avg business days · 5-business-day SLA',
    );
    render(<MetricBars rows={rows} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('2.5d');
    expect(items[0]).toHaveTextContent('business days · 5-business-day SLA');
    expect(items[1]).toHaveTextContent('60.0d');
    expect(items[1]).toHaveTextContent('elapsed calendar days');
    expect(items[2]).toHaveTextContent('No data');
    expect(items[3]).toHaveTextContent('70.0d');
  });

  it.each([
    ['Sell To', 'Sell With', 'Allocate'],
    ['Total pipeline', 'Sell With', 'Allocate'],
    ['Approved, no opp', 'Exclusivity lapsed', 'Pending past SLA', 'Duplicate clients'],
  ])('retains full motion/leakage labels and comparisons: %s', (...labels) => {
    render(
      <MetricBars
        rows={labels.map((label, index) => ({
          label,
          value: index,
          displayValue: `${index}`,
          secondary: index === 1 ? '60 calendar days' : '5 business days',
          color: '#8a8380',
        }))}
      />,
    );
    labels.forEach((label, index) => {
      const item = screen.getAllByRole('listitem')[index];
      expect(item).toHaveTextContent(label);
      expect(item).toHaveTextContent(index === 1 ? '60 calendar days' : '5 business days');
    });
  });

  it('names an empty chart and preserves rows without secondary data', () => {
    const { rerender } = render(<MetricBars rows={[]} />);
    expect(screen.getByRole('figure', { name: 'Metric breakdown' })).toHaveTextContent('No data');
    rerender(
      <MetricBars rows={[{ label: 'Zero', value: 0, displayValue: '0', color: '#8a8380' }]} />,
    );
    expect(screen.getByRole('listitem')).toHaveTextContent('Zero');
    expect(screen.getByRole('listitem')).toHaveTextContent('0');
  });
});
