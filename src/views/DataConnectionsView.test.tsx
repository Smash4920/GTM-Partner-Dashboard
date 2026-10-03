import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataConnectionsView from './DataConnectionsView';
import {
  CONNECTION_EDGES,
  CONNECTION_METHOD_COVERAGE,
  CONNECTION_NODES,
} from '../data/connections';

/**
 * DataConnectionsView is the static integration map: the KPI totals and the
 * node detail panel come from the connection catalog, so the view takes no
 * provider and never loads business facts. This suite pins the catalog
 * arithmetic and the node detail's truthful blockers.
 */

// Totals the tiles derive from the catalog, read from the catalog itself so
// the expectations move with it.
const REQUIRED_NODES = CONNECTION_NODES.filter((node) => node.status === 'required').length;
const LIVE_NODES = CONNECTION_NODES.filter((node) => node.status === 'live').length;
const REQUIRED_EDGES = CONNECTION_EDGES.filter((edge) => edge.status === 'required').length;
const COVERED_METHODS = new Set(
  CONNECTION_NODES.flatMap((node) => node.methods).filter((method) =>
    CONNECTION_METHOD_COVERAGE.includes(method),
  ),
).size;

/** Scopes assertions to one KPI tile by its label. */
function tile(label: string) {
  const root = screen.getByText(label).parentElement;
  if (!root) throw new Error(`no KPI tile rooted at "${label}"`);
  return within(root);
}

/** Node labels carry parentheses and dots, so escape before anchoring. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Capture the stable map once for this mount, never across test cases. */
function connectionMapQueries() {
  const map = within(screen.getByRole('group', { name: 'Data connection map' }));
  const nodeButton = (label: string) =>
    map.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}`) });
  return { map, nodeButton };
}

describe('DataConnectionsView', () => {
  it('renders the catalog totals from the static map with no provider', () => {
    // The view takes no props: rendering it is the proof it never waits on a
    // provider for the catalog.
    render(<DataConnectionsView />);

    expect(screen.getByRole('heading', { level: 1, name: 'Data Connections' })).toBeInTheDocument();
    expect(
      screen.getByText(/identity, server row enforcement, source freshness, the warehouse/),
    ).toBeInTheDocument();

    expect(tile('Connections required').getByText(String(REQUIRED_NODES))).toBeInTheDocument();
    expect(
      tile('Connections required').getByText(
        `of ${CONNECTION_NODES.length} systems mapped · ${LIVE_NODES} live on mock data`,
      ),
    ).toBeInTheDocument();
    expect(
      tile('Provider methods wired').getByText(
        `${COVERED_METHODS}/${CONNECTION_METHOD_COVERAGE.length}`,
      ),
    ).toBeInTheDocument();
    expect(
      tile('Provider methods wired').getByText('every DataProvider method has a wire'),
    ).toBeInTheDocument();
    expect(tile('Flows planned').getByText(String(CONNECTION_EDGES.length))).toBeInTheDocument();
    expect(
      tile('Flows planned').getByText(`${REQUIRED_EDGES} required to go live`),
    ).toBeInTheDocument();

    const { map } = connectionMapQueries();
    expect(map.getByRole('button', { name: /^CRM/ })).toBeInTheDocument();
    expect(map.getByRole('button', { name: /^Notification service/ })).toBeInTheDocument();
  });

  it('opens on the notification node, listing its supplies, wires, and blocker', () => {
    render(<DataConnectionsView />);

    expect(
      screen.getByRole('heading', { level: 3, name: 'Notification service' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Deal-registration SLA warnings and breaches')).toBeInTheDocument();
    expect(screen.getByText('Hand-sent notes about a record')).toBeInTheDocument();
    expect(screen.getByText('sendNotification()')).toBeInTheDocument();
    expect(
      screen.getByText('Slack app for direct messages, transactional email provider'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Bot token with chat:write; email through the transactional provider'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Event-driven, evaluated when the alert rule fires'),
    ).toBeInTheDocument();

    // A required node is blocked, not limited, so the heading says what is missing.
    expect(screen.getByText('What is missing')).toBeInTheDocument();
    expect(screen.getByText('Architecture roadmap')).toBeInTheDocument();

    expect(
      screen.getByText(
        'The alert rule rides on data that is only trustworthy once the registration sync and the roster are real.',
      ),
    ).toBeInTheDocument();
  });

  it('re-renders the detail panel for another node, naming the demo limit on a live one', async () => {
    const user = userEvent.setup({ delay: null });
    render(<DataConnectionsView />);
    const { nodeButton } = connectionMapQueries();

    await user.click(nodeButton('Canonical data model'));
    expect(
      screen.getByRole('heading', { level: 3, name: 'Canonical data model' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Limit of the demo')).toBeInTheDocument();
    expect(screen.queryByText('What is missing')).not.toBeInTheDocument();
    expect(screen.getByText('MockDataProvider — this demo')).toBeInTheDocument();
    expect(
      screen.getByText('Normalized tables behind the DataProvider interface'),
    ).toBeInTheDocument();
    // Canonical has no auth row; only the fields a node declares are drawn.
    expect(screen.queryByText('Auth')).not.toBeInTheDocument();
    // Both wires on the box, including the one that carries history.
    expect(
      screen.getByText(
        'History joins the canonical model rather than the live book: snapshots are append-only and never corrected.',
      ),
    ).toBeInTheDocument();

    // A node with no DataProvider methods draws no method chips at all.
    await user.click(nodeButton('Ingest & sync'));
    expect(screen.getByRole('heading', { level: 3, name: 'Ingest & sync' })).toBeInTheDocument();
    expect(screen.queryByText('Provider methods')).not.toBeInTheDocument();

    await user.click(nodeButton('HubSpot (alternate CRM)'));
    expect(screen.getByText('Product roadmap')).toBeInTheDocument();
  });

  it('renders identity and notification nodes unconnected with truthful blockers (VAL-GOV-004)', async () => {
    const user = userEvent.setup({ delay: null });
    render(<DataConnectionsView />);
    const { nodeButton } = connectionMapQueries();

    // The intro names the demo boundary up front.
    expect(
      screen.getByText(/Only in-process\s+mock\/provider behavior runs in this demo/),
    ).toBeInTheDocument();

    await user.click(nodeButton('Identity provider (SSO)'));
    expect(screen.getByText('What is missing')).toBeInTheDocument();
    expect(screen.getByText(/current-session notification-routing simulation/)).toBeInTheDocument();
    expect(
      screen.getByText(/never provision, authorize, revoke, or restore sign-in or data access/),
    ).toBeInTheDocument();

    await user.click(nodeButton('Notification service'));
    expect(
      screen.getByText(/simulated, local-only session records and are never delivered/),
    ).toBeInTheDocument();

    // The only live boxes are the in-process ones, and they own the limit.
    await user.click(nodeButton('Dashboard API & UI'));
    expect(screen.getByText('Limit of the demo')).toBeInTheDocument();
    // The summary renders on the node card and again in the detail panel.
    expect(screen.getAllByText(/Row authorization is not a client concern/).length).toBeGreaterThan(
      0,
    );

    await user.click(nodeButton('Canonical data model'));
    expect(screen.getByText('Limit of the demo')).toBeInTheDocument();
  });
});
