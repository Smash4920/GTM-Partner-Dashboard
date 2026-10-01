import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DealRegistrationOpsView from './DealRegistrationOpsView';
import { REGISTRATION_SLA_BUSINESS_DAYS } from '../data/constants';
import type { DataProvider } from '../data/DataProvider';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { SimulatedRemoteProvider } from '../data/mock/SimulatedRemoteProvider';
import { makePartner, makeProviderBook, makeRegistration } from '../test/fixtures';
import type { DealRegistration } from '../data/types';
import type { ProviderBook } from '../data/mock/book';

/**
 * Deal Registration Ops over the scoped contract (VAL-DATA-015): the tiles,
 * conversion chart, and three tables answer from provider queries with their
 * own loading, error, retry, metadata, and pagination. The VAL-DATA-007 SLA
 * presentation pins stay: the breach boundary is inclusive — a pending
 * registration that has waited exactly REGISTRATION_SLA_BUSINESS_DAYS
 * business days is past the SLA — and the tile copy must describe that
 * boundary rather than a strict ">" reading.
 *
 * Dates pin to the fixed snapshot (Friday 2026-09-18): Sunday 2026-09-13 is
 * exactly five business days back (Mon–Fri), Thursday 2026-09-17 is one. The
 * books are hand-built so an assertion fails because the view broke, not
 * because a seeded volume moved.
 */

const PARTNERS = [
  makePartner({ id: 'partner-1', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
  makePartner({ id: 'partner-2', name: 'Beacon Consulting', partnerManagerId: 'pm-1' }),
];

function makeBook(registrations: DealRegistration[]): ProviderBook {
  return makeProviderBook({
    partners: PARTNERS,
    registrations,
    activities: [],
    opportunities: [],
    targets: [],
    certifications: [],
  });
}

/** The two registrations the SLA boundary tests are built around. */
function boundaryBook(): ProviderBook {
  return makeBook([
    // At the boundary exactly: five business days awaiting review.
    makeRegistration({
      id: 'reg-at-boundary',
      partnerId: 'partner-1',
      submittedAt: '2026-09-13T00:00:00.000Z',
      status: 'pending',
    }),
    // Still inside the SLA: one business day awaiting review.
    makeRegistration({
      id: 'reg-inside',
      partnerId: 'partner-2',
      submittedAt: '2026-09-17T00:00:00.000Z',
      status: 'pending',
    }),
  ]);
}

function renderView(provider: DataProvider = new MockDataProvider(boundaryBook())) {
  render(<DealRegistrationOpsView provider={provider} prospects={[]} />);
}

/** The KPI tile whose label matches, so neighboring tiles cannot leak in. */
function tileWith(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('div');
  if (!tile) throw new Error(`tile not found: ${label}`);
  return tile;
}

/** The card whose <h2> carries this title, so queries cannot leak across panels. */
function cardWith(title: string): HTMLElement {
  const heading = screen.getByRole('heading', { name: title });
  return heading.closest('section') as HTMLElement;
}

describe('DealRegistrationOpsView', () => {
  it('counts an exactly-five-business-day pending registration as past SLA (VAL-DATA-007)', async () => {
    renderView();

    // Only the boundary registration counts: the boundary is inclusive.
    await screen.findByText('Pending past SLA');
    const tile = tileWith('Pending past SLA');
    expect(tile).toHaveTextContent('1');
    // The copy describes the same inclusive boundary the counter uses.
    expect(tile).toHaveTextContent(
      `${REGISTRATION_SLA_BUSINESS_DAYS}+ business days awaiting review`,
    );
    expect(screen.queryByText(/> \d+ business days awaiting review/)).not.toBeInTheDocument();
  });

  it('states the response SLA in business days and exclusivity in calendar days', async () => {
    renderView();

    await screen.findByText('Pending past SLA');
    expect(
      screen.getAllByText(`avg business days · ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/24\s*(h|hours)/i)).not.toBeInTheDocument();
  });

  it('answers every card from its own scoped query, with metadata on screen', async () => {
    renderView();

    await screen.findByText('Pending past SLA');
    // The queue card's subtitle reports the collection's total, not the page.
    expect(
      within(cardWith('Registrations awaiting review')).getByText(
        /2 pending · day counter is green/,
      ),
    ).toBeInTheDocument();
    // Both pending rows render, resolved through the roster to partner names.
    const queue = cardWith('Registrations awaiting review');
    expect(within(queue).getByText('Northwind Systems')).toBeInTheDocument();
    expect(within(queue).getByText('Beacon Consulting')).toBeInTheDocument();
    // Each settled query carries its own as-of/provider/completeness caption.
    expect(within(queue).getAllByText(/^As of /).length).toBeGreaterThan(0);
    expect(
      within(cardWith('Exclusivity window')).getByText(/still without an opportunity/),
    ).toBeInTheDocument();
    expect(
      within(cardWith('Duplicate & conflicting registrations')).getByText(
        /registered by more than one partner/,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the tiles standing when the review queue fails, and retries only it', async () => {
    const user = userEvent.setup();
    renderView(
      new SimulatedRemoteProvider(new MockDataProvider(boundaryBook()), {
        latencyMs: 0,
        failMethods: { listPendingRegistrations: 1 },
      }),
    );

    // The queue alone is unavailable; the ops aggregate and the other tables
    // answered.
    const queue = cardWith('Registrations awaiting review');
    await within(queue).findByText(/Review queue unavailable/);
    expect(within(queue).getByText('Failed to load the review queue')).toBeInTheDocument();
    expect(screen.getByText('Pending past SLA')).toBeInTheDocument();
    expect(
      within(cardWith('Exclusivity window')).getByText(/still without an opportunity/),
    ).toBeInTheDocument();

    await user.click(within(queue).getByRole('button', { name: 'Retry review queue' }));

    // The retry repeated the failed page: the rows and the SLA footer land.
    await within(queue).findByText('Northwind Systems');
    expect(within(queue).queryByText(/Review queue unavailable/)).not.toBeInTheDocument();
    expect(
      within(queue).getByText(/1 of 2 pending registrations are already past the response SLA/),
    ).toBeInTheDocument();
  });

  it('keeps the cards interactive with id fallback when the roster fails, and retries only the roster', async () => {
    // The regression this pins: the roster query's error used to be discarded
    // into `?? []` — the tables silently degraded to raw ids with no named
    // failure and no way to recover the roster on its own.
    const user = userEvent.setup();
    const inner = new MockDataProvider(boundaryBook());
    const rosterSpy = vi.spyOn(inner, 'getPartnerRoster');
    const opsSpy = vi.spyOn(inner, 'getRegistrationOpsSummary');
    const queueSpy = vi.spyOn(inner, 'listPendingRegistrations');
    renderView(
      new SimulatedRemoteProvider(inner, {
        latencyMs: 0,
        failMethods: { getPartnerRoster: 1 },
      }),
    );

    // The cards stay up: the queue rows render with the explicit partner-id
    // fallback and the ops aggregate answers right through the roster failure.
    const queue = cardWith('Registrations awaiting review');
    await within(queue).findByText('partner-1');
    expect(within(queue).getByText('partner-2')).toBeInTheDocument();
    expect(within(queue).getByText(/1 of 2 pending registrations/)).toBeInTheDocument();

    // The roster's own named failure surface.
    const region = await screen.findByRole('group', { name: 'partner roster' });
    expect(
      within(region).getByText('Partner names unavailable — showing partner ids:'),
    ).toBeInTheDocument();
    expect(within(region).getByText('Failed to load the partner roster')).toBeInTheDocument();

    // The retry repeats only the roster method: the planned failure never
    // reached the inner provider, so the first inner roster call is the
    // retry's, and the siblings are not re-asked.
    const opsCalls = opsSpy.mock.calls.length;
    const queueCalls = queueSpy.mock.calls.length;
    expect(rosterSpy).not.toHaveBeenCalled();
    await user.click(within(region).getByRole('button', { name: 'Retry partner roster' }));

    await within(queue).findByText('Northwind Systems');
    expect(rosterSpy).toHaveBeenCalledTimes(1);
    expect(opsSpy.mock.calls.length).toBe(opsCalls);
    expect(queueSpy.mock.calls.length).toBe(queueCalls);
    expect(within(region).queryByText(/Partner names unavailable/)).not.toBeInTheDocument();
    // The successful retry lands focus on the roster's named region.
    expect(region).toHaveFocus();
  });

  it('pages the review queue a cursor at a time', async () => {
    const user = userEvent.setup();
    // Twelve pending registrations force a second ten-row page.
    const pending = Array.from({ length: 12 }, (_, index) =>
      makeRegistration({
        id: `reg-${String(index).padStart(2, '0')}`,
        partnerId: index % 2 === 0 ? 'partner-1' : 'partner-2',
        submittedAt: '2026-09-17T00:00:00.000Z',
        status: 'pending',
      }),
    );
    renderView(new MockDataProvider(makeBook(pending)));

    const queue = cardWith('Registrations awaiting review');
    await within(queue).findByText('Showing 10 of 12 pending');
    expect(within(queue).getByRole('button', { name: 'Load 10 more' })).toBeInTheDocument();

    await user.click(within(queue).getByRole('button', { name: 'Load 10 more' }));

    await within(queue).findByText('Showing 12 of 12 pending');
    expect(within(queue).queryByRole('button', { name: /Load \d+ more/ })).not.toBeInTheDocument();
    // No duplicate rows across the page boundary.
    await waitFor(() => {
      const cells = within(queue).getAllByRole('row');
      // One header row plus the twelve data rows.
      expect(cells).toHaveLength(13);
    });
  });
});
