import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ActionCenterView from './ActionCenterView';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { DEFAULT_ACTION_POLICY } from '../lib/actionPolicy';
import { ACTION_CATEGORIES } from '../data/actionCenter';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { actionEvidence } from '../lib/actionEvidence';

describe('Action Center evidence and independent query states', () => {
  it.each(ACTION_CATEGORIES)(
    'discloses all %s evidence with Enter and Space and removes closed content',
    async (category) => {
      const provider = new MockDataProvider();
      const page = await provider.listActionItems(
        INTERNAL_DEMO_SCOPE,
        {
          policy: DEFAULT_ACTION_POLICY,
          filters: { categories: [category] },
        },
        { limit: 25 },
      );
      vi.spyOn(provider, 'listActionItems').mockResolvedValue(page);
      const user = userEvent.setup();
      render(
        <ActionCenterView
          provider={provider}
          policy={DEFAULT_ACTION_POLICY}
          onPolicyChange={vi.fn()}
        />,
      );
      const row = (await screen.findAllByTestId('action-item'))[0];
      const button = within(row).getByRole('button', { name: /Show evidence/ });
      button.focus();
      await user.keyboard('{Enter}');
      const evidence = within(row).getByRole('region', { name: /Evidence for/ });
      for (const reason of page.data.rows[0].reasons) {
        expect(evidence).toHaveTextContent(actionEvidence(reason));
        expect(evidence).toHaveTextContent(reason.recommendedAction);
      }
      expect(button).toHaveFocus();
      await user.keyboard(' ');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(within(row).queryByRole('region', { name: /Evidence for/ })).not.toBeInTheDocument();
    },
  );

  it('VAL-CROSS-006: retains partial data and siblings through initial and page failures, with focused retries and sanitized copy', async () => {
    const provider = new MockDataProvider();
    const originalSummary = provider.getActionCenterSummary.bind(provider);
    const summary = vi
      .spyOn(provider, 'getActionCenterSummary')
      .mockRejectedValueOnce(new Error('PRIVATE raw error sentinel'))
      .mockImplementation(async (...args) => {
        const result = await originalSummary(...args);
        return {
          ...result,
          meta: {
            ...result.meta,
            completeness: 'partial',
            warnings: [
              {
                code: 'unattributed-opportunities',
                message: 'One opportunity is missing manager attribution',
              },
            ],
          },
        };
      });
    const originalList = provider.listActionItems.bind(provider);
    const list = vi.spyOn(provider, 'listActionItems').mockImplementation(originalList);
    render(
      <ActionCenterView
        provider={provider}
        policy={DEFAULT_ACTION_POLICY}
        onPolicyChange={vi.fn()}
      />,
    );
    await screen.findByText('Showing 25 of 85 action items');
    const ids = () => screen.getAllByTestId('action-item').map((row) => row.dataset.actionId);
    const initial = ids();
    const summaryRegion = screen.getByRole('group', { name: 'Action Center summary' });
    const summaryRetry = within(summaryRegion).getByRole('button', {
      name: 'Retry Action Center summary',
    });
    summaryRetry.focus();
    fireEvent.click(summaryRetry);
    await screen.findByText('85 unique items');
    expect(summary).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(1);
    expect(summaryRegion).toHaveFocus();
    expect(summaryRegion).toHaveTextContent('provider local · partial');
    expect(summaryRegion).toHaveTextContent('One opportunity is missing manager attribution');
    list.mockRejectedValueOnce(new Error('PRIVATE page error sentinel'));
    const more = screen.getByRole('button', { name: 'Load 25 more' });
    more.focus();
    fireEvent.click(more);
    await screen.findByRole('button', { name: 'Retry action items' });
    expect(ids()).toEqual(initial);
    expect(more).toHaveFocus();
    const retry = screen.getByRole('button', { name: 'Retry action items' });
    retry.focus();
    fireEvent.click(retry);
    await screen.findByText('Showing 50 of 85 action items');
    await waitFor(() => expect(screen.getByRole('group', { name: 'action items' })).toHaveFocus());
    expect(ids().slice(0, 25)).toEqual(initial);
    expect(new Set(ids()).size).toBe(50);
    expect(list).toHaveBeenCalledTimes(3);
    expect(summary).toHaveBeenCalledTimes(2);
    expect(document.body).not.toHaveTextContent('PRIVATE');
    expect(summaryRegion).toHaveTextContent('partial');
  });

  it('announces loading/end and keeps the pagination control and focus at the final page', async () => {
    const user = userEvent.setup();
    render(
      <ActionCenterView
        provider={new MockDataProvider()}
        policy={DEFAULT_ACTION_POLICY}
        onPolicyChange={vi.fn()}
      />,
    );
    await screen.findByText('Showing 25 of 85 action items');
    const more = screen.getByRole('button', { name: 'Load 25 more' });
    for (const count of [50, 75, 85]) {
      await user.click(more);
      await screen.findByText(`Showing ${count} of 85 action items`);
      expect(more).toHaveFocus();
    }
    expect(more).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('end of results');
    await user.click(more);
    expect(screen.getAllByTestId('action-item')).toHaveLength(85);
  });
});
