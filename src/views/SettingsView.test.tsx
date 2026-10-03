import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsView from './SettingsView';
import { REGISTRATION_SLA_BUSINESS_DAYS, SNAPSHOT_DATE } from '../data/constants';
import type { DataProvider } from '../data/DataProvider';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { createSimulatedRemoteProvider } from '../data/mock/createSimulatedRemoteProvider';
import type { DashboardNotification, DealRegistration, Partner, TeamUser } from '../data/types';
import type { ProviderBook } from '../data/mock/book';
import { businessDaysBefore } from '../lib/fiscal';
import { formatDate } from '../lib/format';
import { registrationSlaAlerts, type RegistrationSlaAlert } from '../lib/metrics';
import { slaAlertCopy } from '../lib/notifications';
import {
  makeNotification,
  makePartner,
  makeProviderBook,
  makeRegistration,
  makeTeamUser,
} from '../test/fixtures';

/**
 * SettingsView is two sections over one scoped query hook: the membership
 * roster, and Notifications (the composer, the team-routing panel, and the
 * SLA alert queue). This suite drives them together: the roster grouping and
 * counts, the notification KPI tiles, the alert queue the provider's rule
 * answer carries, and the composer the queue re-targets.
 *
 * Every data-backed section runs its own scoped query, so the failure tests
 * fail one provider method at a time and watch exactly one section fall —
 * with a retry that repeats only that method. The connection map and its
 * catalog KPIs are static and live on DataConnectionsView, tested there.
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

interface SetupOptions {
  data?: Partial<ProviderBook>;
  notifications?: DashboardNotification[];
  /** Fail each named provider method this many times, as a flaky remote would. */
  failMethods?: Record<string, number>;
  /** Hold the simulated network open so the initial load is observable. */
  latencyMs?: number;
}

function setup(options: SetupOptions = {}) {
  const user = userEvent.setup({ delay: null });
  const onSendNotification = vi.fn();
  const book = makeProviderBook({
    partners: PARTNERS,
    registrations: REGISTRATIONS,
    teamUsers: TEAM_USERS,
    ...options.data,
  });
  let provider: DataProvider = new MockDataProvider(book);
  if (options.failMethods !== undefined || options.latencyMs !== undefined) {
    provider = createSimulatedRemoteProvider(provider, {
      latencyMs: options.latencyMs ?? 0,
      failMethods: options.failMethods,
    });
  }
  render(
    <SettingsView
      provider={provider}
      teamUserOverrides={{}}
      addedTeamUsers={[]}
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

/**
 * The composer Card, so channel labels elsewhere on the page do not collide.
 * The card is the section headed "Send a notification".
 */
function composerRegion() {
  const heading = screen.getByRole('heading', { name: 'Send a notification' });
  const root = heading.closest('section');
  if (!root) throw new Error('no composer region');
  return within(root);
}

function queueRow(accountName: string): HTMLElement {
  const row = screen.getByText(accountName).closest('tr');
  if (!row) throw new Error(`no alert queue row for ${accountName}`);
  return row;
}

/** The composer prefill lands when the alert queue's query does. */
async function composerSettled() {
  const composer = composerRegion();
  await waitFor(() => expect(composer.getByLabelText('To')).toHaveValue(OWNER_USER_ID));
  return composer;
}

describe('SettingsView', () => {
  it('names each failed section and retries only the failed query', async () => {
    // Every data-backed section runs its own query; failing each one fails
    // exactly the sections that read it, by its own name, with the failed
    // query's stable copy — never raw provider prose. The notification KPI
    // tiles degrade to a dash instead of a plausible zero.
    const { user } = setup({
      failMethods: {
        getTeamRoster: 1,
        getRegistrationSlaAlerts: 1,
        listRecentRegistrations: 1,
        getPartnerRoster: 1,
      },
    });

    await screen.findByText('The membership roster unavailable:');
    expect(screen.getByText('The team roster unavailable:')).toBeInTheDocument();
    expect(screen.getByText('The notification composer unavailable:')).toBeInTheDocument();
    expect(screen.getByText('The SLA alert queue unavailable:')).toBeInTheDocument();
    // The roster query's failure is shared by the membership, composer, and
    // routing sections; the alert queue's failure is its own query's.
    expect(screen.getAllByText('Failed to load the notification roster')).toHaveLength(3);
    expect(screen.getByText('Failed to load the registration SLA alerts')).toBeInTheDocument();
    expect(tile('Receiving notifications').getByText('—')).toBeInTheDocument();
    expect(tile('SLA alerts due').getByText('—')).toBeInTheDocument();
    expect(
      tile('Receiving notifications').getByText(/roster unavailable — the provider did not answer/),
    ).toBeInTheDocument();
    expect(
      tile('SLA alerts due').getByText(/alert queue unavailable — the provider did not answer/),
    ).toBeInTheDocument();

    // The routing section's retry repeats only getTeamRoster: the shared
    // roster recovers for every section that reads it, the composer moves on
    // to its next failed dependency, and the alert queue is still down.
    await user.click(screen.getByRole('button', { name: 'Retry The team roster' }));
    const region = screen.getByRole('group', { name: 'The team roster' });
    await waitFor(() =>
      expect(within(region).getAllByText('J. Alvarez').length).toBeGreaterThan(0),
    );
    // A successful retry lands focus on the section's named region, never
    // the document body.
    expect(document.activeElement).toBe(region);
    expect(screen.queryByText('The membership roster unavailable:')).not.toBeInTheDocument();
    expect(screen.getByText('The SLA alert queue unavailable:')).toBeInTheDocument();
    expect(screen.getByText('The notification composer unavailable:')).toBeInTheDocument();
    expect(screen.getByText('Failed to load the partner roster')).toBeInTheDocument();
  });

  it('a roster-only failure leaves the SLA alert queue live and retries only the roster', async () => {
    // The regression this pins: the SLA alert queue used to gate on the team
    // roster, so a roster-only failure hid valid alerts behind the queue's
    // unavailable state and made that queue's Retry call getTeamRoster. The
    // digest carries its own resolved owners, so the queue never needed the
    // roster to render.
    const user = userEvent.setup({ delay: null });
    const onSendNotification = vi.fn();
    const inner = new MockDataProvider(
      makeProviderBook({ partners: PARTNERS, registrations: REGISTRATIONS, teamUsers: TEAM_USERS }),
    );
    const rosterSpy = vi.spyOn(inner, 'getTeamRoster');
    const alertsSpy = vi.spyOn(inner, 'getRegistrationSlaAlerts');
    render(
      <SettingsView
        provider={createSimulatedRemoteProvider(inner, {
          latencyMs: 0,
          failMethods: { getTeamRoster: 1 },
        })}
        teamUserOverrides={{}}
        addedTeamUsers={[]}
        notifications={[]}
        onAddTeamUser={vi.fn()}
        onSetTeamUserStatus={vi.fn()}
        onRemoveTeamUser={vi.fn()}
        onSendNotification={onSendNotification}
      />,
    );

    // The roster-driven sections name the roster failure; the roster copy
    // appears exactly in those three sections and nowhere else.
    await screen.findByText('The team roster unavailable:');
    expect(screen.getByText('The membership roster unavailable:')).toBeInTheDocument();
    expect(screen.getByText('The notification composer unavailable:')).toBeInTheDocument();
    expect(screen.getAllByText('Failed to load the notification roster')).toHaveLength(3);
    expect(
      tile('Receiving notifications').getByText(/roster unavailable — the provider did not answer/),
    ).toBeInTheDocument();

    // The queue never gated on the roster: the KPI tile keeps the live
    // counts, the rows render, and the owner actions work off the digest's
    // resolved owners.
    expect(screen.queryByText('The SLA alert queue unavailable:')).not.toBeInTheDocument();
    expect(await tile('SLA alerts due').findByText('3')).toBeInTheDocument();
    expect(
      tile('SLA alerts due').getByText(
        `1 due next business day · 2 past the ${REGISTRATION_SLA_BUSINESS_DAYS}-day SLA`,
      ),
    ).toBeInTheDocument();
    expect(queueRow('Acme Freight')).toBeInTheDocument();
    expect(
      within(queueRow('Contoso Retail')).getByRole('button', { name: 'Notify owner' }),
    ).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Notify all 2 owners' }));
    expect(onSendNotification).toHaveBeenCalledTimes(2);

    // The planned failure never reached the inner provider, so the retry's
    // roster call is the inner provider's first — and the alert query, which
    // already answered, is not re-asked.
    expect(rosterSpy).not.toHaveBeenCalled();
    expect(alertsSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Retry The team roster' }));

    // The roster recovers — the composer rides the same query and comes back
    // with it — the queue is undisturbed, and focus lands on the roster's
    // named region.
    const region = screen.getByRole('group', { name: 'The team roster' });
    await waitFor(() =>
      expect(within(region).getAllByText('J. Alvarez').length).toBeGreaterThan(0),
    );
    expect(rosterSpy).toHaveBeenCalledTimes(1);
    expect(alertsSpy).toHaveBeenCalledTimes(1);
    expect(region).toHaveFocus();
    expect(queueRow('Acme Freight')).toBeInTheDocument();
    expect(tile('SLA alerts due').getByText('3')).toBeInTheDocument();
    expect(screen.queryByText(/unavailable:/)).not.toBeInTheDocument();
  });

  it('keeps retained data visible with truthful tiles and focused retries when a same-scope refresh fails', async () => {
    // The regression this pins: a failed refresh with a retained answer used
    // to render exactly like a healthy panel — no failure copy, no retry,
    // and tiles that read as freshly answered.
    const user = userEvent.setup({ delay: null });
    const onSendNotification = vi.fn();
    const provider = new MockDataProvider(
      makeProviderBook({ partners: PARTNERS, registrations: REGISTRATIONS, teamUsers: TEAM_USERS }),
    );
    // The first answer lands; the overlay-driven refresh (the second call on
    // each method) fails with raw transport prose that must never render.
    const rosterAnswers = provider.getTeamRoster.bind(provider);
    let rosterCalls = 0;
    const rosterSpy = vi
      .spyOn(provider, 'getTeamRoster')
      .mockImplementation((access, scope, context) => {
        rosterCalls += 1;
        if (rosterCalls === 2) {
          return Promise.reject(new Error('RAW SENTINEL: roster transport trace'));
        }
        return rosterAnswers(access, scope, context);
      });
    const alertAnswers = provider.getRegistrationSlaAlerts.bind(provider);
    let alertCalls = 0;
    const alertsSpy = vi
      .spyOn(provider, 'getRegistrationSlaAlerts')
      .mockImplementation((access, scope, maxAlerts, context) => {
        alertCalls += 1;
        if (alertCalls === 2) {
          return Promise.reject(new Error('RAW SENTINEL: alert transport trace'));
        }
        return alertAnswers(access, scope, maxAlerts, context);
      });

    const view = (overrides: Record<string, Partial<TeamUser>>) => (
      <SettingsView
        provider={provider}
        teamUserOverrides={overrides}
        addedTeamUsers={[]}
        notifications={[]}
        onAddTeamUser={vi.fn()}
        onSetTeamUserStatus={vi.fn()}
        onRemoveTeamUser={vi.fn()}
        onSendNotification={onSendNotification}
      />
    );
    const { rerender } = render(view({}));
    await waitFor(() => expect(screen.getAllByText('J. Alvarez').length).toBeGreaterThan(0));
    expect(
      tile('Receiving notifications').getByText(
        'roster entries routed simulated notifications this session',
      ),
    ).toBeInTheDocument();

    // A session roster overlay refreshes exactly the two queries that read
    // it — and both refreshes fail.
    rerender(view({ [OWNER_USER_ID]: { status: 'suspended' } }));

    // Every section that reads a failed dependency keeps its retained content
    // and names the refresh failure; the raw rejection prose never renders.
    await waitFor(() => expect(screen.getAllByText('Latest refresh failed:')).toHaveLength(4));
    expect(screen.getAllByText('Failed to load the notification roster')).toHaveLength(3);
    expect(screen.getByText('Failed to load the registration SLA alerts')).toBeInTheDocument();
    expect(screen.queryByText(/RAW SENTINEL/)).not.toBeInTheDocument();
    // The membership roster, the routing panel, the alert queue, and the
    // composer all still render their last good answers.
    expect(screen.getAllByText('J. Alvarez').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: 'Administrators' })).toBeInTheDocument();
    expect(queueRow('Acme Freight')).toBeInTheDocument();
    expect(composerRegion().getByLabelText('To')).toBeInTheDocument();
    // The tiles keep the prior numbers and say the latest refresh failed.
    expect(tile('Receiving notifications').getByText('2/4')).toBeInTheDocument();
    expect(tile('Receiving notifications').getByText(/latest refresh failed/)).toBeInTheDocument();
    expect(tile('SLA alerts due').getByText('3')).toBeInTheDocument();
    expect(tile('SLA alerts due').getByText(/latest refresh failed/)).toBeInTheDocument();

    // The roster section's retry repeats only the roster query; the composer
    // section shares that dependency and recovers with it, while the alert
    // queue's own failed dependency is still owed its retry.
    await user.click(screen.getByRole('button', { name: 'Retry The team roster' }));
    await waitFor(() => expect(screen.getAllByText('Latest refresh failed:')).toHaveLength(1));
    expect(rosterSpy).toHaveBeenCalledTimes(3);
    expect(alertsSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('group', { name: 'The team roster' })).toHaveFocus();
    expect(screen.getByText('Failed to load the registration SLA alerts')).toBeInTheDocument();
    expect(queueRow('Acme Freight')).toBeInTheDocument();
    expect(
      tile('Receiving notifications').getByText(
        'roster entries routed simulated notifications this session',
      ),
    ).toBeInTheDocument();

    // The alert queue's retry fires exactly its failed dependency, and the
    // route is fully recovered.
    await user.click(screen.getByRole('button', { name: 'Retry The SLA alert queue' }));
    await waitFor(() =>
      expect(screen.queryByText('Latest refresh failed:')).not.toBeInTheDocument(),
    );
    expect(alertsSpy).toHaveBeenCalledTimes(3);
    expect(rosterSpy).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('group', { name: 'The SLA alert queue' })).toHaveFocus();
    expect(
      tile('SLA alerts due').getByText(
        `1 due next business day · 2 past the ${REGISTRATION_SLA_BUSINESS_DAYS}-day SLA`,
      ),
    ).toBeInTheDocument();
  });

  it('distinguishes the initial load from a failure: loading announces itself and offers no retry', () => {
    // The defect this guards: the route used to render "the provider did not
    // answer" with a Retry button while the provider was still answering.
    // Loading is not a failure — it announces itself and waits.
    setup({ latencyMs: 60_000 });

    expect(screen.getByText('Loading the membership roster')).toBeInTheDocument();
    expect(screen.getByText('Loading the notification composer')).toBeInTheDocument();
    expect(screen.getByText('Loading the team roster')).toBeInTheDocument();
    expect(screen.getByText('Loading the SLA alert queue')).toBeInTheDocument();
    expect(screen.getAllByRole('status')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /^Retry / })).toBeNull();
    expect(screen.queryByText(/unavailable:/)).toBeNull();

    // The tiles say "loading", not "did not answer".
    expect(tile('Receiving notifications').getByText('—')).toBeInTheDocument();
    expect(
      tile('Receiving notifications').getByText(/roster loading — waiting on the provider/),
    ).toBeInTheDocument();
    expect(
      tile('SLA alerts due').getByText(/alert queue loading — waiting on the provider/),
    ).toBeInTheDocument();
  });

  it('derives the notification KPI tiles from the live queries', async () => {
    setup();

    // Two of the four roster entries receive notifications; the paused pair does not.
    expect(await tile('Receiving notifications').findByText('2/4')).toBeInTheDocument();
    expect(
      tile('Receiving notifications').getByText(
        'roster entries routed simulated notifications this session',
      ),
    ).toBeInTheDocument();

    expect(await tile('SLA alerts due').findByText('3')).toBeInTheDocument();
    expect(
      tile('SLA alerts due').getByText(
        `1 due next business day · 2 past the ${REGISTRATION_SLA_BUSINESS_DAYS}-day SLA`,
      ),
    ).toBeInTheDocument();
  });

  it('lists the alert queue and surfaces the alert whose owner is missing', async () => {
    setup();

    expect(await screen.findByText('1 due next business day')).toBeInTheDocument();
    expect(screen.getByText('2 past the SLA')).toBeInTheDocument();
    expect(screen.getByText('2 with a resolvable owner')).toBeInTheDocument();

    // The 4-business-day-old registration still has a working day left.
    expect(within(queueRow('Acme Freight')).getByText('1 business day to SLA')).toBeInTheDocument();
    // Two business days past a 5-day SLA.
    expect(within(queueRow('Contoso Retail')).getByText('2d past')).toBeInTheDocument();

    const orphan = queueRow('Fabrikam Logistics');
    expect(within(orphan).getByText('No owner — add one')).toBeInTheDocument();
    expect(within(orphan).getByRole('button', { name: 'Notify owner' })).toBeDisabled();

    const notifyAll = screen.getByRole('button', { name: 'Notify all 2 owners' });
    expect(notifyAll).toBeEnabled();

    expect(screen.getByText(/Nothing sent yet/)).toBeInTheDocument();
  });

  it('opens the composer on the most urgent approaching alert that has an owner', async () => {
    setup();
    const composer = await composerSettled();

    const approaching = alertFor(APPROACHING_REG_ID);
    expect(composer.getByLabelText('To')).toHaveValue(OWNER_USER_ID);
    expect(composer.getByLabelText('Registration')).toHaveValue(APPROACHING_REG_ID);
    expect(composer.getByLabelText('Subject')).toHaveValue(
      'Deal reg due next business day: Acme Freight',
    );
    expect(composer.getByLabelText('Message')).toHaveValue(slaAlertCopy(approaching).body);
    expect(
      composer.getByText(
        `On the SLA clock: last business day before the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day deadline (due ${formatDate(approaching.dueAt)}).`,
      ),
    ).toBeInTheDocument();
    expect(composer.getByText('j.alvarez@example.com · Partner Manager')).toBeInTheDocument();
    expect(composer.getByText('Email')).toBeInTheDocument();
    expect(composer.getByText('Slack')).toBeInTheDocument();
  });

  it('sends the composer draft on the owner channels with the SLA kind', async () => {
    const { user, onSendNotification } = setup();
    const composer = await composerSettled();

    await user.click(composer.getByRole('button', { name: 'Send to J. Alvarez' }));

    expect(onSendNotification).toHaveBeenCalledTimes(1);
    expect(onSendNotification).toHaveBeenCalledWith(
      {
        userId: OWNER_USER_ID,
        kind: 'registration-sla-warning',
        subject: 'Deal reg due next business day: Acme Freight',
        body: slaAlertCopy(alertFor(APPROACHING_REG_ID)).body,
        channels: ['email', 'slack'],
        registrationId: APPROACHING_REG_ID,
      },
      expect.anything(),
    );
  });

  it('keeps the alert kind when the copy is edited by hand', async () => {
    const { user, onSendNotification } = setup();
    const composer = await composerSettled();
    const subject = composer.getByLabelText('Subject');
    const message = composer.getByLabelText('Message');

    await user.clear(subject);
    await user.type(subject, 'Quick nudge');
    await user.clear(message);
    await user.type(message, 'Please approve it today.');
    await user.click(composer.getByRole('button', { name: 'Send to J. Alvarez' }));

    // Editing the words does not change what the send is: still a warning.
    expect(onSendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'registration-sla-warning',
        subject: 'Quick nudge',
        body: 'Please approve it today.',
      }),
      expect.anything(),
    );
  });

  it('cannot send while the subject or body is blank', async () => {
    const { user, onSendNotification } = setup();
    const composer = await composerSettled();
    const subject = composer.getByLabelText('Subject');
    const message = composer.getByLabelText('Message');

    await user.clear(subject);
    const send = composer.getByRole('button', { name: 'Send to J. Alvarez' });
    await user.click(send);
    expect(subject).toHaveFocus();
    expect(subject).toHaveAccessibleDescription('A subject is required.');

    // Whitespace is not copy either.
    await user.type(subject, '   ');
    await user.click(send);
    expect(subject).toHaveFocus();

    await user.type(subject, 'Nudge');
    await user.clear(message);
    await user.click(send);
    expect(message).toHaveFocus();
    expect(message).toHaveAccessibleDescription('A message is required.');

    expect(onSendNotification).not.toHaveBeenCalled();
  });

  it('opens an empty composer when no registration is near the SLA', async () => {
    setup({ data: { registrations: [] } });
    const composer = composerRegion();
    await waitFor(() => expect(composer.getByLabelText('To')).toHaveValue(''));

    expect(await tile('SLA alerts due').findByText('0')).toBeInTheDocument();
    expect(
      tile('SLA alerts due').getByText(
        `0 due next business day · 0 past the ${REGISTRATION_SLA_BUSINESS_DAYS}-day SLA`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Nothing near the SLA — the queue is clear.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notify all 0 owners' })).toBeDisabled();

    expect(composer.getByLabelText('Subject')).toHaveValue('');
    expect(composer.getByLabelText('Message')).toHaveValue('');
    expect(
      composer.getByText('Pick a teammate to see the channels they receive on.'),
    ).toBeInTheDocument();
    expect(composer.getByRole('button', { name: 'Send to a teammate' })).toBeDisabled();
  });

  it('says the roster is empty when there is nobody to notify', async () => {
    setup({ data: { registrations: [], teamUsers: [] } });
    const composer = composerRegion();

    expect(await tile('Receiving notifications').findByText('0/0')).toBeInTheDocument();
    // The membership roster renders both tables with their empty-state rows.
    expect(screen.getByText('0 members · 0 administrators · 0 users')).toBeInTheDocument();
    expect(screen.getByText('No administrators on the roster.')).toBeInTheDocument();
    expect(screen.getByText('No users on the roster.')).toBeInTheDocument();
    // The composer has nobody to send to.
    expect(await composer.findByText('Add someone to the roster first.')).toBeInTheDocument();
    expect(composer.getByRole('button', { name: 'Send to a teammate' })).toBeDisabled();
  });

  it('retargets the composer to another teammate and shows their channels', async () => {
    const { user } = setup();
    const composer = await composerSettled();

    await user.selectOptions(composer.getByLabelText('To'), IDLE_MANAGER_USER_ID);
    expect(composer.getByLabelText('To')).toHaveValue(IDLE_MANAGER_USER_ID);
    expect(composer.getByText('r.nakamura@example.com · Partner Manager')).toBeInTheDocument();
    expect(composer.getByText('In-app')).toBeInTheDocument();

    await user.selectOptions(composer.getByLabelText('To'), OWNER_USER_ID);
    expect(composer.getByLabelText('To')).toHaveValue(OWNER_USER_ID);
    expect(composer.getByText('j.alvarez@example.com · Partner Manager')).toBeInTheDocument();
    expect(composer.getByText('Slack')).toBeInTheDocument();
  });

  it('will not offer a paused teammate as a notification recipient', async () => {
    setup();
    const composer = await composerSettled();

    // A paused user is not a notifiable option: the composer only offers the
    // teammates whose notifications are on.
    const recipients = within(composer.getByLabelText('To'));
    expect(recipients.getByRole('option', { name: /J\. Alvarez/ })).toBeInTheDocument();
    expect(recipients.getByRole('option', { name: /R\. Nakamura/ })).toBeInTheDocument();
    expect(recipients.queryByRole('option', { name: /P\. Singh/ })).toBeNull();
    expect(recipients.queryByRole('option', { name: /T\. Okafor/ })).toBeNull();
  });

  it('retargets the composer to a single alert picked from the queue', async () => {
    const { user } = setup();
    await composerSettled();

    await user.click(
      within(queueRow('Contoso Retail')).getByRole('button', { name: 'Notify owner' }),
    );

    const composer = composerRegion();
    expect(composer.getByLabelText('To')).toHaveValue(OWNER_USER_ID);
    expect(composer.getByLabelText('Registration')).toHaveValue(OWNED_BREACH_REG_ID);
    expect(composer.getByLabelText('Subject')).toHaveValue('Deal reg SLA lapsed: Contoso Retail');
    expect(composer.getByLabelText('Message')).toHaveValue(
      slaAlertCopy(alertFor(OWNED_BREACH_REG_ID)).body,
    );
  });

  it('notifies every alert that has an owner and skips the unowned one', async () => {
    const { user, onSendNotification } = setup();
    await composerSettled();

    await user.click(screen.getByRole('button', { name: 'Notify all 2 owners' }));

    const approaching = slaAlertCopy(alertFor(APPROACHING_REG_ID));
    const breached = slaAlertCopy(alertFor(OWNED_BREACH_REG_ID));
    expect(onSendNotification).toHaveBeenCalledTimes(2);
    expect(onSendNotification).toHaveBeenNthCalledWith(
      1,
      {
        userId: OWNER_USER_ID,
        kind: approaching.kind,
        subject: approaching.subject,
        body: approaching.body,
        channels: ['email', 'slack'],
        registrationId: APPROACHING_REG_ID,
      },
      expect.anything(),
    );
    expect(onSendNotification).toHaveBeenNthCalledWith(
      2,
      {
        userId: OWNER_USER_ID,
        kind: breached.kind,
        subject: breached.subject,
        body: breached.body,
        channels: ['email', 'slack'],
        registrationId: OWNED_BREACH_REG_ID,
      },
      expect.anything(),
    );
    expect(onSendNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ registrationId: ORPHAN_BREACH_REG_ID }),
    );
  });

  it('recomposes the copy when the template or registration changes', async () => {
    const { user } = setup();
    const composer = await composerSettled();

    await user.selectOptions(composer.getByLabelText('Template'), 'registration-note');
    expect(composer.getByLabelText('Subject')).toHaveValue(
      'Question on the Acme Freight registration',
    );

    await user.selectOptions(composer.getByLabelText('Registration'), OWNED_BREACH_REG_ID);
    expect(composer.getByLabelText('Subject')).toHaveValue(
      'Question on the Contoso Retail registration',
    );

    // A custom note has no template copy, and no registration to hang it on.
    await user.selectOptions(composer.getByLabelText('Template'), 'custom');
    expect(composer.getByLabelText('Subject')).toHaveValue('');
    expect(composer.getByLabelText('Message')).toHaveValue('');
    expect(composer.getByLabelText('Registration')).toBeDisabled();

    // Back to the SLA template and the alert on that registration re-fills it.
    await user.selectOptions(composer.getByLabelText('Template'), 'sla-alert');
    expect(composer.getByLabelText('Subject')).toHaveValue('Deal reg SLA lapsed: Contoso Retail');
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
    const composer = await composerSettled();

    await user.selectOptions(composer.getByLabelText('Registration'), 'reg-inside');

    expect(
      composer.getByText(
        'Inside the SLA — Northwind Systems still has time before the response is due.',
      ),
    ).toBeInTheDocument();
    // No alert on this one, so the composer falls back to the follow-up question.
    expect(composer.getByLabelText('Subject')).toHaveValue(
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
    const composer = composerRegion();
    await waitFor(() => expect(composer.getByLabelText('To')).not.toBeDisabled());

    await user.selectOptions(composer.getByLabelText('To'), 'user-analyst');

    expect(
      composer.getByText('a.analyst@example.com · Analyst · not aligned to one manager'),
    ).toBeInTheDocument();
  });

  it('sends a hand-written note to a teammate picked from the composer roster', async () => {
    const { user, onSendNotification } = setup({ data: { registrations: [] } });
    const composer = composerRegion();
    await waitFor(() => expect(composer.getByLabelText('To')).not.toBeDisabled());

    await user.selectOptions(composer.getByLabelText('To'), OWNER_USER_ID);
    expect(composer.getByText('Email')).toBeInTheDocument();
    await user.type(composer.getByLabelText('Subject'), 'Heads up');
    await user.type(composer.getByLabelText('Message'), 'The new partner is live.');
    await user.click(composer.getByRole('button', { name: 'Send to J. Alvarez' }));

    // No registration and no alert behind it: a manual note with no record id.
    expect(onSendNotification).toHaveBeenCalledWith(
      {
        userId: OWNER_USER_ID,
        kind: 'manual',
        subject: 'Heads up',
        body: 'The new partner is live.',
        channels: ['email', 'slack'],
        registrationId: undefined,
      },
      expect.anything(),
    );
  });

  it('falls back to the partner id when the book no longer carries the partner', async () => {
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

    const row = await screen.findByText('Ghost Partner Deal');
    const queueRowElement = row.closest('tr');
    if (!queueRowElement) throw new Error('no alert queue row for Ghost Partner Deal');
    expect(within(queueRowElement).getByText('partner-gone')).toBeInTheDocument();
    expect(within(queueRowElement).getByText('No owner — add one')).toBeInTheDocument();
  });

  it('caps the queue at the eight most urgent registrations', async () => {
    const registrations = Array.from({ length: 10 }, (_, index) =>
      makeRegistration({
        id: `reg-${index}`,
        accountName: `Deal ${index}`,
        submittedAt: submittedBusinessDaysAgo(5 + index),
      }),
    );
    setup({ data: { registrations } });

    expect(
      await screen.findByText(
        'Showing the 8 most urgent of 10 registrations flagged against the SLA.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the last send and the session log', async () => {
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
    await composerSettled();

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

  it('names the sender by id when they have left the roster', async () => {
    setup({ notifications: [makeNotification({ userId: 'user-departed' })] });

    const sentCard = await screen.findByRole('heading', { name: 'Deal-registration SLA alerts' });
    const section = sentCard.closest('section');
    if (!section) throw new Error('no SLA alert card');
    await waitFor(() =>
      expect(within(section).getByRole('list')).toHaveTextContent('user-departed'),
    );
  });

  it('groups the membership roster into administrators and users', async () => {
    setup();

    expect(await screen.findByText(/4 members · 1 administrators · 3 users/)).toBeInTheDocument();

    // Administrators are the whole-book roles; here that is the suspended deal
    // desk, and nobody else.
    const administrators = within(screen.getByRole('table', { name: 'Administrators' }));
    expect(administrators.getByText('T. Okafor')).toBeInTheDocument();
    expect(administrators.getByText('Deal Desk Ops')).toBeInTheDocument();
    expect(administrators.queryByText('J. Alvarez')).toBeNull();

    // Everyone else is a user, listed with the aligned-manager column.
    const users = within(screen.getByRole('table', { name: 'Users' }));
    expect(users.getAllByText('J. Alvarez').length).toBeGreaterThan(0);
    expect(users.getAllByText('R. Nakamura')).toHaveLength(1);
    expect(users.getAllByText('P. Singh')).toHaveLength(1);
    expect(users.getAllByText('Partner Manager')).toHaveLength(3);
    expect(users.queryByText('T. Okafor')).toBeNull();
  });

  it('shows a team-roster failure in the membership section', async () => {
    setup({ failMethods: { getTeamRoster: 1 } });

    const membership = await screen.findByRole('group', { name: 'The membership roster' });
    expect(within(membership).getByText('The membership roster unavailable:')).toBeInTheDocument();
    expect(
      within(membership).getByText('Failed to load the notification roster'),
    ).toBeInTheDocument();
    expect(
      within(membership).getByRole('button', { name: 'Retry The membership roster' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Administrators' })).toBeNull();
  });
});
