import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { makePartner, makeProviderBook, makeRegistration, makeTeamUser } from './test/fixtures';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

it('keeps source fixtures unchanged and resets workflows only at a successful disjoint provider commit', async () => {
  const localBook = makeProviderBook({
    teamUsers: [makeTeamUser()],
    partners: [makePartner(), makePartner({ id: 'partner-2' })],
    registrations: [makeRegistration(), makeRegistration({ id: 'reg-2', partnerId: 'partner-2' })],
  });
  const original = JSON.stringify(localBook);
  const local = new MockDataProvider(localBook);
  const remote = new MockDataProvider(
    makeProviderBook({
      partnerManagers: [{ id: 'remote-manager', name: 'Other manager' }],
      partners: [makePartner({ id: 'remote-partner', partnerManagerId: 'remote-manager' })],
      opportunities: [],
      registrations: [],
      targets: [],
      activities: [],
      certifications: [],
      teamUsers: [makeTeamUser({ id: 'remote-actor' })],
    }),
    { providerId: 'remote' },
  );
  const probe = vi.fn().mockRejectedValueOnce(new Error('readiness')).mockResolvedValue(undefined);
  render(<App providerFactory={(id) => (id === 'local' ? local : remote)} probeProvider={probe} />);
  await screen.findByRole('heading', { name: 'Partner Performance Overview' });
  const nav = within(screen.getByRole('navigation', { name: 'Primary' }));
  fireEvent.click(nav.getByRole('button', { name: 'Deal Reg Ops' }));
  const decide = await screen.findByRole('button', { name: 'Decide reg-1' });
  fireEvent.click(decide);
  await screen.findByLabelText('Demo actor (not authenticated)');
  fireEvent.change(screen.getByLabelText('Demo actor (not authenticated)'), {
    target: { value: 'user-1' },
  });
  fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'approved' } });
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'session reason' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record session outcome' }));
  await screen.findByRole('heading', { name: 'Session outcome recorded' });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  const records = () => within(screen.getByRole('list', { name: 'Session workflow records' }));
  expect(records().getAllByRole('listitem')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Decide reg-1' })).toBeInTheDocument();
  expect(JSON.stringify(localBook)).toBe(original);
  fireEvent.change(screen.getByLabelText('Data provider'), { target: { value: 'remote' } });
  await screen.findByText(/Couldn’t switch to Simulated remote/);
  expect(records().getAllByRole('listitem')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Retry switch to Simulated remote' }));
  await waitFor(() => expect(records().queryAllByRole('listitem')).toHaveLength(0));
  expect(screen.queryByRole('button', { name: 'Decide reg-1' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Data provider'), { target: { value: 'local' } });
  await screen.findByRole('button', { name: 'Decide reg-1' });
  expect(records().queryAllByRole('listitem')).toHaveLength(0);
  expect(JSON.stringify(localBook)).toBe(original);
});
