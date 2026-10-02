import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForecastTable from './ForecastTable';
import { makeOpportunity, makePartner } from '../test/fixtures';
import type { Opportunity } from '../data/types';

/** Client, Partner, Revenue, Type, Stage, Category, Close date, Next step, Notes. */
const NEXT_STEP_COLUMN = 7;

function renderTable(
  options: {
    opportunities?: Opportunity[];
    revenueOverrides?: Record<string, number>;
    notes?: Record<string, string>;
    nextSteps?: Record<string, string>;
  } = {},
) {
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
  it.each([
    ['revenue forecast', 'note'],
    ['revenue forecast', 'next step'],
    ['revenue forecast', 'forecast category'],
    ['note', 'revenue forecast'],
    ['note', 'next step'],
    ['note', 'forecast category'],
    ['next step', 'revenue forecast'],
    ['next step', 'note'],
    ['next step', 'forecast category'],
    ['forecast category', 'revenue forecast'],
    ['forecast category', 'note'],
    ['forecast category', 'next step'],
  ])('replaces an unsaved %s editor with only the %s editor', async (from, to) => {
    const user = userEvent.setup();
    const handlers = renderTable({
      opportunities: [
        makeOpportunity({
          notes: 'Provider note',
          nextStep: 'Provider next step',
        }),
      ],
      revenueOverrides: { 'opp-1': 0 },
      notes: { 'opp-1': '' },
      nextSteps: { 'opp-1': '' },
    });
    await user.click(screen.getByRole('button', { name: new RegExp(`^(Add|Edit) ${from} for`) }));
    if (from !== 'forecast category') {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved' } });
    }
    await user.click(screen.getByRole('button', { name: new RegExp(`^(Add|Edit) ${to} for`) }));
    if (to === 'forecast category') {
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByRole('combobox')).toHaveValue('pipeline');
    } else {
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      expect(screen.getByRole('textbox')).toHaveValue(to === 'revenue forecast' ? '0' : '');
    }
    await user.keyboard('{Escape}');
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it.each(['Escape', 'Tab'])('abandons a category edit on %s without saving', async (key) => {
    const user = userEvent.setup();
    const { onSetForecastCall } = renderTable();
    await user.click(screen.getByRole('button', { name: /Edit forecast category/ }));
    expect(screen.getByRole('combobox')).toHaveFocus();
    await user.keyboard(`{${key}}`);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(onSetForecastCall).not.toHaveBeenCalled();
    if (key === 'Escape') {
      expect(screen.getByRole('button', { name: /Edit forecast category/ })).toHaveFocus();
    } else {
      expect(screen.getByRole('button', { name: /next step for/ })).toHaveFocus();
    }
  });

  it.each([
    ['note', 'Enter'],
    ['note', 'Escape'],
    ['next step', 'Enter'],
    ['next step', 'Escape'],
    ['revenue forecast', 'Enter'],
    ['revenue forecast', 'Escape'],
  ])(
    'restores the %s invoker after keyboard %s without reopening its editor',
    async (field, key) => {
      const user = userEvent.setup();
      renderTable();
      const name = new RegExp(`^(Add|Edit) ${field} for`);
      await user.click(screen.getByRole('button', { name }));
      await user.keyboard(`{${key}}`);
      expect(screen.getByRole('button', { name })).toHaveFocus();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    },
  );

  describe('revenue editing', () => {
    it.each(['', '-5', 'soon', 'Infinity'])(
      'links an invalid %j Save to revenue, refocuses it, and clears stale errors on correction (VAL-A11Y-004)',
      async (draft) => {
        const user = userEvent.setup();
        const { onSetRevenue } = renderTable();
        await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
        const input = screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ });
        fireEvent.change(input, { target: { value: draft } });
        await user.click(screen.getByRole('button', { name: 'Save revenue' }));

        const error = screen.getByRole('alert');
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(error.id).not.toBe('');
        expect(input).toHaveAttribute('aria-describedby', error.id);
        expect(input).toHaveAccessibleDescription('Enter a non-negative number.');
        expect(error).toBeVisible();
        expect(input).toHaveFocus();
        expect(onSetRevenue).not.toHaveBeenCalled();

        fireEvent.change(input, { target: { value: '0' } });
        expect(input).not.toHaveAttribute('aria-invalid');
        expect(input).not.toHaveAttribute('aria-describedby');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Save revenue' }));
        expect(onSetRevenue).toHaveBeenCalledExactlyOnceWith('opp-1', 0);
        expect(screen.getByRole('button', { name: /Edit revenue forecast/ })).toHaveFocus();
      },
    );

    it('restores the revenue invoker after cancelling an invalid Save', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();
      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      fireEvent.change(screen.getByRole('textbox', { name: /Revenue forecast for/ }), {
        target: { value: '' },
      });
      await user.click(screen.getByRole('button', { name: 'Save revenue' }));
      await user.click(screen.getByRole('button', { name: 'Cancel revenue edit' }));
      expect(onSetRevenue).not.toHaveBeenCalled();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Edit revenue forecast/ })).toHaveFocus();
    });

    it('commits a valid figure on Enter', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      const input = screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ });
      fireEvent.change(input, { target: { value: '310000' } });
      await user.keyboard('{Enter}');

      expect(onSetRevenue).toHaveBeenCalledWith('opp-1', 310_000);
    });

    it('rejects a negative figure and keeps the editor open', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      const input = screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ });
      fireEvent.change(input, { target: { value: '-5' } });
      await user.keyboard('{Enter}');

      expect(onSetRevenue).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a non-negative number.');
      expect(input).toBeInTheDocument();
    });

    it('rejects a non-numeric figure', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      const input = screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ });
      fireEvent.change(input, { target: { value: 'soon' } });
      await user.keyboard('{Enter}');

      expect(onSetRevenue).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('abandons the edit on Escape', async () => {
      const user = userEvent.setup();
      const { onSetRevenue } = renderTable();

      await user.click(screen.getByRole('button', { name: /Edit revenue forecast/ }));
      fireEvent.change(screen.getByRole('textbox', { name: /Revenue forecast for Acme Freight/ }), {
        target: { value: '250000999' },
      });
      await user.keyboard('{Escape}');

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
    // Regression: the editor used to open blank even when the provider (or an
    // earlier session edit) already held a value, so a blind save erased it.
    it('opens with the provider next step when there is no session edit', () => {
      renderTable({ opportunities: [makeOpportunity({ nextStep: 'Send pricing' })] });

      fireEvent.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));

      expect(screen.getByRole('textbox', { name: /Next step for Acme Freight/ })).toHaveValue(
        'Send pricing',
      );
    });

    it('opens with the session override rather than the provider next step', () => {
      renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
        nextSteps: { 'opp-1': 'Escalate to the AD' },
      });

      fireEvent.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));

      expect(screen.getByRole('textbox', { name: /Next step for Acme Freight/ })).toHaveValue(
        'Escalate to the AD',
      );
    });

    it('opens empty when the session edit is an explicit clear', () => {
      renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
        nextSteps: { 'opp-1': '' },
      });

      fireEvent.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));

      expect(screen.getByRole('textbox', { name: /Next step for Acme Freight/ })).toHaveValue('');
    });

    it('cancel preserves the prior next step', async () => {
      const user = userEvent.setup();
      const { onSetNextStep } = renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
      });

      await user.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));
      const input = screen.getByRole('textbox', { name: /Next step for Acme Freight/ });
      fireEvent.change(input, { target: { value: 'Book the security review' } });
      await user.click(screen.getByRole('button', { name: 'Cancel next step edit' }));

      expect(onSetNextStep).not.toHaveBeenCalled();
      expect(screen.getByText('Send pricing')).toBeInTheDocument();
    });

    it('Escape preserves the prior next step', async () => {
      const user = userEvent.setup();
      const { onSetNextStep } = renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
      });

      await user.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));
      const input = screen.getByRole('textbox', { name: /Next step for Acme Freight/ });
      fireEvent.change(input, { target: { value: 'Book the security review' } });
      await user.keyboard('{Escape}');

      expect(onSetNextStep).not.toHaveBeenCalled();
      expect(screen.getByText('Send pricing')).toBeInTheDocument();
    });

    it('commits an edited next step', async () => {
      const user = userEvent.setup();
      const { onSetNextStep } = renderTable();

      await user.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));
      fireEvent.change(screen.getByRole('textbox', { name: /Next step for Acme Freight/ }), {
        target: { value: 'Book the security review' },
      });
      await user.keyboard('{Enter}');

      expect(onSetNextStep).toHaveBeenCalledWith('opp-1', 'Book the security review');
    });

    it('reports an emptied next step as an empty string, not as no edit', async () => {
      const user = userEvent.setup();
      const { onSetNextStep } = renderTable({
        opportunities: [makeOpportunity({ nextStep: 'Send pricing' })],
      });

      await user.click(screen.getByRole('button', { name: /next step for Acme Freight/ }));
      const input = screen.getByRole('textbox', { name: /Next step for Acme Freight/ });
      fireEvent.change(input, { target: { value: '' } });
      await user.keyboard('{Enter}');

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
        opportunities: [makeOpportunity({ outcome: 'won', closedAt: '2026-09-10T00:00:00.000Z' })],
      });
      expect(screen.getByText('Closed won')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Edit forecast category/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe('notes', () => {
    // Regression: the note editor used to open blank even when the provider
    // (or an earlier session edit) already held a note, so a blind save
    // erased it with an accidental clear tombstone.
    it('opens with the provider note when there is no session edit', () => {
      renderTable({ opportunities: [makeOpportunity({ notes: 'Champion is on leave' })] });

      fireEvent.click(screen.getByRole('button', { name: 'Edit note for Acme Freight' }));

      expect(screen.getByRole('textbox', { name: /Note for Acme Freight/ })).toHaveValue(
        'Champion is on leave',
      );
    });

    it('opens with the session override rather than the provider note', () => {
      renderTable({
        opportunities: [makeOpportunity({ notes: 'Champion is on leave' })],
        notes: { 'opp-1': 'New champion found' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Edit note for Acme Freight' }));

      expect(screen.getByRole('textbox', { name: /Note for Acme Freight/ })).toHaveValue(
        'New champion found',
      );
    });

    it('opens empty when the session edit is an explicit clear', async () => {
      const user = userEvent.setup();
      renderTable({
        opportunities: [makeOpportunity({ notes: 'Champion is on leave' })],
        notes: { 'opp-1': '' },
      });

      await user.click(screen.getByRole('button', { name: 'Add note for Acme Freight' }));

      expect(screen.getByRole('textbox', { name: /Note for Acme Freight/ })).toHaveValue('');
    });

    it('cancel preserves the prior note', async () => {
      const user = userEvent.setup();
      const { onSetNote } = renderTable({
        opportunities: [makeOpportunity({ notes: 'Champion is on leave' })],
      });

      await user.click(screen.getByRole('button', { name: 'Edit note for Acme Freight' }));
      const input = screen.getByRole('textbox', { name: /Note for Acme Freight/ });
      fireEvent.change(input, { target: { value: '' } });
      await user.click(screen.getByRole('button', { name: 'Cancel note edit' }));

      expect(onSetNote).not.toHaveBeenCalled();
      // The prior note is still the effective value: its disclosure remains.
      expect(
        screen.getByRole('button', { name: 'View note for Acme Freight' }),
      ).toBeInTheDocument();
    });

    it('Escape preserves the prior note', async () => {
      const user = userEvent.setup();
      const { onSetNote } = renderTable({
        opportunities: [makeOpportunity({ notes: 'Champion is on leave' })],
      });

      await user.click(screen.getByRole('button', { name: 'Edit note for Acme Freight' }));
      const input = screen.getByRole('textbox', { name: /Note for Acme Freight/ });
      fireEvent.change(input, { target: { value: '' } });
      await user.keyboard('{Escape}');

      expect(onSetNote).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', { name: 'View note for Acme Freight' }),
      ).toBeInTheDocument();
    });

    it('reports an emptied note as an empty string, not as no edit', async () => {
      const user = userEvent.setup();
      const { onSetNote } = renderTable({
        opportunities: [makeOpportunity({ notes: 'Champion is on leave' })],
      });

      await user.click(screen.getByRole('button', { name: 'Edit note for Acme Freight' }));
      const input = screen.getByRole('textbox', { name: /Note for Acme Freight/ });
      fireEvent.change(input, { target: { value: '' } });
      await user.keyboard('{Enter}');

      expect(onSetNote).toHaveBeenCalledWith('opp-1', '');
    });

    it('renders a cleared note as no note, not as the provider value', () => {
      renderTable({
        opportunities: [makeOpportunity({ notes: 'Champion is on leave' })],
        notes: { 'opp-1': '' },
      });

      expect(screen.queryByText('Champion is on leave')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'View note for Acme Freight' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add note for Acme Freight' })).toBeInTheDocument();
    });

    it('commits a note and keeps it out of the row body', async () => {
      const user = userEvent.setup();
      const { onSetNote } = renderTable();

      await user.click(screen.getByRole('button', { name: /note for Acme Freight/ }));
      fireEvent.change(screen.getByRole('textbox', { name: /Note for Acme Freight/ }), {
        target: { value: 'Procurement is the blocker' },
      });
      await user.keyboard('{Enter}');

      expect(onSetNote).toHaveBeenCalledWith('opp-1', 'Procurement is the blocker');
      expect(screen.queryByText('Procurement is the blocker')).not.toBeInTheDocument();
    });

    it('trims whitespace before committing', async () => {
      const user = userEvent.setup();
      const { onSetNote } = renderTable();

      await user.click(screen.getByRole('button', { name: /note for Acme Freight/ }));
      fireEvent.change(screen.getByRole('textbox', { name: /Note for Acme Freight/ }), {
        target: { value: '   spaced   ' },
      });
      await user.keyboard('{Enter}');

      expect(onSetNote).toHaveBeenCalledWith('opp-1', 'spaced');
    });
  });

  describe('note disclosure', () => {
    it('keeps the note out of the row body until the disclosure is activated', () => {
      renderTable({ opportunities: [makeOpportunity({ notes: 'Champion is on leave' })] });

      expect(screen.queryByText('Champion is on leave')).not.toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: 'View note for Acme Freight' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('reveals the note through the disclosure and hides it again', async () => {
      const user = userEvent.setup();
      renderTable({ opportunities: [makeOpportunity({ notes: 'Champion is on leave' })] });
      const toggle = screen.getByRole('button', { name: 'View note for Acme Freight' });

      await user.click(toggle);

      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      // The control relationship names the region that holds the note.
      const disclosed = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
      expect(disclosed).toHaveTextContent('Champion is on leave');

      await user.click(screen.getByRole('button', { name: 'Hide note for Acme Freight' }));

      expect(screen.queryByText('Champion is on leave')).not.toBeInTheDocument();
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('is operable from the keyboard', async () => {
      const user = userEvent.setup();
      renderTable({ opportunities: [makeOpportunity({ notes: 'Champion is on leave' })] });
      const toggle = screen.getByRole('button', { name: 'View note for Acme Freight' });

      toggle.focus();
      await user.keyboard('{Enter}');
      expect(screen.getByText('Champion is on leave')).toBeInTheDocument();

      await user.keyboard(' ');
      expect(screen.queryByText('Champion is on leave')).not.toBeInTheDocument();
    });

    it('offers no disclosure when there is no note', () => {
      renderTable();

      expect(
        screen.queryByRole('button', { name: /View note for Acme Freight/ }),
      ).not.toBeInTheDocument();
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
