import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ForecastingView from '../views/ForecastingView';
import { MockDataProvider } from './mock/MockDataProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { SessionEdits } from './sessionEdits';
import { makeOpportunity, makePartner, makeProviderBook, makeTarget } from '../test/fixtures';

/**
 * VAL-RES-007: edit invalidation is narrow.
 *
 * The exact provider-call matrix per edit type, asserted against the real
 * view wiring with every provider method spied:
 *
 * - revenue edit → summary, weighted forecast, quality, groups, weekly
 *   series, and the loaded book windows refetch; the directory does not;
 * - forecast-call edit → weighted forecast, quality, weekly series, and the
 *   loaded book windows refetch; the summary, groups, and directory do not;
 * - note and next-step edits → no query at all: the rows render the session's
 *   value over the provider's, and no aggregate reads either field;
 * - presentation-only changes — a rebuilt-but-equal edits object, the manager
 *   filter, collapsing and reopening a group — issue no query and discard no
 *   loaded pages.
 */

/** 27 deals for pm-1 (so two pages exist) and one for pm-2. */
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

describe('VAL-RES-007 edit invalidation is narrow', () => {
  // Drives a full Forecasting render per edit type; under coverage
  // instrumentation that clears the default 5s timeout, so this test carries
  // its own budget.
  it(
    'each edit type refetches exactly its dependent queries, and presentation changes none',
    {
      timeout: 20_000,
    },
    async () => {
      const user = userEvent.setup();
      const provider = new MockDataProvider(makeBook());
      const spies = {
        summary: vi.spyOn(provider, 'getForecastSummary'),
        weighted: vi.spyOn(provider, 'getWeightedForecast'),
        quality: vi.spyOn(provider, 'getForecastQuality'),
        groups: vi.spyOn(provider, 'getManagerForecastGroups'),
        weeks: vi.spyOn(provider, 'getWeeklyForecastSeries'),
        book: vi.spyOn(provider, 'listQuarterOpportunities'),
        directory: vi.spyOn(provider, 'getPartnerDirectory'),
      };
      const counts = () => ({
        summary: spies.summary.mock.calls.length,
        weighted: spies.weighted.mock.calls.length,
        quality: spies.quality.mock.calls.length,
        groups: spies.groups.mock.calls.length,
        weeks: spies.weeks.mock.calls.length,
        book: spies.book.mock.calls.length,
        directory: spies.directory.mock.calls.length,
      });

      let edits: SessionEdits = NO_SESSION_EDITS;
      const view = () => (
        <ForecastingView
          provider={provider}
          edits={edits}
          onSetRevenue={vi.fn()}
          onSetNote={vi.fn()}
          onSetNextStep={vi.fn()}
          onSetForecastCall={vi.fn()}
        />
      );
      const utils = render(view());
      const commit = (next: SessionEdits) => {
        edits = next;
        utils.rerender(view());
      };

      // Baseline: every widget loads once, and the default-expanded manager's
      // first page loads once.
      expect(await screen.findByText('Showing 25 of 27')).toBeInTheDocument();
      expect(counts()).toEqual({
        summary: 1,
        weighted: 1,
        quality: 1,
        groups: 1,
        weeks: 1,
        book: 1,
        directory: 1,
      });

      // Load page two so the tests below can prove the pages survive edits.
      await user.click(screen.getByRole('button', { name: 'Load 25 more' }));
      expect(await screen.findByText('Showing 27 of 27')).toBeInTheDocument();
      expect(counts().book).toBe(2);

      // A note edit: no query. The row exposes the session's note immediately
      // through its disclosure — reading it needs no refetch.
      commit({ ...edits, notes: { 'opp-a0': 'Called the CFO' } });
      await user.click(await screen.findByRole('button', { name: 'View note for Acme 0' }));
      expect(screen.getByText('Called the CFO')).toBeInTheDocument();
      expect(counts()).toEqual({
        summary: 1,
        weighted: 1,
        quality: 1,
        groups: 1,
        weeks: 1,
        book: 2,
        directory: 1,
      });

      // A next-step edit: no query either; the row renders the overlay.
      commit({ ...edits, nextSteps: { 'opp-a1': 'Review the contract' } });
      expect(await screen.findByText('Review the contract')).toBeInTheDocument();
      expect(counts()).toEqual({
        summary: 1,
        weighted: 1,
        quality: 1,
        groups: 1,
        weeks: 1,
        book: 2,
        directory: 1,
      });

      // A revenue edit: every aggregate and the loaded book window refetch.
      commit({ ...edits, revenueOverrides: { 'opp-a0': 5_000_000 } });
      await waitFor(() => expect(counts().summary).toBe(2));
      expect(counts()).toEqual({
        summary: 2,
        weighted: 2,
        quality: 2,
        groups: 2,
        weeks: 2,
        book: 3,
        directory: 1,
      });
      // The book refetched the loaded window — both pages in one request, no
      // cursor — and the rows stayed on screen throughout.
      expect(spies.book.mock.calls[2]?.[1]).toEqual({ limit: 27 });
      expect(screen.getByText('Showing 27 of 27')).toBeInTheDocument();

      // A forecast-call edit: the weighted forecast, quality, series, and book
      // window refetch; the summary and groups a re-call cannot move do not.
      commit({ ...edits, forecastCalls: { 'opp-a0': 'commit' } });
      await waitFor(() => expect(counts().quality).toBe(3));
      // The mismatch the re-call created renders once the quality refresh lands.
      await screen.findByText(
        '1 of 28 open Q3 deals are called off the category their stage implies',
      );
      expect(counts()).toEqual({
        summary: 2,
        weighted: 3,
        quality: 3,
        groups: 2,
        weeks: 3,
        book: 4,
        directory: 1,
      });
      expect(spies.book.mock.calls[3]?.[1]).toEqual({ limit: 27 });
      expect(screen.getByText('Showing 27 of 27')).toBeInTheDocument();

      // A rebuilt-but-equal edits object is a presentation-level no-op.
      commit({
        revenueOverrides: { ...edits.revenueOverrides },
        notes: { ...edits.notes },
        nextSteps: { ...edits.nextSteps },
        forecastCalls: { ...edits.forecastCalls },
      });
      const before = counts();
      await screen.findByText('Showing 27 of 27');
      expect(counts()).toEqual(before);

      // The manager filter hides and restores groups without any query, and
      // the hidden book keeps its loaded pages.
      await user.selectOptions(screen.getByLabelText('Partner manager'), 'pm-2');
      expect(await screen.findByText('Showing 1 of 1')).toBeInTheDocument();
      // pm-2's first page is a legitimately new question, not a refetch.
      expect(counts()).toEqual({ ...before, book: before.book + 1 });
      await user.selectOptions(screen.getByLabelText('Partner manager'), 'all');
      expect(screen.getByText('Showing 27 of 27')).toBeVisible();
      expect(counts()).toEqual({ ...before, book: before.book + 1 });

      // Collapsing and reopening a group is presentation-only too: no query,
      // and the loaded pages are still there.
      const groupToggle = screen.getByRole('button', { name: /J\. Alvarez/ });
      await user.click(groupToggle);
      expect(screen.getByText('Showing 27 of 27')).not.toBeVisible();
      await user.click(groupToggle);
      expect(screen.getByText('Showing 27 of 27')).toBeVisible();
      expect(counts()).toEqual({ ...before, book: before.book + 1 });
    },
  );
});
