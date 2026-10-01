import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  QueryLoading,
  QueryFailure,
  QueryMetaCaption,
  renderQueryState,
  renderQueryStates,
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

  it('an unavailable answer names the widget with stable copy and offers a focused retry', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(
      <>
        {renderQueryState(
          'weighted forecast',
          state({ error: 'Failed to load the weighted forecast', retry }),
          renderTotal,
        )}
      </>,
    );

    // No data, no caption, no plausible-looking stand-in: the widget says it
    // is unavailable, says why in its stable operation copy, and its retry
    // repeats only this query.
    expect(screen.getByText('Weighted forecast unavailable:')).toBeInTheDocument();
    expect(screen.getByText('Failed to load the weighted forecast')).toBeInTheDocument();
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
            error: 'Failed to load the forecast summary',
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
        error="Failed to load the partner directory"
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText(/Partner names unavailable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry partner directory' })).toBeInTheDocument();
  });

  it('a successful retry moves focus to the widget’s named region, never the document body', async () => {
    // The Retry button unmounts with the failure UI, so without recovery the
    // keyboard user's focus would fall to document.body. The region the
    // widget renders in is the stable, named landing target.
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(
      <>
        {renderQueryState(
          'forecast summary',
          state({ error: 'Failed to load the forecast summary', retry }),
          renderTotal,
        )}
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Retry forecast summary' }));
    expect(retry).toHaveBeenCalledTimes(1);

    rerender(
      <>
        {renderQueryState(
          'forecast summary',
          state({ data: { total: 42 }, meta: meta() }),
          renderTotal,
        )}
      </>,
    );

    const region = screen.getByRole('group', { name: 'forecast summary' });
    expect(region).toContainElement(screen.getByText('Total: 42'));
    expect(document.activeElement).toBe(region);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('a successful retry after a failed refresh lands focus on the same named region', async () => {
    // The stale-beats-blank failure shape: the figures stayed on screen, the
    // retry rode alongside them, and the recovery still owns the focus.
    const user = userEvent.setup();
    const retry = vi.fn();
    const failing = state({
      data: { total: 42 },
      meta: meta(),
      error: 'Failed to load the forecast summary',
      retry,
    });
    const { rerender } = render(<>{renderQueryState('forecast summary', failing, renderTotal)}</>);

    await user.click(screen.getByRole('button', { name: 'Retry forecast summary' }));
    rerender(
      <>
        {renderQueryState(
          'forecast summary',
          state({ data: { total: 43 }, meta: meta() }),
          renderTotal,
        )}
      </>,
    );

    expect(screen.getByText('Total: 43')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'forecast summary' }));
  });

  it('leaves focus the user moved elsewhere alone when the recovery lands', async () => {
    // Arming happens on the retry click, but focus that is verifiably the
    // user's own — on another control, connected, outside the region — is
    // never stolen back.
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(
      <>
        {renderQueryState(
          'weekly series',
          state({ error: 'Failed to load the weekly series', retry }),
          renderTotal,
        )}
        <button type="button">Elsewhere</button>
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Retry weekly series' }));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    rerender(
      <>
        {renderQueryState(
          'weekly series',
          state({ data: { total: 1 }, meta: meta() }),
          renderTotal,
        )}
        <button type="button">Elsewhere</button>
      </>,
    );

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });

  it('an unretried recovery does not claim focus', () => {
    // A failure that clears without its retry being clicked — a scope change
    // that refetches — must not teleport focus from wherever the user is.
    const { rerender } = render(
      <>
        {renderQueryState(
          'forecast summary',
          state({ error: 'Failed to load the forecast summary', retry: vi.fn() }),
          renderTotal,
        )}
      </>,
    );

    rerender(
      <>
        {renderQueryState(
          'forecast summary',
          state({ data: { total: 42 }, meta: meta() }),
          renderTotal,
        )}
      </>,
    );

    expect(document.activeElement).toBe(document.body);
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

/**
 * The multi-query sibling of the states above: a panel whose content needs
 * several answers. The regression these pin: a failed refresh with retained
 * data used to fall through as healthy — the content rendered and no failure
 * or retry was ever shown.
 */
describe('query section states', () => {
  const renderRoster = () => <p>The roster is on screen</p>;

  it('renders retained content with a named refresh failure, retrying only the failed dependency', async () => {
    const user = userEvent.setup();
    const rosterRetry = vi.fn();
    const managersRetry = vi.fn();
    render(
      <>
        {renderQueryStates(
          'The team roster',
          [
            [
              'the notification roster',
              state({
                data: { total: 4 },
                meta: meta(),
                error: 'Failed to load the notification roster',
                retry: rosterRetry,
              }),
            ],
            [
              'the manager directory',
              state({ data: { total: 2 }, meta: meta(), retry: managersRetry }),
            ],
          ],
          renderRoster,
        )}
      </>,
    );

    // Stale beats blank: the last good content stays, the failure is named
    // next to it with the dependency's stable copy — never raw rejection
    // prose — and the answered dependency is not re-run by the retry.
    expect(screen.getByText('The roster is on screen')).toBeInTheDocument();
    expect(screen.getByText('Latest refresh failed:')).toBeInTheDocument();
    expect(screen.getByText('Failed to load the notification roster')).toBeInTheDocument();
    expect(screen.queryByText(/The team roster unavailable/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry The team roster' }));
    expect(rosterRetry).toHaveBeenCalledTimes(1);
    expect(managersRetry).not.toHaveBeenCalled();
  });

  it('retries every failed dependency exactly once on one click', async () => {
    const user = userEvent.setup();
    const alertsRetry = vi.fn();
    const rosterRetry = vi.fn();
    const managersRetry = vi.fn();
    render(
      <>
        {renderQueryStates(
          'The SLA alert queue',
          [
            [
              'the registration SLA alerts',
              state({
                data: { total: 3 },
                meta: meta(),
                error: 'Failed to load the registration SLA alerts',
                retry: alertsRetry,
              }),
            ],
            [
              'the notification roster',
              state({
                data: { total: 4 },
                meta: meta(),
                error: 'Failed to load the notification roster',
                retry: rosterRetry,
              }),
            ],
            [
              'the manager directory',
              state({ data: { total: 2 }, meta: meta(), retry: managersRetry }),
            ],
          ],
          renderRoster,
        )}
      </>,
    );

    // Two dependencies failed their refresh; the first one's copy leads and
    // one click repeats both — each exactly once, the healthy one never.
    expect(screen.getByText('Failed to load the registration SLA alerts')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry The SLA alert queue' }));
    expect(alertsRetry).toHaveBeenCalledTimes(1);
    expect(rosterRetry).toHaveBeenCalledTimes(1);
    expect(managersRetry).not.toHaveBeenCalled();
  });

  it('a mix of initial and refresh failures renders unavailable and retries every failed dependency', async () => {
    const user = userEvent.setup();
    const rosterRetry = vi.fn();
    const recordsRetry = vi.fn();
    render(
      <>
        {renderQueryStates(
          'The notification composer',
          [
            [
              'the notification roster',
              state({ error: 'Failed to load the notification roster', retry: rosterRetry }),
            ],
            [
              'the registration records',
              state({
                data: { total: 9 },
                meta: meta(),
                error: 'Failed to load the registration records',
                retry: recordsRetry,
              }),
            ],
          ],
          renderRoster,
        )}
      </>,
    );

    // A dependency with no answer takes the panel down, but the retry still
    // owes the refresh-failed dependency its one repeat too.
    expect(screen.getByText('The notification composer unavailable:')).toBeInTheDocument();
    expect(screen.queryByText('The roster is on screen')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry The notification composer' }));
    expect(rosterRetry).toHaveBeenCalledTimes(1);
    expect(recordsRetry).toHaveBeenCalledTimes(1);
  });

  it('a successful section retry lands focus on the section region, never the body', async () => {
    const user = userEvent.setup();
    const failing = state({
      data: { total: 4 },
      meta: meta(),
      error: 'Failed to load the notification roster',
      retry: vi.fn(),
    });
    const recovered = state({ data: { total: 4 }, meta: meta() });
    const { rerender } = render(
      <>
        {renderQueryStates('The team roster', [['the notification roster', failing]], renderRoster)}
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Retry The team roster' }));
    rerender(
      <>
        {renderQueryStates(
          'The team roster',
          [['the notification roster', recovered]],
          renderRoster,
        )}
      </>,
    );

    expect(screen.queryByText('Latest refresh failed:')).not.toBeInTheDocument();
    const region = screen.getByRole('group', { name: 'The team roster' });
    expect(region).toContainElement(screen.getByText('The roster is on screen'));
    expect(document.activeElement).toBe(region);
  });

  it('an unretried section recovery does not claim focus', () => {
    const { rerender } = render(
      <>
        {renderQueryStates(
          'The team roster',
          [
            [
              'the notification roster',
              state({
                data: { total: 4 },
                meta: meta(),
                error: 'Failed to load the notification roster',
                retry: vi.fn(),
              }),
            ],
          ],
          renderRoster,
        )}
      </>,
    );

    rerender(
      <>
        {renderQueryStates(
          'The team roster',
          [['the notification roster', state({ data: { total: 4 }, meta: meta() })]],
          renderRoster,
        )}
      </>,
    );

    expect(document.activeElement).toBe(document.body);
  });
});
