import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PartnerView from './PartnerView';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { SimulatedRemoteProvider } from '../data/mock/SimulatedRemoteProvider';
import type { DataProvider } from '../data/DataProvider';
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
  return render(<PartnerView provider={provider} prospects={[]} />);
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
    const provider = new SimulatedRemoteProvider(mockProvider(), {
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
    const provider = new SimulatedRemoteProvider(mockProvider(), {
      latencyMs: 0,
      failMethods: { getPartnerRoster: 1 },
    });
    renderView(provider);

    await screen.findByText(/The partner list unavailable/);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry The partner list' }));
    await screen.findByRole('heading', { name: 'Northwind Systems' });
  });
});
