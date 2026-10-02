import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PaginationState } from '../data/paginationState';
import PageFooter from './PageFooter';

describe('pagination announcements and stable controls', () => {
  it('names the collection and retains the focused action through loading, failure, retry and end', () => {
    const state: PaginationState<number> = {
      rows: [1],
      totalCount: 2,
      meta: null,
      loading: false,
      refreshing: false,
      loadingMore: false,
      error: null,
      hasMore: true,
      loadMore: vi.fn(),
      retry: vi.fn(),
    };
    const { rerender } = render(<PageFooter state={state} noun="opportunities" pageSize={25} />);
    const action = screen.getByRole('button', { name: 'Load 25 more' });
    action.focus();
    fireEvent.click(action);
    expect(state.loadMore).toHaveBeenCalledTimes(1);
    rerender(
      <PageFooter state={{ ...state, loadingMore: true }} noun="opportunities" pageSize={25} />,
    );
    fireEvent.click(action);
    expect(state.loadMore).toHaveBeenCalledTimes(1);
    expect(action).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('Loading more opportunities');
    rerender(
      <PageFooter state={{ ...state, error: 'Failed' }} noun="opportunities" pageSize={25} />,
    );
    expect(screen.getByRole('button', { name: 'Retry opportunities' })).toBe(action);
    fireEvent.click(action);
    expect(state.retry).toHaveBeenCalledTimes(1);
    rerender(
      <PageFooter
        state={{ ...state, rows: [1, 2], hasMore: false }}
        noun="opportunities"
        pageSize={25}
      />,
    );
    expect(action).toHaveFocus();
    expect(action).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing 2 of 2 opportunities · end of results',
    );
    fireEvent.click(action);
    expect(state.loadMore).toHaveBeenCalledTimes(1);
  });
});
