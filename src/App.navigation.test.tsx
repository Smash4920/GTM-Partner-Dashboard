import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from './App';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { providerSessionBook } from './test/providerSessionFixtures';

const providerFactory = () => new MockDataProvider(providerSessionBook('LOCAL'));

describe('accessible route context', () => {
  it('puts the skip link first and focuses main without consuming the first Tab', async () => {
    const user = userEvent.setup();
    render(<App providerFactory={providerFactory} />);
    await user.tab();
    const skip = screen.getByRole('link', { name: 'Skip to main content' });
    expect(skip).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('titles, announces and focuses routes once without query-driven focus theft', async () => {
    render(<App providerFactory={providerFactory} />);
    expect(document.title).toBe('Home | GTM Partner Dashboard');
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    fireEvent.click(nav.getByRole('button', { name: 'Production Requirements' }));
    const heading = await screen.findByRole('heading', {
      name: 'Production Requirements',
      level: 1,
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(document.title).toBe('Production Requirements | GTM Partner Dashboard');
    expect(screen.getByRole('status', { name: 'Route announcement' })).toHaveTextContent(
      'Production Requirements',
    );
    expect(nav.getByRole('button', { name: 'Production Requirements' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const provider = screen.getByLabelText('Data provider');
    provider.focus();
    fireEvent.click(nav.getByRole('button', { name: 'Home' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveFocus());
    provider.focus();
    await waitFor(() => expect(screen.queryAllByText(/^Loading /)).toHaveLength(0));
    expect(provider).toHaveFocus();
  });
});
