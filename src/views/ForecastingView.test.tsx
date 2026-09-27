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
    expect(screen.getByText('Acme 0')).toBeInTheDocument();
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

  it('filters to one manager and opens their group', async () => {
    const user = userEvent.setup();
    renderView();

    await screen.findByText('Showing 25 of 27');
    await user.selectOptions(screen.getByLabelText('Partner manager'), 'pm-2');

    expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument();
    expect(screen.queryByText('Showing 25 of 27')).not.toBeInTheDocument();
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

  it('reports a failed load and retries it', async () => {
    const user = userEvent.setup();
    const provider = new MockDataProvider(makeBook());
    const spy = vi
      .spyOn(provider, 'getForecastSummary')
      .mockRejectedValueOnce(new Error('getForecastSummary failed in transit (simulated)'));

    renderView({ provider });

    expect(await screen.findByText('The forecast did not load')).toBeInTheDocument();
    expect(
      screen.getByText('getForecastSummary failed in transit (simulated)'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Showing 25 of 27')).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('keeps the figures on screen when a refresh fails', async () => {
    const { provider, commitEdit } = renderView();
    await screen.findByText('Showing 25 of 27');

    vi.spyOn(provider, 'getForecastSummary').mockRejectedValueOnce(new Error('flaky wire'));
    commitEdit({ ...EMPTY_EDITS, revenueOverrides: { 'opp-a0': 1 } });

    expect(await screen.findByText('Latest refresh failed:')).toBeInTheDocument();
    expect(screen.getByText('flaky wire')).toBeInTheDocument();
    // Stale beats blank: the tiles are still there to be read, and the row
    // being edited still shows the manager's figure.
    expect(screen.getByText('Average deal size')).toBeInTheDocument();
    expect(screen.getByText('$1')).toBeInTheDocument();
  });
});
