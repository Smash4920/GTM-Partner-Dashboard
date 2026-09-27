import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForecastTable from './ForecastTable';
import { makeOpportunity, makePartner } from '../test/fixtures';
import type { Opportunity } from '../data/types';

/** Client, Partner, Revenue, Type, Stage, Category, Close date, Next step, Notes. */
const NEXT_STEP_COLUMN = 7;

function renderTable(options: {
  opportunities?: Opportunity[];
  revenueOverrides?: Record<string, number>;
  notes?: Record<string, string>;
  nextSteps?: Record<string, string>;
} = {}) {
  const handlers = {
    onSetRevenue: vi.fn(),
    onSetNote: vi.fn(),
    onSetNextStep: vi.fn(),
    onSetForecastCall: vi.fn(),
  };
  const partner = makePartner();
  render(
    <ForecastTable
      opportunities={options.opportunities ?? [makeOpportunity()]}
      partnerNames={{ [partner.id]: partner.name }}
      revenueOverrides={options.revenueOverrides ?? {}}
      notes={options.notes ?? {}}
      nextSteps={options.nextSteps ?? {}}
      {...handlers}
    />,
  );
  return handlers;
}

describe('ForecastTable', () => {
  describe('revenue editing', () => {
    it('commits a valid figure on Enter', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      const input = screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ });
      await user.clear(input);
      await user.type(input, '310000{Enter}');

      expect(onSetRevenue).toHaveBeenCalledWith('opp-1', 310_000);
    });

    it('rejects a negative figure and keeps the editor open', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      const input = screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ });
      await user.clear(input);
      await user.type(input, '-5{Enter}');

      expect(onSetRevenue).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a non-negative number.');
      expect(input).toBeInTheDocument();
    });

    it('rejects a non-numeric figure', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      const input = screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ });
      await user.clear(input);
      await user.type(input, 'soon{Enter}');

      expect(onSetRevenue).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('abandons the edit on Escape', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      await user.type(
        screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ }),
        '999{Escape}',
      );

      expect(onSetRevenue).not.toHaveBeenCalled();
      expect(screen.getByText('$250,000')).toBeInTheDocument();
    });

    it('shows an overridden figure rather than the provider figure', () => {
      renderTable({ revenueOverrides: { 'opp-1': 400_000 } });
      expect(screen.getByText('$400,000')).toBeInTheDocument();
      expect(screen.queryByText('$250,000')).not.toBeInTheDocument();
    });
  });

  describe('next step editing', () => {
    it('commits an edited next step', async () => {
      const user = userEvent.setup();
      const { onSetNextStep } = renderTable();

      await user.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));
      await user.type(
        screen.getByRole('textbox', { name: /Next step for Acme Freight/ }),
        'Book the security review{Enter}',
      );

      expect(onSetNextStep).toHaveBeenCalledWith('opp-1', 'Book the security review');
    });

    it('reports an emptied next step as an empty string, not as no edit', async () => {
      const user = userEvent.setup();
      const { onSetNextStep } = renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
      });

      await user.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));
      const input = screen.getByRole('textbox', { name: /Next step for Acme Freight/ });
      await user.clear(input);
      await user.type(input, '{Enter}');

      expect(onSetNextStep).toHaveBeenCalledWith('opp-1', '');
    });

    // Regression: an emptied next step used to fall back through `??` to the
    // provider's value and reappear, so clearing one looked like it failed.
    it('renders a cleared next step as empty, not as the provider value', () => {
      renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
        nextSteps: { 'opp-1': '' },
      });

      expect(screen.queryByText('Send pricing')).not.toBeInTheDocument();
      // Scoped to the Next step cell by column index. Other columns render
      // their own em dash, so a row-wide text query would pass either way.
      const row = screen.getByRole('row', { name: /Acme Freight/ });
      const nextStepCell = within(row).getAllByRole('cell')[NEXT_STEP_COLUMN];
      expect(nextStepCell).toHaveTextContent('—');
    });

    it('prefers an edited next step over the provider value', () => {
      renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
        nextSteps: { 'opp-1': 'Escalate to the AD' },
      });

      expect(screen.getByText('Escalate to the AD')).toBeInTheDocument();
      expect(screen.queryByText('Send pricing')).not.toBeInTheDocument();
    });
  });

  describe('forecast category', () => {
    it('re-calls the deal on pick', async () => {
      const user = userEvent.setup();
      const { onSetForecastCall } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit forecast category/ }));
      await user.selectOptions(
        screen.getByRole('combobox', { name: /Forecast category for Acme Freight/ }),
        'commit',
      );

      expect(onSetForecastCall).toHaveBeenCalledWith('opp-1', 'commit');
    });

    it('flags a call that disagrees with the stage', () => {
      // Scope implies Pipeline; calling Commit is the disagreement the
      // forecast conversation is about.
      renderTable({
        opportunities: [makeOpportunity({ stage: 'scope', forecastCategory: 'commit' })],
      });
      expect(screen.getByText('Off stage')).toBeInTheDocument();
    });

    it('does not flag a call that matches the stage', () => {
      renderTable({
        opportunities: [makeOpportunity({ stage: 'scope', forecastCategory: 'pipeline' })],
      });
      expect(screen.queryByText('Off stage')).not.toBeInTheDocument();
    });

    it('offers no call on a closed deal', () => {
      renderTable({
        opportunities: [
          makeOpportunity({ outcome: 'won', closedAt: '2026-09-10T00:00:00.000Z' }),
        ],
      });
      expect(screen.getByText('Closed won')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Edit forecast category/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe('notes', () => {
    it('commits a note and keeps it out of the row body', async () => {
      const user = userEvent.setup();
      const { onSetNote } = renderTable();

      await user.click(screen.getByRole('button', { name: /note for Acme Freight/ }));
      await user.type(
        screen.getByRole('textbox', { name: /Note for Acme Freight/ }),
        'Procurement is the blocker{Enter}',
      );

      expect(onSetNote).toHaveBeenCalledWith('opp-1', 'Procurement is the blocker');
      expect(screen.queryByText('Procurement is the blocker')).not.toBeInTheDocument();
    });

    it('trims whitespace before committing', async () => {
      const user = userEvent.setup();
      const { onSetNote } = renderTable();

      await user.click(screen.getByRole('button', { name: /note for Acme Freight/ }));
      await user.type(
        screen.getByRole('textbox', { name: /Note for Acme Freight/ }),
        '   spaced   {Enter}',
      );

      expect(onSetNote).toHaveBeenCalledWith('opp-1', 'spaced');
    });
  });

  it('renders an empty message when there is nothing in the quarter', () => {
    renderTable({ opportunities: [] });
    expect(
      screen.getByText('No in-quarter opportunities for this partner manager.'),
    ).toBeInTheDocument();
  });

  it('falls back to the partner id when the partner is off the book', () => {
    renderTable({ opportunities: [makeOpportunity({ partnerId: 'partner-missing' })] });
    expect(screen.getByText('partner-missing')).toBeInTheDocument();
  });
});
