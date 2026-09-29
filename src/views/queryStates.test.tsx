import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryLoading,
  QueryFailure,
  QueryMetaCaption,
  renderQueryState,
} from '../components/QueryState';
import { buildQueryMeta, unattributedOpportunitiesWarning } from '../data/queryMetadata';
import type { QueryMeta } from '../data/queryMetadata';
import type { QueryState } from '../data/queryState';

/**
 * VAL-DATA-006, rendered half: complete, stale, partial, and unavailable
 * answers each expose their typed metadata and their visible state, and none
 * of them can be mistaken for another. The provider-side metadata is pinned
 * in src/data/mock/MockDataProvider.test.ts; the envelope contract itself in
 * src/data/queryMetadata.test.ts.
 */

const AS_OF = '2026-09-18T00:00:00.000Z';

function meta(overrides: Partial<QueryMeta> = {}): QueryMeta {
  return {
    ...buildQueryMeta({
      providerId: 'local',
      asOf: AS_OF,
      lineage: [
        { source: 'mock-book', description: 'Deterministic seeded book at the snapshot date' },
      ],
    }),
    ...overrides,
  };
}

function state(overrides: Partial<QueryState<{ total: number }>>): QueryState<{ total: number }> {
  return {
    data: null,
    meta: null,
    loading: false,
    refreshing: false,
    error: null,
    retry: vi.fn(),
    ...overrides,
  };
}

const renderTotal = (data: { total: number }) => <p>Total: {data.total}</p>;

describe('query states (VAL-DATA-006)', () => {
  it('a complete answer shows its data with provider, as-of, and completeness', () => {
    render(
      <>
        {renderQueryState(
          'forecast summary',
          state({ data: { total: 42 }, meta: meta() }),
          renderTotal,
        )}
      </>,
    );

    expect(screen.getByText('Total: 42')).toBeInTheDocument();
    const caption = screen.getByText(/As of Sep 18, 2026/);
    expect(caption).toHaveTextContent('provider local');
    expect(caption).toHaveTextContent('complete');
    expect(caption).not.toHaveTextContent('updating');
  });

  it('a stale answer keeps its data visible with the as-of of what is on screen', () => {
    render(
      <>
        {renderQueryState(
          'forecast summary',
          state({ data: { total: 42 }, meta: meta(), refreshing: true }),
          renderTotal,
        )}
      </>,
    );

    // The figures never blank during a refresh, and the caption says the
    // visible answer is the previous one — with its as-of, not a new one.
    expect(screen.getByText('Total: 42')).toBeInTheDocument();
    const caption = screen.getByText(/As of Sep 18, 2026/);
    expect(caption).toHaveTextContent('updating — showing the last good answer');
  });

  it('a partial answer stays visible with each typed warning listed beside it', () => {
    const partial = meta({
      completeness: 'partial',
      warnings: [unattributedOpportunitiesWarning(2)],
    });
    render(
      <>
        {renderQueryState(
          'manager groups',
          state({ data: { total: 7 }, meta: partial }),
          renderTotal,
        )}
      </>,
    );

    expect(screen.getByText('Total: 7')).toBeInTheDocument();
    expect(screen.getByText(/As of Sep 18, 2026/)).toHaveTextContent('partial');
    expect(
      screen.getByText(
        '2 in-quarter opportunities could not be attributed to a partner manager and are missing from the manager groups',
      ),
    ).toBeInTheDocument();
  });

  it('an unavailable answer names the widget and offers a focused retry', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <>
        {renderQueryState(
          'weighted forecast',
          state({ error: 'getWeightedForecast failed in transit (simulated)', retry }),
          renderTotal,
        )}
      </>,
    );

    // No data, no caption, no plausible-looking stand-in: the widget says it
    // is unavailable, says why, and its retry repeats only this query.
    expect(screen.getByText('Weighted forecast unavailable:')).toBeInTheDocument();
    expect(
      screen.getByText('getWeightedForecast failed in transit (simulated)'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/As of/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry weighted forecast' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('a failed refresh keeps the previous data and its metadata alongside the error', () => {
    render(
      <>
        {renderQueryState(
          'forecast summary',
          state({
            data: { total: 42 },
            meta: meta(),
            error: 'flaky wire',
          }),
          renderTotal,
        )}
      </>,
    );

    expect(screen.getByText('Total: 42')).toBeInTheDocument();
    expect(screen.getByText(/As of Sep 18, 2026/)).toBeInTheDocument();
    expect(screen.getByText('Latest forecast summary refresh failed:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry forecast summary' })).toBeInTheDocument();
  });

  it('an in-flight first load announces itself and shows nothing else', () => {
    render(<>{renderQueryState('weekly series', state({ loading: true }), renderTotal)}</>);

    expect(screen.getByRole('status')).toHaveTextContent('Loading weekly series');
    expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
  });

  it('the standalone primitives render the same states', () => {
    const { unmount } = render(<QueryLoading label="manager groups" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading manager groups');
    unmount();

    render(
      <QueryFailure
        text="Partner names unavailable — showing partner ids"
        retryLabel="partner directory"
        error="getPartnerDirectory failed in transit (simulated)"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Partner names unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry partner directory' })).toBeInTheDocument();
  });

  it('the metadata caption renders a lineage-independent summary and every warning', () => {
    render(
      <QueryMetaCaption
        meta={meta({
          providerId: 'remote',
          completeness: 'partial',
          warnings: [
            unattributedOpportunitiesWarning(1),
            {
              code: 'weekly-history-reconstructed',
              message:
                '2 of 7 closed weeks were reconstructed from the current book; no recorded snapshot exists for them',
            },
          ],
        })}
        refreshing={false}
      />,
    );

    const caption = screen.getByText(/As of Sep 18, 2026/);
    expect(caption).toHaveTextContent('provider remote');
    expect(caption).toHaveTextContent('partial');
    expect(screen.getByText(/1 in-quarter opportunity/)).toBeInTheDocument();
    expect(screen.getByText(/2 of 7 closed weeks were reconstructed/)).toBeInTheDocument();
  });
});
