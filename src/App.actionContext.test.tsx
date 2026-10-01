import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { MockDataProvider } from './data/mock/MockDataProvider';

describe('Action Center contextual navigation', () => {
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
      await screen.findByText('85 unique items');
      expect(screen.queryByRole('region', { name: 'Action context' })).not.toBeInTheDocument();
      await user.click(nav.getByRole('button', { name: 'Home' }));
      expect(screen.queryByRole('region', { name: 'Action context' })).not.toBeInTheDocument();
    },
  );
});
