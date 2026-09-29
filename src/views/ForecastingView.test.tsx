import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForecastingView from './ForecastingView';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { NO_SESSION_EDITS } from '../data/sessionEdits';
import type { SessionEdits } from '../data/sessionEdits';
import type { DataProvider } from '../data/DataProvider';
import { makeOpportunity, makePartner, makeProviderBook, makeTarget } from '../test/fixtures';

/**
 * The Phase 1 question, asked of the hardest view: does a view survive
 * server-side aggregation and cursor pagination? Forecasting is the test case
 * because it is the hottest edit path and the only one driven by the weekly
 * history that can never ship whole.
 */

const EMPTY_EDITS: SessionEdits = NO_SESSION_EDITS;

/** 27 deals for pm-1, so the first page of 25 is not the whole book. */
function makeBook() {
  return makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', name: 'Contoso Partners', partnerManagerId: 'pm-2' }),
    ],
    opportunities: [
      ...Array.from({ length: 27 }, (_, index) =>
        makeOpportunity({
          id: `opp-a${index}`,
          partnerId: 'partner-1',
          accountName: `Acme ${index}`,
          forecastedRevenue: 100_000,
          createdAt: '2026-08-01T00:00:00.000Z',
          expectedCloseDate: '2026-09-15T00:00:00.000Z',
        }),
      ),
      makeOpportunity({
        id: 'opp-b1',
        partnerId: 'partner-2',
        accountName: 'Contoso Freight',
        forecastedRevenue: 400_000,
        createdAt: '2026-08-02T00:00:00.000Z',
        expectedCloseDate: '2026-09-20T00:00:00.000Z',
      }),
    ],
    targets: [
      makeTarget({ partnerId: 'partner-1', revenueTarget: 500_000 }),
      makeTarget({ partnerId: 'partner-2', revenueTarget: 500_000 }),
    ],
  });
}

function renderView(options: { provider?: DataProvider; edits?: SessionEdits } = {}) {
  const handlers = {
    onSetRevenue: vi.fn(),
    onSetNote: vi.fn(),
    onSetNextStep: vi.fn(),
    onSetForecastCall: vi.fn(),
  };
  const provider = options.provider ?? new MockDataProvider(makeBook());
  const view = (edits: SessionEdits) => (
    <ForecastingView provider={provider} edits={edits} {...handlers} />
  );
  const utils = render(view(options.edits ?? EMPTY_EDITS));
  /** A committed edit, as App would produce: new maps, same provider. */
  const commitEdit = (edits: SessionEdits) => utils.rerender(view(edits));
  return { ...handlers, provider, commitEdit };
}

describe('ForecastingView', () => {
  it('renders the tiles from the provider aggregates', async () => {
    renderView();

    expect(await screen.findByRole('heading', { name: 'Forecasting' })).toBeInTheDocument();
    // 28 open in-quarter deals ÷ page size: the tiles are an aggregate, not a
    // count of the rows the client happens to hold.
    expect(await screen.findByText('28 open Q3 opps')).toBeInTheDocument();
    // The chart legend says this too, hence the plural query.
    expect(screen.getAllByText('Weighted forecast').length).toBeGreaterThan(1);
    expect(screen.getByText('Week-over-week pipeline')).toBeInTheDocument();
  });

  it('says so when every call is in line with its stage', async () => {
    renderView();
    expect(
      await screen.findByText('Every open deal is called in line with its stage.'),
    ).toBeInTheDocument();
  });

  it('surfaces a call that disagrees with its stage', async () => {
    const book = makeBook();
    book.opportunities[0] = { ...book.opportunities[0]!, forecastCategory: 'commit' };
    renderView({ provider: new MockDataProvider(book) });

    expect(await screen.findByText('Called above stage')).toBeInTheDocument();
    expect(
      screen.getByText('1 of 28 open Q3 deals are called off the category their stage implies'),
    ).toBeInTheDocument();
    // Bounded sample: the account name, and nothing more than the sample size.
    // The query is scoped to the card because the table below renders the same
    // account name once its page lands, and a global text query races the two
    // async loads — whichever resolves first decides what it finds.
    const mismatchCard = (
      await screen.findByRole('heading', { name: 'Calls that disagree with stage' })
    ).closest('section');
    expect(within(mismatchCard!).getByText('Acme 0')).toBeInTheDocument();
  });

  it('fetches one page per expanded manager, and pages on request', async () => {
    const user = userEvent.setup();
    renderView();

    // The first manager opens by default, and only their first page is
    // fetched: the provider sorts by expected close then id, so 'Acme 9' sorts
    // last and must not be on the page.
    expect(await screen.findByText('Showing 25 of 27')).toBeInTheDocument();
    expect(screen.queryByText('Acme 9')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Load 25 more' }));
    expect(await screen.findByText('Showing 27 of 27')).toBeInTheDocument();
    expect(screen.getByText('Acme 9')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load 25 more' })).not.toBeInTheDocument();
  });

  it('loads a manager when their group is expanded', async () => {
    const user = userEvent.setup();
    renderView();
    await screen.findByText('Showing 25 of 27');

    await user.click(await screen.findByRole('button', { name: /R\. Diaz/ }));

    // The second manager's book, including the partner name from the
    // directory the view fetches rather than the whole partner collection.
    expect(
      await screen.findByRole('button', {
        name: 'Edit revenue forecast for Contoso Freight',
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Contoso Partners').length).toBeGreaterThan(0);
  });

  it('filters to one manager and opens their group without refetching hidden books', async () => {
    const user = userEvent.setup();
    const { provider } = renderView();
    const bookSpy = vi.spyOn(provider, 'listQuarterOpportunities');

    await screen.findByText('Showing 25 of 27');
    await user.selectOptions(screen.getByLabelText('Partner manager'), 'pm-2');

    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument();
    // The filtered-out book stays mounted but hidden: the filter is a
    // presentation choice and must not discard loaded pages.
    expect(screen.getByText('Showing 25 of 27')).not.toBeVisible();
    const calls = bookSpy.mock.calls.length;

    await user.selectOptions(screen.getByLabelText('Partner manager'), 'all');
    expect(screen.getByText('Showing 25 of 27')).toBeVisible();
    expect(bookSpy.mock.calls.length).toBe(calls);
  });

  it('shows the session override in the row while the aggregates catch up', async () => {
    renderView({ edits: { ...EMPTY_EDITS, revenueOverrides: { 'opp-a0': 2_000_000 } } });

    const cell = await screen.findByText('$2,000,000');
    expect(cell).toBeInTheDocument();
    expect(cell).toHaveAttribute('title', 'Edited — differs from Salesforce forecast');
  });

  it('commits an inline revenue edit and a forecast call through the handlers', async () => {
    const user = userEvent.setup();
    const { onSetRevenue, onSetForecastCall } = renderView();

    await user.click(
      await screen.findByRole('button', { name: 'Edit revenue forecast for Acme 0' }),
    );
    const input = screen.getByRole('textbox', { name: 'Revenue forecast for Acme 0' });
    await user.clear(input);
    await user.type(input, '310000{Enter}');
    expect(onSetRevenue).toHaveBeenCalledWith('opp-a0', 310_000);

    await user.click(screen.getByRole('button', { name: 'Edit forecast category for Acme 1' }));
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Forecast category for Acme 1' }),
      'commit',
    );
    expect(onSetForecastCall).toHaveBeenCalledWith('opp-a1', 'commit');
  });

  it('renders a cleared next step as empty, not as the CRM value', async () => {
    const book = makeBook();
    book.opportunities[0] = { ...book.opportunities[0]!, nextStep: 'Call the buyer' };
    renderView({
      provider: new MockDataProvider(book),
      edits: { ...EMPTY_EDITS, nextSteps: { 'opp-a0': '' } },
    });

    const row = (await screen.findByText('Acme 0')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).queryByText('Call the buyer')).not.toBeInTheDocument();
    expect(
      within(row!).getByRole('button', { name: 'Add next step for Acme 0' }),
    ).toBeInTheDocument();
  });

  describe('coverage states (VAL-DATA-002)', () => {
    /** The coverage KPI tile, found by label so the other tiles cannot leak in. */
    function coverageTile(): HTMLElement {
      const label = screen.getByText('Pipeline coverage to goal');
      const tile = label.closest('div');
      if (!tile) throw new Error('coverage tile not found');
      return tile;
    }

    it('shows a finite coverage ratio while the goal is open', async () => {
      renderView();

      // 3.1M open against a 1M combined target, nothing closed yet.
      expect(await screen.findByText('28 open Q3 opps')).toBeInTheDocument();
      const tile = coverageTile();
      expect(within(tile).getByText('3.1x')).toBeInTheDocument();
      expect(within(tile).getByText('$1M goal remaining')).toBeInTheDocument();
    });

    it('shows No target when the quarter carries no target rows', async () => {
      const book = { ...makeBook(), targets: [] };
      renderView({ provider: new MockDataProvider(book) });

      expect(await screen.findByText('28 open Q3 opps')).toBeInTheDocument();
      const tile = coverageTile();
      expect(within(tile).getByText('No target')).toBeInTheDocument();
      expect(within(tile).getByText('No goal set')).toBeInTheDocument();
      expect(within(tile).queryByText('Target met')).not.toBeInTheDocument();
      expect(within(tile).queryByText(/∞|NaN/)).not.toBeInTheDocument();
    });

    it('shows Target met once closed-won reaches the goal, not a ratio over a zero gap', async () => {
      const book = makeBook();
      book.opportunities.push(
        makeOpportunity({
          id: 'opp-won-big',
          partnerId: 'partner-1',
          outcome: 'won',
          forecastedRevenue: 1_200_000,
          createdAt: '2026-08-01T00:00:00.000Z',
          expectedCloseDate: '2026-09-01T00:00:00.000Z',
          closedAt: '2026-09-01T00:00:00.000Z',
        }),
      );
      renderView({ provider: new MockDataProvider(book) });

      expect(await screen.findByText('Goal achieved')).toBeInTheDocument();
      const tile = coverageTile();
      expect(within(tile).getByText('Target met')).toBeInTheDocument();
      expect(within(tile).queryByText(/goal remaining/)).not.toBeInTheDocument();
    });
  });

  it('fails one widget without taking the page down, and retries only that query', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(makeBook());
    const summarySpy = vi
      .spyOn(provider, 'getForecastSummary')
      .mockRejectedValueOnce(new Error('getForecastSummary failed in transit (simulated)'));
    const weightedSpy = vi.spyOn(provider, 'getWeightedForecast');

    renderView({ provider });

    // The summary widget names its own failure; every sibling still renders.
    expect(await screen.findByText('Forecast summary unavailable:')).toBeInTheDocument();
    expect(
      screen.getByText('getForecastSummary failed in transit (simulated)'),
    ).toBeInTheDocument();
    expect((await screen.findAllByText('Weighted forecast')).length).toBeGreaterThan(1);
    expect(screen.getByText('Week-over-week pipeline')).toBeInTheDocument();
    expect(await screen.findByText('Showing 25 of 27')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry forecast summary' }));
    expect(await screen.findByText('28 open Q3 opps')).toBeInTheDocument();
    // The retry repeated the failed query only.
    expect(summarySpy).toHaveBeenCalledTimes(2);
    expect(weightedSpy).toHaveBeenCalledTimes(1);
  });

  it('a failed weighted forecast leaves the rest of the page up and retries alone', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(makeBook());
    const weightedSpy = vi
      .spyOn(provider, 'getWeightedForecast')
      .mockRejectedValueOnce(new Error('getWeightedForecast failed in transit (simulated)'));
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');

    renderView({ provider });

    expect(await screen.findByText('Weighted forecast unavailable:')).toBeInTheDocument();
    // Siblings: the summary tiles, the chart, and the table all render.
    expect(await screen.findByText('28 open Q3 opps')).toBeInTheDocument();
    expect(screen.getByText('Week-over-week pipeline')).toBeInTheDocument();
    expect(await screen.findByText('Showing 25 of 27')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry weighted forecast' }));
    expect(await screen.findByText('open Q3 pipeline × category probability')).toBeInTheDocument();
    expect(weightedSpy).toHaveBeenCalledTimes(2);
    expect(summarySpy).toHaveBeenCalledTimes(1);
  });

  it('a failed manager-groups query leaves the aggregates up and retries alone', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(makeBook());
    const groupsSpy = vi
      .spyOn(provider, 'getManagerForecastGroups')
      .mockRejectedValueOnce(new Error('getManagerForecastGroups failed in transit (simulated)'));
    const summarySpy = vi.spyOn(provider, 'getForecastSummary');

    renderView({ provider });

    expect(await screen.findByText('Manager groups unavailable:')).toBeInTheDocument();
    expect(await screen.findByText('28 open Q3 opps')).toBeInTheDocument();
    expect(screen.getByText('Week-over-week pipeline')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry manager groups' }));
    expect(await screen.findByText('Showing 25 of 27')).toBeInTheDocument();
    expect(groupsSpy).toHaveBeenCalledTimes(2);
    expect(summarySpy).toHaveBeenCalledTimes(1);
  });

  it('a failed partner directory falls back to opaque ids and recovers on retry', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(makeBook());
    const directorySpy = vi
      .spyOn(provider, 'getPartnerDirectory')
      .mockRejectedValueOnce(new Error('getPartnerDirectory failed in transit (simulated)'));

    renderView({ provider });

    expect(await screen.findByText(/Partner names unavailable/)).toBeInTheDocument();
    // Rows render with the raw partner id rather than failing.
    const row = (await screen.findByText('Acme 0')).closest('tr');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('partner-1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry partner directory' }));
    expect(await within(row!).findByText('Northwind Systems')).toBeInTheDocument();
    expect(directorySpy).toHaveBeenCalledTimes(2);
  });

  it('one manager’s failed book leaves the other managers alone', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(makeBook());
    const real = provider.listQuarterOpportunities.bind(provider);
    let failPm2 = true;
    const bookSpy = vi
      .spyOn(provider, 'listQuarterOpportunities')
      .mockImplementation((scope, page) =>
        failPm2 && scope.partnerManagerId === 'pm-2'
          ? Promise.reject(new Error('listQuarterOpportunities failed in transit (simulated)'))
          : real(scope, page),
      );

    renderView({ provider });
    await screen.findByText('Showing 25 of 27');

    await user.click(screen.getByRole('button', { name: /R\. Diaz/ }));
    expect(await screen.findByText('This book did not load:')).toBeInTheDocument();
    // The first manager's book is untouched.
    expect(screen.getByText('Showing 25 of 27')).toBeInTheDocument();

    failPm2 = false;
    await user.click(screen.getByRole('button', { name: 'Retry this manager’s book' }));
    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument();
    // The failed manager retried alone: pm-1's book was never refetched.
    const pm1Calls = bookSpy.mock.calls.filter(([scope]) => scope.partnerManagerId === 'pm-1');
    expect(pm1Calls).toHaveLength(1);
  });

  it('keeps the figures on screen when a refresh fails', async () => {
    const { provider, commitEdit } = renderView();
    await screen.findByText('Showing 25 of 27');

    vi.spyOn(provider, 'getForecastSummary').mockRejectedValueOnce(new Error('flaky wire'));
    commitEdit({ ...EMPTY_EDITS, revenueOverrides: { 'opp-a0': 1 } });

    expect(await screen.findByText('Latest forecast summary refresh failed:')).toBeInTheDocument();
    expect(screen.getByText('flaky wire')).toBeInTheDocument();
    // Stale beats blank: the tiles are still there to be read, and the row
    // being edited still shows the manager's figure.
    expect(screen.getByText('Average deal size')).toBeInTheDocument();
    expect(screen.getByText('$1')).toBeInTheDocument();
  });
});
