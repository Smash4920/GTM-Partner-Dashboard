import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionCenterView from './ActionCenterView';
import type { ActionPolicy } from '../data/types';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { generateDashboardData } from '../data/mock/generate';
import '../data/mock/actionCenterQueries';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { ACTION_POLICY_FIELDS, DEFAULT_ACTION_POLICY } from '../lib/actionPolicy';

// Providers read this deterministic book; each test still owns its provider,
// cursor issuer, spies and session state.
const BOOK = generateDashboardData();

function policyForm() {
  return within(screen.getByLabelText(ACTION_POLICY_FIELDS[0].label).closest('form')!);
}

function filterControls() {
  return within(screen.getByText('Filters').closest('section')!);
}

function mount(provider = new MockDataProvider(BOOK)) {
  const apply = vi.fn();
  const summary = vi.spyOn(provider, 'getActionCenterSummary');
  const list = vi.spyOn(provider, 'listActionItems');
  function Session() {
    const [policy, setPolicy] = useState<Readonly<ActionPolicy>>(DEFAULT_ACTION_POLICY);
    return (
      <ActionCenterView
        provider={provider}
        policy={policy}
        onPolicyChange={(next) => {
          apply(next);
          setPolicy(next);
        }}
      />
    );
  }
  render(<Session />);
  return { apply, summary, list, form: policyForm() };
}

describe('Action Center demo policy controls', () => {
  it('shows exact defaults, unique counts and full matching reason counts', async () => {
    const { form } = mount();
    for (const { key, label } of ACTION_POLICY_FIELDS) {
      expect(form.getByLabelText(label)).toHaveValue(String(DEFAULT_ACTION_POLICY[key]));
    }
    await screen.findByText('85 unique items');
    expect(screen.getByText('Stale high-value deal: 17')).toBeInTheDocument();
    expect(screen.getByText('Missing next step: 42')).toBeInTheDocument();
    expect(screen.getByText('Showing 25 of 85 action items')).toBeInTheDocument();
    expect(screen.getByText(/session-only.*Reload restores defaults/)).toBeInTheDocument();
  });

  it.each(
    ACTION_POLICY_FIELDS.flatMap(({ key, label }) =>
      ['', ' ', 'no', 'NaN', 'Infinity', '-Infinity', '1.5', '0', '-1'].map((value) => ({
        key,
        label,
        value,
      })),
    ),
  )(
    'blocks $key=$value with field-associated errors, unchanged results and no query',
    async ({ key, label, value }) => {
      const { apply, summary, list, form } = mount();
      await screen.findByText('85 unique items');
      const input = form.getByLabelText(label);
      fireEvent.change(input, { target: { value } });
      fireEvent.click(form.getByRole('button', { name: 'Apply demo policy' }));
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(
        document.getElementById(input.getAttribute('aria-describedby') ?? ''),
      ).toHaveTextContent('Enter a finite positive integer.');
      expect(input).toHaveFocus();
      expect(apply).not.toHaveBeenCalled();
      expect(summary).toHaveBeenCalledTimes(1);
      expect(list).toHaveBeenCalledTimes(1);
      expect(screen.getByText('85 unique items')).toBeInTheDocument();
      fireEvent.change(input, { target: { value: String(DEFAULT_ACTION_POLICY[key]) } });
      expect(input).not.toHaveAttribute('aria-describedby');
    },
  );

  it('blocks out-of-range drivers then applies a valid policy and resets only Action Center paging', async () => {
    const { apply, summary, list, form } = mount();
    await screen.findByText('Showing 25 of 85 action items');
    const pagination = screen
      .getByText('Showing 25 of 85 action items')
      .closest('p')!.parentElement!;
    fireEvent.click(within(pagination).getByRole('button', { name: 'Load 25 more' }));
    await screen.findByText('Showing 50 of 85 action items');
    const input = form.getByLabelText('Minimum deteriorating drivers');
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(form.getByRole('button', { name: 'Apply demo policy' }));
    expect(screen.getByText('Enter an integer from 1 to 4.')).toBeInTheDocument();
    expect(summary).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(form.getByRole('button', { name: 'Apply demo policy' }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(3));
    expect(list.mock.calls[2]?.[2]).toEqual({ limit: 25 });
    await waitFor(() => expect(screen.getByText(/Showing 25 of/)).toBeInTheDocument());
    expect(summary).toHaveBeenCalledTimes(2);
  });

  it('combines category OR with severity AND and resets page one', async () => {
    const provider = new MockDataProvider(BOOK);
    const expected = await provider.getActionCenterSummary(INTERNAL_DEMO_SCOPE, {
      policy: DEFAULT_ACTION_POLICY,
      filters: { categories: ['missing-next-step', 'registration-sla'], severity: 'critical' },
    });
    mount(provider);
    await screen.findByText('85 unique items');
    fireEvent.click(filterControls().getByRole('checkbox', { name: 'Missing next step' }));
    fireEvent.click(filterControls().getByRole('checkbox', { name: 'Registration SLA' }));
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'critical' } });
    await screen.findByText(`${expected.data.totalCount} unique items`);
    expect(
      screen.getByText(
        `Showing ${expected.data.totalCount} of ${expected.data.totalCount} action items`,
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('action-item')).toHaveLength(expected.data.totalCount);
  });

  it('clears owner and category filters without retaining a foreign page', async () => {
    mount();
    await screen.findByText('85 unique items');
    fireEvent.change(screen.getByLabelText('Owner ID'), { target: { value: 'unowned' } });
    await screen.findByText('0 unique items');
    expect(screen.getByText('No matching action items.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Owner ID'), { target: { value: '' } });
    await screen.findByText('85 unique items');
    const category = filterControls().getByRole('checkbox', { name: 'Registration SLA' });
    fireEvent.click(category);
    await screen.findByText('17 unique items');
    fireEvent.click(category);
    await screen.findByText('85 unique items');
    expect(screen.getByText('Showing 25 of 85 action items')).toBeInTheDocument();
  });

  it('keeps unowned items visible and disables only notification recipient controls', async () => {
    const provider = new MockDataProvider(BOOK);
    const users = (await provider.getTeamRoster(INTERNAL_DEMO_SCOPE, {})).data;
    const send = vi.fn();
    render(
      <ActionCenterView
        provider={provider}
        policy={DEFAULT_ACTION_POLICY}
        onPolicyChange={vi.fn()}
        onSendNotification={send}
        onOpenContext={vi.fn()}
        roster={{
          overrides: Object.fromEntries(users.map((user) => [user.id, { status: 'suspended' }])),
        }}
      />,
    );
    await screen.findByText('85 unique items');
    const rows = screen.getAllByTestId('action-item');
    expect(rows).toHaveLength(25);
    for (const row of rows) {
      expect(
        within(row).getByText('Unowned — no eligible active demo recipient.'),
      ).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Notify owner' })).toBeDisabled();
      expect(within(row).getByRole('link', { name: /Open .* context/ })).not.toHaveAttribute(
        'aria-disabled',
      );
      expect(within(row).getByRole('button', { name: /Show evidence/ })).toBeEnabled();
    }
    fireEvent.change(screen.getByLabelText('Owner ID'), { target: { value: 'unowned' } });
    await screen.findByText('Showing 25 of 85 action items');
    fireEvent.click(filterControls().getByRole('button', { name: 'Unowned only' }));
    expect(screen.getByLabelText('Owner ID')).toHaveValue('');
    fireEvent.click(filterControls().getByRole('button', { name: 'Unowned only' }));
    expect(screen.getByLabelText('Owner ID')).toHaveValue('unowned');
    expect(filterControls().getByRole('button', { name: 'Unowned only' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(filterControls().getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByLabelText('Owner ID')).toHaveValue('');
    expect(send).not.toHaveBeenCalled();
  });

  it('exposes complete merged evidence, recommendation, owner basis and lineage with an internal context action', async () => {
    const provider = new MockDataProvider(BOOK);
    const context = vi.fn();
    const page = await provider.listActionItems(
      INTERNAL_DEMO_SCOPE,
      { policy: DEFAULT_ACTION_POLICY },
      { limit: 25 },
    );
    render(
      <ActionCenterView
        provider={provider}
        policy={DEFAULT_ACTION_POLICY}
        onPolicyChange={vi.fn()}
        onOpenContext={context}
      />,
    );
    await screen.findByText('85 unique items');
    const item = page.data.rows[0];
    const row = screen.getAllByTestId('action-item')[0];
    const disclosure = within(row).getByRole('button', { name: `Show evidence for ${item.id}` });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(within(row).queryByText(/Lineage:/)).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const evidence = document.getElementById(disclosure.getAttribute('aria-controls') ?? '');
    expect(evidence).toHaveTextContent('As of Sep 18, 2026');
    expect(evidence).toHaveTextContent('Lineage:');
    expect(evidence).toHaveTextContent('mock-book');
    for (const reason of item.reasons) expect(evidence).toHaveTextContent(reason.recommendedAction);
    expect(row).toHaveTextContent(`Owner: ${item.owner?.userId}`);
    expect(row).toHaveTextContent('Exposure:');
    expect(row).toHaveTextContent('Due:');
    fireEvent.click(within(row).getByRole('link', { name: /Open .* context/ }));
    expect(context).toHaveBeenCalledWith(item);
    fireEvent.click(disclosure);
    expect(evidence).not.toBeInTheDocument();
  });

  it('opens and closes the shared composer without changing the action item list', async () => {
    const provider = new MockDataProvider(BOOK);
    render(
      <ActionCenterView
        provider={provider}
        policy={DEFAULT_ACTION_POLICY}
        onPolicyChange={vi.fn()}
        onSendNotification={vi.fn()}
      />,
    );
    await screen.findByText('85 unique items');
    const row = screen.getAllByTestId('action-item')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Notify owner' }));
    await screen.findByLabelText('Subject');
    expect(within(row).getByRole('button', { name: 'Close notification' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    fireEvent.click(within(row).getByRole('button', { name: 'Close notification' }));
    expect(screen.queryByLabelText('Subject')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('action-item')).toHaveLength(25);
  });
});
