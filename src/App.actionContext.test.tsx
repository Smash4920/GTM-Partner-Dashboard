import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
// Retention tests do not measure cold chunks; production preview owns that boundary.
import './views/ActionCenterView';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { makeOpportunity, makePartner, makeProviderBook } from './test/fixtures';

describe('Action Center contextual navigation', () => {
  it('VAL-CROSS-003 retains edited forecast pages and Action Center filters, pages and return focus', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(
      makeProviderBook({
        partnerManagers: [{ id: 'pm-1', name: 'Demo manager' }],
        partners: [makePartner({ partnerManagerId: 'pm-1' })],
        registrations: [],
        opportunities: Array.from({ length: 30 }, (_, index) =>
          makeOpportunity({
            id: `context-${index}`,
            accountName: `Context ${index}`,
            forecastedRevenue: 400_000,
            createdAt: '2026-08-01T00:00:00.000Z',
            expectedCloseDate: '2026-09-25T00:00:00.000Z',
            nextStep: '',
          }),
        ),
      }),
    );
    render(<App providerFactory={() => provider} />);
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    await user.click(nav.getByRole('button', { name: 'Forecasting' }));
    const forecastPagination = (await screen.findByText('Showing 25 of 30')).parentElement!;
    await user.click(within(forecastPagination).getByRole('button', { name: 'Load 25 more' }));
    await screen.findByText('Showing 30 of 30');
    const forecastRow = screen.getByText('Context 0').closest('tr')!;
    const rowQueries = within(forecastRow);
    const edit = rowQueries.getByRole('button', { name: 'Edit revenue forecast for Context 0' });
    await user.click(edit);
    await user.clear(rowQueries.getByRole('textbox', { name: 'Revenue forecast for Context 0' }));
    await user.type(
      rowQueries.getByRole('textbox', { name: 'Revenue forecast for Context 0' }),
      '500000{Enter}',
    );
    await waitFor(() =>
      expect(
        rowQueries.getByRole('button', { name: 'Edit revenue forecast for Context 0' }),
      ).toHaveFocus(),
    );
    await user.click(nav.getByRole('button', { name: 'Action Center' }));
    await screen.findByText('30 unique items');
    await user.click(screen.getByRole('checkbox', { name: 'Missing next step' }));
    const actionPagination = screen
      .getByText('Showing 25 of 30 action items')
      .closest('p')!.parentElement!;
    await user.click(within(actionPagination).getByRole('button', { name: 'Load 25 more' }));
    await screen.findByText('Showing 30 of 30 action items');
    const row = screen
      .getAllByTestId('action-item')
      .find((item) => item.dataset.actionId === 'opportunity:context-0')!;
    expect(row).toHaveTextContent('$500,000');
    const link = within(row).getByRole('link', { name: 'Open Forecasting context' });
    await user.click(link);
    expect(screen.getByText('Showing 30 of 30')).toBeVisible();
    await user.click(
      within(screen.getByRole('region', { name: 'Action context' })).getByRole('button', {
        name: 'Back to Action Center',
      }),
    );
    expect(screen.getByText('Showing 30 of 30 action items')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Missing next step' })).toBeChecked();
    expect(link).toHaveFocus();
  });

  it('returns focus to the Action Center heading if an edited next step resolves the selected action', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(
      makeProviderBook({
        registrations: [],
        opportunities: [
          makeOpportunity({ nextStep: '', lastActivityAt: '2026-09-18T00:00:00.000Z' }),
        ],
      }),
    );
    render(<App providerFactory={() => provider} />);
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    await user.click(nav.getByRole('button', { name: 'Action Center' }));
    await screen.findByText('1 unique items');
    await user.click(screen.getByRole('link', { name: 'Open Forecasting context' }));
    const forecastRow = (await screen.findByText('Acme Freight')).closest('tr')!;
    const rowQueries = within(forecastRow);
    await user.click(rowQueries.getByRole('button', { name: 'Add next step for Acme Freight' }));
    await user.type(
      rowQueries.getByRole('textbox', { name: 'Next step for Acme Freight' }),
      'Follow up{Enter}',
    );
    await user.click(
      within(screen.getByRole('region', { name: 'Action context' })).getByRole('button', {
        name: 'Back to Action Center',
      }),
    );
    await screen.findByText('0 unique items');
    expect(screen.getByRole('heading', { name: 'Action Center', level: 1 })).toHaveFocus();
  });

  it.each([
    ['Missing next step', 'Open Forecasting context', 'Forecasting'],
    ['Registration SLA', 'Open Deal Reg Ops context', 'Deal Registration Operations'],
    ['Partner-health deterioration', 'Open partner context', 'Partner Performance'],
  ])(
    'opens %s on the same origin with the selected entity and resets on primary navigation',
    async (category, link, heading) => {
      const user = userEvent.setup();
      render(<App providerFactory={() => new MockDataProvider()} />);
      const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
      await user.click(nav.getByRole('button', { name: 'Action Center' }));
      await screen.findByText('85 unique items');
      await user.click(screen.getByRole('checkbox', { name: category }));
      const row = (await screen.findAllByTestId('action-item'))[0];
      const id = row.getAttribute('data-action-id');
      const origin = location.origin;
      const action = within(row).getByRole('link', { name: link });
      expect(new URL(action.getAttribute('href')!, location.href).origin).toBe(origin);
      await user.click(action);
      await screen.findByRole('heading', { name: heading, level: 1 });
      const context = screen.getByRole('region', { name: 'Action context' });
      expect(context).toHaveTextContent(`Action context: ${id}`);
      expect(within(context).getByRole('heading')).toHaveFocus();
      if (heading === 'Partner Performance') {
        expect(screen.getByLabelText('Partner')).toHaveValue(id?.split(':')[1]);
      }
      await user.click(within(context).getByRole('button', { name: 'Back to Action Center' }));
      expect(screen.getByRole('checkbox', { name: category })).toBeChecked();
      expect(action).toHaveFocus();
      expect(screen.queryByRole('region', { name: 'Action context' })).not.toBeInTheDocument();
      await user.click(nav.getByRole('button', { name: 'Home' }));
      expect(screen.queryByRole('region', { name: 'Action context' })).not.toBeInTheDocument();
    },
  );
});
