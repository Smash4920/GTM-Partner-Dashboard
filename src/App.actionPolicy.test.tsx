import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { DATA_PROVIDER_METHODS } from './data/DataProvider';
import type { DataProvider } from './data/DataProvider';

describe('Action Center session policy in the shell', () => {
  it('queries only Action Center on apply, survives navigation, and resets with a committed provider', async () => {
    const local = new MockDataProvider();
    const remote = new MockDataProvider(undefined, { providerId: 'remote' });
    const calls: string[] = [];
    const provider = new Proxy(local, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (
          typeof value !== 'function' ||
          !DATA_PROVIDER_METHODS.includes(property as keyof DataProvider)
        )
          return value;
        return (...args: unknown[]) => {
          calls.push(String(property));
          return (value as (...values: unknown[]) => unknown).apply(target, args);
        };
      },
    });
    const probe = vi.fn().mockResolvedValue(undefined);
    render(
      <App providerFactory={(id) => (id === 'local' ? provider : remote)} probeProvider={probe} />,
    );
    await screen.findByRole('heading', { name: 'Partner Performance Overview' });
    const initialStorage = [Object.entries(localStorage), Object.entries(sessionStorage)];
    const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
    fireEvent.click(nav.getByRole('button', { name: 'Action Center' }));
    await screen.findByText('85 unique items');
    calls.length = 0;
    fireEvent.change(screen.getByLabelText('Stale days (calendar)'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply demo policy' }));
    await waitFor(() =>
      expect(calls.sort()).toEqual(['getActionCenterSummary', 'listActionItems']),
    );
    fireEvent.click(nav.getByRole('button', { name: 'Home' }));
    await screen.findByRole('heading', { name: 'Partner Performance Overview' });
    fireEvent.click(nav.getByRole('button', { name: 'Action Center' }));
    expect(await screen.findByLabelText('Stale days (calendar)')).toHaveValue('1');
    fireEvent.change(screen.getByLabelText('Data provider'), { target: { value: 'remote' } });
    await waitFor(() => expect(screen.getByLabelText('Stale days (calendar)')).toHaveValue('14'));
    expect([Object.entries(localStorage), Object.entries(sessionStorage)]).toEqual(initialStorage);
  });
});
