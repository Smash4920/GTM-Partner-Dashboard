import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PartnerView from './PartnerView';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { createSimulatedRemoteProvider } from '../data/mock/createSimulatedRemoteProvider';
import type { DataProvider } from '../data/DataProvider';
import { NO_SESSION_EDITS } from '../data/sessionEdits';
import {
  makeCertification,
  makeOpportunity,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTarget,
} from '../test/fixtures';
import type { ProviderBook } from '../data/mock/book';

/**
 * The Partner View over the scoped contract. These are the same behavioral
 * pins the folded-book version carried — the picker's limitation copy, the
 * coverage and certification states, the isolation boundary — plus the
 * route's new per-widget resilience. Every render goes through a real
 * MockDataProvider, so what the view shows is what the seam answered.
 */

function renderView(provider: DataProvider) {
  return render(<PartnerView provider={provider} edits={NO_SESSION_EDITS} prospects={[]} />);
}

function mockProvider(book: Partial<ProviderBook> = {}): DataProvider {
  return new MockDataProvider(makeProviderBook(book));
}

describe('PartnerView picker limitation (VAL-GOV-008)', () => {
  it('labels the picker as an untrusted demo selector, not authorization', async () => {
    renderView(mockProvider());

    // The picker stays unchanged; the visible copy states its boundary.
    await screen.findByText(/Demo selector/);
    expect(screen.getByText(/client filtering is not authorization/i)).toBeInTheDocument();
    expect(screen.getByText(/trusted sign-in and server-enforced row access/i)).toBeInTheDocument();
    expect(screen.queryByText(/scoped by partner SSO/i)).not.toBeInTheDocument();
  });
});

describe('PartnerView coverage states (VAL-DATA-002)', () => {
  /** The open-pipeline KPI tile, whose sub carries the coverage state. */
  async function pipelineTile(): Promise<HTMLElement> {
    const label = await screen.findByText('Open pipeline');
    const tile = label.closest('div');
    if (!tile) throw new Error('pipeline tile not found');
    return tile;
  }

  it('shows a finite coverage ratio while the target is open', async () => {
    // 250k open in Q3 against the partner's 500k Q3 target.
    renderView(mockProvider());

    expect(within(await pipelineTile()).getByText('1 open · 0.5x coverage')).toBeInTheDocument();
  });

  it('shows target met once closed-won reaches the target, never a ratio over a zero gap', async () => {
    renderView(
      mockProvider({
        opportunities: [
          makeOpportunity({
            id: 'opp-won',
            outcome: 'won',
            forecastedRevenue: 600_000,
            createdAt: '2026-08-01T00:00:00.000Z',
            expectedCloseDate: '2026-09-01T00:00:00.000Z',
            closedAt: '2026-09-01T00:00:00.000Z',
          }),
        ],
        targets: [makeTarget({ revenueTarget: 500_000 })],
      }),
    );

    const tile = await pipelineTile();
    expect(within(tile).getByText('0 open · target met')).toBeInTheDocument();
    expect(within(tile).queryByText(/coverage$/)).not.toBeInTheDocument();
  });

  it('shows no target when the partner has no target rows, never target met', async () => {
    renderView(mockProvider({ targets: [] }));

    const tile = await pipelineTile();
    expect(within(tile).getByText('1 open · no target')).toBeInTheDocument();
    expect(within(tile).queryByText(/target met/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/∞|NaN/)).not.toBeInTheDocument();
  });
});

describe('PartnerView certification attainment', () => {
  it('shows attainment against a real goal', async () => {
    renderView(
      mockProvider({
        certifications: [
          makeCertification({
            partnerStrategistsCertified: 1,
            partnerStrategistsGoal: 4,
            partnerEngineersCertified: 3,
            partnerEngineersGoal: 4,
          }),
        ],
      }),
    );
    expect(await screen.findByText('1/4')).toBeInTheDocument();
    expect(screen.getByText('25% of goal')).toBeInTheDocument();
    expect(screen.getByText('3/4')).toBeInTheDocument();
    expect(screen.getByText('75% of goal')).toBeInTheDocument();
  });

  // Regression: a zero goal is a real state in an enablement system, and the
  // unguarded division reached Intl.NumberFormat as Infinity, rendering
  // "∞% of goal" to a partner.
  it('does not divide by a zero goal', async () => {
    renderView(
      mockProvider({
        certifications: [
          makeCertification({
            partnerStrategistsCertified: 0,
            partnerStrategistsGoal: 0,
            partnerEngineersCertified: 2,
            partnerEngineersGoal: 0,
          }),
        ],
      }),
    );

    await waitFor(() => expect(screen.getAllByText('No goal set')).toHaveLength(2));
    expect(screen.queryByText(/∞/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it('says so when the partner has no certification record at all', async () => {
    renderView(mockProvider({ certifications: [] }));
    await waitFor(() => expect(screen.getAllByText('No certification data')).toHaveLength(2));
  });
});

describe('PartnerView partner isolation (VAL-DATA-003, VAL-CROSS-004)', () => {
  /**
   * The view renders one partner's slice of a two-partner book. The picker is
   * an untrusted demo selector (VAL-GOV-008), so its options legitimately
   * name every partner; what must never render is another partner's data —
   * their deals, accounts, or certification standing — nor the viewer's own
   * Sell To deals, which are internal revenue, not the partner's pipeline.
   * partner-1 holds the larger portal-visible win so the default pick is
   * deterministic.
   */
  function isolationBook(): ProviderBook {
    return makeProviderBook({
      partners: [
        makePartner({ id: 'partner-1', name: 'Northwind Systems' }),
        makePartner({ id: 'partner-2', name: 'Contoso Partners', partnerManagerId: 'pm-2' }),
      ],
      partnerManagers: [
        { id: 'pm-1', name: 'J. Alvarez' },
        { id: 'pm-2', name: 'R. Diaz' },
      ],
      opportunities: [
        makeOpportunity({
          id: 'opp-p1-win',
          outcome: 'won',
          forecastedRevenue: 200_000,
          createdAt: '2026-08-01T00:00:00.000Z',
          expectedCloseDate: '2026-09-01T00:00:00.000Z',
          closedAt: '2026-09-01T00:00:00.000Z',
        }),
        makeOpportunity({ id: 'opp-mine', accountName: 'Acme Freight' }),
        makeOpportunity({
          id: 'opp-sell-to',
          accountName: 'Northwind Internal Sell',
          oppType: 'sell-to',
          forecastedRevenue: 900_000,
        }),
        makeOpportunity({
          id: 'opp-theirs',
          partnerId: 'partner-2',
          accountName: 'Contoso Exclusive Account',
          forecastedRevenue: 40_000,
        }),
      ],
      registrations: [
        makeRegistration({ id: 'reg-mine', accountName: 'Acme Freight' }),
        makeRegistration({
          id: 'reg-theirs',
          partnerId: 'partner-2',
          accountName: 'Contoso Exclusive Account',
        }),
      ],
      certifications: [
        makeCertification({ partnerId: 'partner-1' }),
        makeCertification({
          partnerId: 'partner-2',
          partnerStrategistsCertified: 9,
          partnerStrategistsGoal: 9,
        }),
      ],
    });
  }

  it('never renders another partner’s rows or the partner’s own Sell To deals', async () => {
    renderView(mockProvider(isolationBook()));

    // Default selection is the portal-visible leader, partner-1; their deal renders.
    expect((await screen.findAllByText('Acme Freight')).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Northwind Systems' })).toBeInTheDocument();
    // The other partner's account never leaves the picker's option list.
    expect(screen.queryByText('Contoso Exclusive Account')).not.toBeInTheDocument();
    // A Sell To deal on the selected partner is internal revenue: hidden here,
    // and unable to crown the default pick even at 900k.
    expect(screen.queryByText('Northwind Internal Sell')).not.toBeInTheDocument();
    // The other partner's certification standing (9/9) never shows.
    expect(screen.queryByText('9/9')).not.toBeInTheDocument();
  });

  it('re-scopes every card when the picker moves to the other partner', async () => {
    const user = userEvent.setup();
    renderView(mockProvider(isolationBook()));

    await screen.findByRole('heading', { name: 'Northwind Systems' });
    await user.selectOptions(screen.getByLabelText(/viewing as/i), ['partner-2']);

    await screen.findByRole('heading', { name: 'Contoso Partners' });
    // partner-2's own deal renders; everything of partner-1's is gone,
    // including the account the two registrations share a name with.
    expect(screen.getAllByText('Contoso Exclusive Account').length).toBeGreaterThan(0);
    expect(screen.queryByText('Acme Freight')).not.toBeInTheDocument();
    expect(screen.queryByText('Northwind Internal Sell')).not.toBeInTheDocument();
    // partner-2's certification standing is theirs now.
    expect(screen.getByText('9/9')).toBeInTheDocument();
  });
});

describe('PartnerView per-widget resilience (VAL-CROSS-004)', () => {
  it('fails one card on one rejected call and retries only that call', async () => {
    const provider = createSimulatedRemoteProvider(mockProvider(), {
      latencyMs: 0,
      failMethods: { getStageBreakdown: 1 },
    });
    renderView(provider);

    // The stage card names its failure; its siblings are untouched.
    await screen.findByText(/Pipeline by stage unavailable/);
    expect(screen.getByText('Open pipeline')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Deal registrations/ })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry pipeline by stage' }));

    // Recovery: the bars render, and focus lands on the card's named region
    // rather than dropping to the document body.
    await waitFor(() =>
      expect(screen.queryByText(/Pipeline by stage unavailable/)).not.toBeInTheDocument(),
    );
    await waitFor(() => {
      const region = screen.getByRole('group', { name: 'pipeline by stage' });
      expect(region).toHaveFocus();
    });
  });

  it('reports a picker-side failure as the partner list, with its own retry', async () => {
    const provider = createSimulatedRemoteProvider(mockProvider(), {
      latencyMs: 0,
      failMethods: { getPartnerRoster: 1 },
    });
    renderView(provider);

    await screen.findByText(/The partner list unavailable/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry The partner list' }));
    await screen.findByRole('heading', { name: 'Northwind Systems' });
  });

  it('a failed partner ranking opens the first roster partner and retries only the ranking', async () => {
    // The regression this pins: the picker used to gate on the ranking query,
    // so a ranking-only failure blanked the whole route even though the
    // roster had answered and its first partner could open the portal. The
    // roster leads with partner-1 while partner-2 tops the portal-visible
    // leaderboard, so the fallback and the recovered default are distinct.
    const user = userEvent.setup();
    const inner = mockProvider({
      partners: [
        makePartner({ id: 'partner-1', name: 'Northwind Systems' }),
        makePartner({ id: 'partner-2', name: 'Contoso Partners', partnerManagerId: 'pm-2' }),
      ],
      partnerManagers: [
        { id: 'pm-1', name: 'J. Alvarez' },
        { id: 'pm-2', name: 'R. Diaz' },
      ],
      opportunities: [
        makeOpportunity({ id: 'opp-p1-open', partnerId: 'partner-1', accountName: 'Acme Freight' }),
        makeOpportunity({
          id: 'opp-p2-win',
          partnerId: 'partner-2',
          accountName: 'Contoso Win',
          outcome: 'won',
          forecastedRevenue: 300_000,
          createdAt: '2026-08-01T00:00:00.000Z',
          expectedCloseDate: '2026-09-01T00:00:00.000Z',
          closedAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
    });
    const rosterSpy = vi.spyOn(inner, 'getPartnerRoster');
    const rankingSpy = vi.spyOn(inner, 'getTopPartnerLeaders');
    renderView(
      createSimulatedRemoteProvider(inner, {
        latencyMs: 0,
        failMethods: { getTopPartnerLeaders: 1 },
      }),
    );

    // The portal did not blank: it opened on the roster's first partner, with
    // the picker and the partner's own cards live.
    await screen.findByRole('heading', { name: 'Northwind Systems', level: 1 });
    expect(screen.getByLabelText(/viewing as/i)).toBeEnabled();
    expect(await screen.findByText('Open pipeline')).toBeInTheDocument();

    // The ranking failure is named with stable copy; the raw rejection prose
    // never renders.
    const region = await screen.findByRole('group', { name: 'partner ranking' });
    expect(within(region).getByText('Partner ranking unavailable:')).toBeInTheDocument();
    expect(within(region).getByText('Failed to rank the partners')).toBeInTheDocument();
    expect(screen.queryByText(/failed in transit/)).not.toBeInTheDocument();

    // The planned failure never reached the inner provider, so the retry's
    // ranking call is the inner provider's first — and the roster, which
    // already answered, is not re-asked.
    expect(rankingSpy).not.toHaveBeenCalled();
    const rosterCalls = rosterSpy.mock.calls.length;
    await user.click(within(region).getByRole('button', { name: 'Retry partner ranking' }));

    // Recovery applies the intended default — the portal switches to the
    // portal-visible leader — and focus lands on the ranking's named region.
    await screen.findByRole('heading', { name: 'Contoso Partners', level: 1 });
    expect(rankingSpy).toHaveBeenCalledTimes(1);
    expect(rosterSpy.mock.calls.length).toBe(rosterCalls);
    expect(within(region).queryByText(/Partner ranking unavailable/)).not.toBeInTheDocument();
    expect(region).toHaveFocus();
  });
});
