import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DataConnectionsView from './DataConnectionsView';
import {
  CONNECTION_EDGES,
  CONNECTION_METHOD_COVERAGE,
  CONNECTION_NODES,
} from '../data/connections';
import {
  REGISTRATION_SLA_BUSINESS_DAYS,
  REGISTRATION_SLA_WARNING_BUSINESS_DAYS,
  SNAPSHOT_DATE,
} from '../data/constants';
import type {
  DashboardData,
  DashboardNotification,
  DealRegistration,
  Partner,
  TeamUser,
} from '../data/types';
import { businessDaysBefore } from '../lib/fiscal';
import { formatDate } from '../lib/format';
import { registrationSlaAlerts, type RegistrationSlaAlert } from '../lib/metrics';
import { slaAlertCopy } from '../lib/notifications';
import {
  makeDashboardData,
  makeNotification,
  makePartner,
  makeRegistration,
  makeTeamUser,
} from '../test/fixtures';

/**
 * DataConnectionsView is three connected panels, so this suite drives them
 * together: the KPI totals derived from the connection catalog, the node
 * detail panel behind the wire diagram, the SLA alert queue the rule produces,
 * and the notification composer that both the roster chips and the queue
 * re-target.
 *
 * Every alert fixture is measured in business days back from SNAPSHOT_DATE,
 * because `registrationSlaAlerts` clocks a registration against the snapshot,
 * not the wall clock — a test written against `new Date()` would pass on one
 * weekday and fail on the next.
 */

const APPROACHING_REG_ID = 'reg-approaching';
const OWNED_BREACH_REG_ID = 'reg-breached';
const ORPHAN_BREACH_REG_ID = 'reg-orphan';
const ORPHAN_PARTNER_ID = 'partner-orphan';

const OWNER_USER_ID = 'user-alvarez';
const IDLE_MANAGER_USER_ID = 'user-nakamura';
const SUSPENDED_MANAGER_USER_ID = 'user-singh';
const SUSPENDED_DEAL_DESK_USER_ID = 'user-okafor';

/** The submission day `days` business days before the snapshot, as ISO. */
function submittedBusinessDaysAgo(days: number): string {
  return businessDaysBefore(SNAPSHOT_DATE, days).toISOString();
}

const PARTNERS: Partner[] = [
  makePartner({ id: 'partner-aligned', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
  makePartner({ id: ORPHAN_PARTNER_ID, name: 'Contoso Partners', partnerManagerId: 'pm-2' }),
];

// 4 business days waiting leaves one day of slack (approaching); 7 and 6 are
// past the 5-day SLA (breached), most overdue first.
const REGISTRATIONS: DealRegistration[] = [
  makeRegistration({
    id: APPROACHING_REG_ID,
    partnerId: 'partner-aligned',
    accountName: 'Acme Freight',
    submittedAt: submittedBusinessDaysAgo(4),
  }),
  makeRegistration({
    id: OWNED_BREACH_REG_ID,
    partnerId: 'partner-aligned',
    accountName: 'Contoso Retail',
    submittedAt: submittedBusinessDaysAgo(7),
  }),
  makeRegistration({
    id: ORPHAN_BREACH_REG_ID,
    partnerId: ORPHAN_PARTNER_ID,
    accountName: 'Fabrikam Logistics',
    submittedAt: submittedBusinessDaysAgo(6),
  }),
];

// The orphan alert's aligned manager is on the roster but not authorized, and
// the deal desk that would catch an unaligned registration is suspended too —
// the roster gap the queue is meant to surface rather than hide.
const TEAM_USERS: TeamUser[] = [
  makeTeamUser({
    id: OWNER_USER_ID,
    name: 'J. Alvarez',
    email: 'j.alvarez@example.com',
    role: 'partner-manager',
    partnerManagerId: 'pm-1',
    status: 'active',
    channels: ['email', 'slack'],
  }),
  makeTeamUser({
    id: IDLE_MANAGER_USER_ID,
    name: 'R. Nakamura',
    email: 'r.nakamura@example.com',
    role: 'partner-manager',
    partnerManagerId: 'pm-3',
    status: 'active',
    channels: ['email', 'in-app'],
  }),
  makeTeamUser({
    id: SUSPENDED_MANAGER_USER_ID,
    name: 'P. Singh',
    email: 'p.singh@example.com',
    role: 'partner-manager',
    partnerManagerId: 'pm-2',
    status: 'suspended',
    channels: ['email'],
  }),
  makeTeamUser({
    id: SUSPENDED_DEAL_DESK_USER_ID,
    name: 'T. Okafor',
    email: 't.okafor@example.com',
    role: 'deal-desk-ops',
    status: 'suspended',
    channels: ['slack'],
  }),
];

const ALERTS = registrationSlaAlerts(REGISTRATIONS, PARTNERS, TEAM_USERS);

/** The rule's own output for one fixture, so expectations are the rule's copy. */
function alertFor(registrationId: string): RegistrationSlaAlert {
  const alert = ALERTS.find((candidate) => candidate.registration.id === registrationId);
  if (!alert) throw new Error(`no SLA alert for ${registrationId}`);
  return alert;
}

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

interface SetupOptions {
  data?: Partial<DashboardData>;
  notifications?: DashboardNotification[];
}

function setup(options: SetupOptions = {}) {
  const user = userEvent.setup();
  const onSendNotification = vi.fn();
  const data = makeDashboardData({
    partners: PARTNERS,
    registrations: REGISTRATIONS,
    teamUsers: TEAM_USERS,
    ...options.data,
  });

  render(
    <DataConnectionsView
      data={data}
      addedUserIds={new Set<string>()}
      notifications={options.notifications ?? []}
      onAddTeamUser={vi.fn()}
      onSetTeamUserStatus={vi.fn()}
      onRemoveTeamUser={vi.fn()}
      onSendNotification={onSendNotification}
    />,
  );

  return { user, onSendNotification };
}

/** Scopes assertions to one KPI tile by its label. */
function tile(label: string) {
  const root = screen.getByText(label).parentElement;
  if (!root) throw new Error(`no KPI tile rooted at "${label}"`);
  return within(root);
}

const connectionMap = () => within(screen.getByRole('group', { name: 'Data connection map' }));

/** Node labels carry parentheses and dots, so escape before anchoring. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const nodeButton = (label: string) =>
  connectionMap().getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}`) });

/** A teammate chip inside the notification node, matched on the first name. */
const chip = (firstName: string) =>
  connectionMap().getByRole('button', { name: new RegExp(`^${escapeRegExp(firstName)}`) });

/** The composer column, so channel labels elsewhere on the page do not collide. */
function composerRegion() {
  const label = screen.getByText('Send a notification');
  const root = label.parentElement;
  if (!root) throw new Error('no composer region');
  return within(root);
}

function queueRow(accountName: string): HTMLElement {
  const row = screen.getByText(accountName).closest('tr');
  if (!row) throw new Error(`no alert queue row for ${accountName}`);
  return row;
}

describe('DataConnectionsView', () => {
  it('derives the KPI tiles from the catalog and the live alert split', () => {
    setup();

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
    expect(tile('Flows planned').getByText(String(CONNECTION_EDGES.length))).toBeInTheDocument();
    expect(
      tile('Flows planned').getByText(`${REQUIRED_EDGES} required to go live`),
    ).toBeInTheDocument();
    // Two of the four roster entries receive notifications; the paused pair does not.
    expect(tile('Receiving notifications').getByText('2/4')).toBeInTheDocument();
    expect(
      tile('Receiving notifications').getByText(
        'roster entries routed simulated notifications this session',
      ),
    ).toBeInTheDocument();

    expect(tile('SLA alerts due').getByText('3')).toBeInTheDocument();
    expect(
      tile('SLA alerts due').getByText(
        `1 at ${REGISTRATION_SLA_WARNING_BUSINESS_DAYS * 24}h · 2 past the ${REGISTRATION_SLA_BUSINESS_DAYS}-day SLA`,
      ),
    ).toBeInTheDocument();
  });

  it('lists the alert queue and surfaces the alert whose owner is missing', () => {
    setup();

    expect(screen.getByText('1 at 24 hours')).toBeInTheDocument();
    expect(screen.getByText('2 past the SLA')).toBeInTheDocument();
    expect(screen.getByText('2 with a resolvable owner')).toBeInTheDocument();

    // The 4-business-day-old registration still has a working day left.
    expect(within(queueRow('Acme Freight')).getByText('24h to SLA')).toBeInTheDocument();
    // Two business days past a 5-day SLA.
    expect(within(queueRow('Contoso Retail')).getByText('2d past')).toBeInTheDocument();

    const orphan = queueRow('Fabrikam Logistics');
    expect(within(orphan).getByText('No owner — add one')).toBeInTheDocument();
    expect(within(orphan).getByRole('button', { name: 'Notify owner' })).toBeDisabled();

    const notifyAll = screen.getByRole('button', { name: 'Notify all 2 owners' });
    expect(notifyAll).toBeEnabled();

    expect(screen.getByText(/Nothing sent yet/)).toBeInTheDocument();
  });

  it('opens on the notification node, listing its supplies, wires, and blocker', () => {
    setup();

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
    const { user } = setup();

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
    const { user } = setup();

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

  it('opens the composer on the most urgent approaching alert that has an owner', () => {
    setup();

    const approaching = alertFor(APPROACHING_REG_ID);
    expect(screen.getByLabelText('To')).toHaveValue(OWNER_USER_ID);
    expect(screen.getByLabelText('Registration')).toHaveValue(APPROACHING_REG_ID);
    expect(screen.getByLabelText('Subject')).toHaveValue(
      'Deal reg due next business day: Acme Freight',
    );
    expect(screen.getByLabelText('Message')).toHaveValue(slaAlertCopy(approaching).body);
    expect(
      screen.getByText(
        `On the SLA clock: last business day before the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day deadline (due ${formatDate(approaching.dueAt)}).`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('j.alvarez@example.com · Partner Manager')).toBeInTheDocument();
    expect(composerRegion().getByText('Email')).toBeInTheDocument();
    expect(composerRegion().getByText('Slack')).toBeInTheDocument();
  });

  it('sends the composer draft on the owner channels with the SLA kind', async () => {
    const { user, onSendNotification } = setup();

    await user.click(screen.getByRole('button', { name: 'Send to J. Alvarez' }));

    expect(onSendNotification).toHaveBeenCalledTimes(1);
    expect(onSendNotification).toHaveBeenCalledWith({
      userId: OWNER_USER_ID,
      kind: 'registration-sla-warning',
      subject: 'Deal reg due next business day: Acme Freight',
      body: slaAlertCopy(alertFor(APPROACHING_REG_ID)).body,
      channels: ['email', 'slack'],
      registrationId: APPROACHING_REG_ID,
    });
  });

  it('keeps the alert kind when the copy is edited by hand', async () => {
    const { user, onSendNotification } = setup();

    await user.clear(screen.getByLabelText('Subject'));
    await user.type(screen.getByLabelText('Subject'), 'Quick nudge');
    await user.clear(screen.getByLabelText('Message'));
    await user.type(screen.getByLabelText('Message'), 'Please approve it today.');
    await user.click(screen.getByRole('button', { name: 'Send to J. Alvarez' }));

    // Editing the words does not change what the send is: still a warning.
    expect(onSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'registration-sla-warning',
        subject: 'Quick nudge',
        body: 'Please approve it today.',
      }),
    );
  });

  it('cannot send while the subject or body is blank', async () => {
    const { user, onSendNotification } = setup();

    await user.clear(screen.getByLabelText('Subject'));
    const send = screen.getByRole('button', { name: 'Send to J. Alvarez' });
    expect(send).toBeDisabled();
    await user.click(send);

    // Whitespace is not copy either.
    await user.type(screen.getByLabelText('Subject'), '   ');
    expect(screen.getByRole('button', { name: 'Send to J. Alvarez' })).toBeDisabled();

    await user.type(screen.getByLabelText('Subject'), 'Nudge');
    await user.clear(screen.getByLabelText('Message'));
    expect(screen.getByRole('button', { name: 'Send to J. Alvarez' })).toBeDisabled();

    expect(onSendNotification).not.toHaveBeenCalled();
  });

  it('opens an empty composer when no registration is near the SLA', () => {
    setup({ data: { registrations: [] } });

    expect(tile('SLA alerts due').getByText('0')).toBeInTheDocument();
    expect(
      tile('SLA alerts due').getByText(
        `0 at ${REGISTRATION_SLA_WARNING_BUSINESS_DAYS * 24}h · 0 past the ${REGISTRATION_SLA_BUSINESS_DAYS}-day SLA`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing near the SLA — the queue is clear.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notify all 0 owners' })).toBeDisabled();

    expect(screen.getByLabelText('To')).toHaveValue('');
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(
      screen.getByText('Pick a teammate to see the channels they receive on.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to a teammate' })).toBeDisabled();
  });

  it('says the roster is empty when there is nobody to notify', () => {
    setup({ data: { registrations: [], teamUsers: [] } });

    expect(tile('Receiving notifications').getByText('0/0')).toBeInTheDocument();
    expect(screen.getByText('Add someone to the roster first.')).toBeInTheDocument();
    expect(connectionMap().getByText('No roster yet.')).toBeInTheDocument();
  });

  it('retargets the composer from a teammate chip, blank if they own nothing', async () => {
    const { user } = setup();

    await user.click(chip('R.'));
    expect(chip('R.')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('To')).toHaveValue(IDLE_MANAGER_USER_ID);
    // No alerts owned: the pick survives but the copy is cleared.
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(composerRegion().getByText('In-app')).toBeInTheDocument();

    await user.click(chip('J.'));
    expect(screen.getByLabelText('To')).toHaveValue(OWNER_USER_ID);
    expect(screen.getByLabelText('Subject')).toHaveValue(
      'Deal reg due next business day: Acme Freight',
    );
    // The chip carries the count the node derives from the alert rule.
    expect(chip('J.')).toHaveAttribute(
      'title',
      'J. Alvarez · j.alvarez@example.com · 2 SLA alerts',
    );
  });

  it('will not notify a paused teammate', async () => {
    const { user } = setup();

    await user.click(chip('T.'));
    expect(chip('T.')).toHaveAttribute('aria-pressed', 'true');

    // A paused user is not a notifiable option: no channels, nobody to send to.
    expect(
      screen.getByText('Only a teammate with notifications on can be messaged.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to a teammate' })).toBeDisabled();
  });

  it('retargets the composer to a single alert picked from the queue', async () => {
    const { user } = setup();

    await user.click(nodeButton('Salesforce'));
    expect(screen.getByRole('heading', { level: 3, name: 'Salesforce' })).toBeInTheDocument();

    await user.click(
      within(queueRow('Contoso Retail')).getByRole('button', { name: 'Notify owner' }),
    );

    // The queue drives the map back to the node that holds the composer.
    expect(
      screen.getByRole('heading', { level: 3, name: 'Notification service' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toHaveValue(OWNER_USER_ID);
    expect(screen.getByLabelText('Registration')).toHaveValue(OWNED_BREACH_REG_ID);
    expect(screen.getByLabelText('Subject')).toHaveValue('Deal reg SLA lapsed: Contoso Retail');
    expect(screen.getByLabelText('Message')).toHaveValue(
      slaAlertCopy(alertFor(OWNED_BREACH_REG_ID)).body,
    );
  });

  it('notifies every alert that has an owner and skips the unowned one', async () => {
    const { user, onSendNotification } = setup();

    await user.click(screen.getByRole('button', { name: 'Notify all 2 owners' }));

    const approaching = slaAlertCopy(alertFor(APPROACHING_REG_ID));
    const breached = slaAlertCopy(alertFor(OWNED_BREACH_REG_ID));
    expect(onSendNotification).toHaveBeenCalledTimes(2);
    expect(onSendNotification).toHaveBeenNthCalledWith(1, {
      userId: OWNER_USER_ID,
      kind: approaching.kind,
      subject: approaching.subject,
      body: approaching.body,
      channels: ['email', 'slack'],
      registrationId: APPROACHING_REG_ID,
    });
    expect(onSendNotification).toHaveBeenNthCalledWith(2, {
      userId: OWNER_USER_ID,
      kind: breached.kind,
      subject: breached.subject,
      body: breached.body,
      channels: ['email', 'slack'],
      registrationId: OWNED_BREACH_REG_ID,
    });
    expect(onSendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ registrationId: ORPHAN_BREACH_REG_ID }),
    );
  });

  it('recomposes the copy when the template or registration changes', async () => {
    const { user } = setup();

    await user.selectOptions(screen.getByLabelText('Template'), 'registration-note');
    expect(screen.getByLabelText('Subject')).toHaveValue(
      'Question on the Acme Freight registration',
    );

    await user.selectOptions(screen.getByLabelText('Registration'), OWNED_BREACH_REG_ID);
    expect(screen.getByLabelText('Subject')).toHaveValue(
      'Question on the Contoso Retail registration',
    );

    // A custom note has no template copy, and no registration to hang it on.
    await user.selectOptions(screen.getByLabelText('Template'), 'custom');
    expect(screen.getByLabelText('Subject')).toHaveValue('');
    expect(screen.getByLabelText('Message')).toHaveValue('');
    expect(screen.getByLabelText('Registration')).toBeDisabled();

    // Back to the SLA template and the alert on that registration re-fills it.
    await user.selectOptions(screen.getByLabelText('Template'), 'sla-alert');
    expect(screen.getByLabelText('Subject')).toHaveValue('Deal reg SLA lapsed: Contoso Retail');
  });

  it('notes a registration that is still inside the SLA instead of alerting on it', async () => {
    const { user } = setup({
      data: {
        registrations: [
          ...REGISTRATIONS,
          makeRegistration({
            id: 'reg-inside',
            partnerId: 'partner-aligned',
            accountName: 'Litware Media',
            submittedAt: submittedBusinessDaysAgo(1),
          }),
        ],
      },
    });

    await user.selectOptions(screen.getByLabelText('Registration'), 'reg-inside');

    expect(
      screen.getByText(
        'Inside the SLA — Northwind Systems still has time before the response is due.',
      ),
    ).toBeInTheDocument();
    // No alert on this one, so the composer falls back to the follow-up question.
    expect(screen.getByLabelText('Subject')).toHaveValue(
      'Question on the Litware Media registration',
    );
  });

  it('tags a notifiable teammate who is aligned to no manager', async () => {
    const { user } = setup({
      data: {
        registrations: [],
        teamUsers: [
          makeTeamUser({
            id: 'user-analyst',
            name: 'A. Analyst',
            email: 'a.analyst@example.com',
            role: 'analyst',
            partnerManagerId: undefined,
            status: 'active',
            channels: ['email'],
          }),
        ],
      },
    });

    await user.selectOptions(screen.getByLabelText('To'), 'user-analyst');

    expect(
      screen.getByText('a.analyst@example.com · Analyst · not aligned to one manager'),
    ).toBeInTheDocument();
  });

  it('sends a hand-written note to a teammate picked from the composer roster', async () => {
    const { user, onSendNotification } = setup({ data: { registrations: [] } });

    await user.selectOptions(screen.getByLabelText('To'), OWNER_USER_ID);
    expect(composerRegion().getByText('Email')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Subject'), 'Heads up');
    await user.type(screen.getByLabelText('Message'), 'The new partner is live.');
    await user.click(screen.getByRole('button', { name: 'Send to J. Alvarez' }));

    // No registration and no alert behind it: a manual note with no record id.
    expect(onSendNotification).toHaveBeenCalledWith({
      userId: OWNER_USER_ID,
      kind: 'manual',
      subject: 'Heads up',
      body: 'The new partner is live.',
      channels: ['email', 'slack'],
      registrationId: undefined,
    });
  });

  it('falls back to the partner id when the book no longer carries the partner', () => {
    setup({
      data: {
        registrations: [
          makeRegistration({
            id: 'reg-unknown-partner',
            partnerId: 'partner-gone',
            accountName: 'Ghost Partner Deal',
            submittedAt: submittedBusinessDaysAgo(7),
          }),
        ],
      },
    });

    const row = queueRow('Ghost Partner Deal');
    expect(within(row).getByText('partner-gone')).toBeInTheDocument();
    expect(within(row).getByText('No owner — add one')).toBeInTheDocument();
  });

  it('caps the queue at the eight most urgent registrations', () => {
    const registrations = Array.from({ length: 10 }, (_, index) =>
      makeRegistration({
        id: `reg-${index}`,
        accountName: `Deal ${index}`,
        submittedAt: submittedBusinessDaysAgo(5 + index),
      }),
    );
    setup({ data: { registrations } });

    expect(
      screen.getByText('Showing the 8 most urgent of 10 registrations flagged against the SLA.'),
    ).toBeInTheDocument();
  });

  it('shows the last send and the session log', () => {
    setup({
      notifications: [
        makeNotification({
          userId: OWNER_USER_ID,
          subject: 'Deal reg due next business day: Acme Freight',
          channels: ['email', 'slack'],
          sentAt: '2026-09-18T12:00:00.000Z',
        }),
      ],
    });

    // The last send is labeled simulated/local-only, never delivered.
    expect(screen.getByText('Simulated / local only · 12:00 · email + slack')).toBeInTheDocument();
    expect(screen.queryByText(/^Delivered /)).not.toBeInTheDocument();

    const sentCard = screen
      .getByRole('heading', { name: 'Deal-registration SLA alerts' })
      .closest('section');
    if (!sentCard) throw new Error('no SLA alert card');
    expect(within(sentCard).getByText('Sent this session · 1')).toBeInTheDocument();
    expect(
      within(sentCard).getByText(/Simulated \/ local only — recorded for this session/),
    ).toBeInTheDocument();

    // The session log is the only list in the card; the queue above it is a table.
    const log = within(sentCard).getByRole('list');
    expect(within(log).getByText('12:00')).toBeInTheDocument();
    expect(within(log).getByText('J. Alvarez')).toBeInTheDocument();
    expect(
      within(log).getByText('Deal reg due next business day: Acme Freight'),
    ).toBeInTheDocument();
    expect(within(log).getByText('email + slack')).toBeInTheDocument();
  });

  it('names the sender by id when they have left the roster', () => {
    setup({ notifications: [makeNotification({ userId: 'user-departed' })] });

    const sentCard = screen
      .getByRole('heading', { name: 'Deal-registration SLA alerts' })
      .closest('section');
    if (!sentCard) throw new Error('no SLA alert card');
    expect(within(sentCard).getByRole('list')).toHaveTextContent('user-departed');
  });
});
