import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Card from '../components/Card';
import KpiTile from '../components/KpiTile';
import MembershipRoster from '../components/MembershipRoster';
import NotificationComposer, { type ComposerState } from '../components/NotificationComposer';
import { renderQueryStates } from '../components/QueryState';
import SlaAlertPanel from '../components/SlaAlertPanel';
import TeamAccessPanel from '../components/TeamAccessPanel';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { REGISTRATION_SLA_BUSINESS_DAYS } from '../data/constants';
import type { DataProvider, TeamRosterScope } from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import { useSettingsQueries } from '../data/useSettingsQueries';
import type {
  DashboardNotification,
  NewTeamUserInput,
  TeamUser,
  TeamUserStatus,
} from '../data/types';
import {
  composeCopy,
  slaAlertCopy,
  type NotificationDraft,
  type NotificationSender,
} from '../lib/notifications';
import { SETTINGS_TAB_IDS, SETTINGS_TABS, type SettingsTab } from '../data/settingsTabs';
import type { RegistrationSlaAlert } from '../lib/metrics';

/**
 * Settings: two tabs over the session's internal-only surfaces.
 *
 * **General Settings** holds the membership roster, the notification
 * composer, per-user routing, and the deal-registration SLA alert rule.
 * **Action Center** holds the bounded action summaries, filters, demo
 * policy, and session-only notifications. Each data-backed section runs its
 * own scoped query through `useSettingsQueries`: one rejected call fails
 * exactly one section and its retry repeats only that call. The session's
 * roster overlays ride the roster and alert queries because there is no
 * write path to an identity provider (Production: Prod Only).
 *
 * This view renders the first tab's panel and the tablist. The Action Center
 * panel belongs to the shell, because it outlives this route: the tab keeps
 * the pages and filters it loaded while the session follows an action link
 * into Forecasting or Deal Reg Ops, and only the shell is mounted for that
 * whole trip. The general tab is an ordinary route surface, so leaving
 * Settings still unmounts it and its next visit re-runs its queries.
 */

interface SettingsViewProps {
  provider: DataProvider;
  /** The selected tab. The shell owns it, because contexts return to it. */
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  /** The session's roster overlays, ridden into the roster and alert queries. */
  teamUserOverrides: Record<string, Partial<TeamUser>>;
  /** Users added during this session — the only removable roster entries. */
  addedTeamUsers: TeamUser[];
  notifications: DashboardNotification[];
  onAddTeamUser: (input: NewTeamUserInput) => void;
  onSetTeamUserStatus: (userId: string, status: TeamUserStatus) => void;
  onRemoveTeamUser: (userId: string) => void;
  onSendNotification: NotificationSender;
}

export default function SettingsView({
  provider,
  tab,
  onTabChange,
  teamUserOverrides,
  addedTeamUsers,
  notifications,
  onAddTeamUser,
  onSetTeamUserStatus,
  onRemoveTeamUser,
  onSendNotification,
}: SettingsViewProps) {
  // Roster and notification data is internal-only material, so the route
  // reads under the internal demo scope; a partner audience would get an
  // empty roster and an ownerless digest from the same queries.
  const rosterScope: TeamRosterScope = { overrides: teamUserOverrides, added: addedTeamUsers };
  const { teamUsers, managers, alerts, registrations, partners } = useSettingsQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    roster: rosterScope,
    prospects: [],
  });

  const alertList = alerts.data?.alerts ?? [];
  const users = teamUsers.data ?? [];

  const [composer, setComposer] = useState<ComposerState>(() => composerForAlert([]));
  // The composer opens on the most urgent alert once the queue lands, so the
  // panel is never a blank form — unless the user has already typed into it.
  const composerTouched = useRef(false);
  const composerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (alerts.data === null || composerTouched.current) return;
    setComposer(composerForAlert(alerts.data.alerts));
  }, [alerts.data]);

  const composition = (template: ComposerState['template'], registrationId: string | null) => {
    const registration = registrations.rows.find((item) => item.id === registrationId);
    const partner = registration
      ? (partners.data ?? []).find((item) => item.id === registration.partnerId)
      : undefined;
    const alert = alertList.find((item) => item.registration.id === registrationId);
    return composeCopy({ template, registration, partner, alert });
  };

  const describe = (template: ComposerState['template'], registrationId: string | null) => {
    const copy = composition(template, registrationId);
    return { subject: copy.subject, body: copy.body };
  };

  const sendCandidate = (draft: NotificationDraft, recipient: TeamUser) => {
    onSendNotification(draft, { provider, recipient });
  };

  const send = () => {
    const user = users.find((candidate) => candidate.id === composer.userId);
    if (!user) return;
    const copy = composition(composer.template, composer.registrationId);
    sendCandidate(
      {
        userId: user.id,
        kind: copy.kind,
        subject: composer.subject,
        body: composer.body,
        channels: composer.channels ?? user.channels,
        registrationId: composer.registrationId ?? undefined,
      },
      user,
    );
  };

  const notifyAlert = (registrationId: string) => {
    const alert = alertList.find((item) => item.registration.id === registrationId);
    if (!alert) return;
    setComposer(composerForAlert([alert]));
    composerRef.current?.scrollIntoView?.({ block: 'nearest' });
  };

  const notifyAllOwners = () => {
    for (const alert of alertList) {
      if (!alert.owner) continue;
      const copy = slaAlertCopy(alert);
      sendCandidate(
        {
          userId: alert.owner.id,
          ...copy,
          channels: alert.owner.channels,
          registrationId: alert.registration.id,
        },
        alert.owner,
      );
    }
  };

  const routingOn =
    teamUsers.data === null
      ? null
      : teamUsers.data.filter((user) => user.status === 'active').length;

  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  // A horizontal tablist selects as the arrow keys move, which is the
  // pattern this two-tab surface is expected to follow.
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: SettingsTab) => {
    const index = SETTINGS_TABS.findIndex((candidate) => candidate.id === id);
    const last = SETTINGS_TABS.length - 1;
    let next: SettingsTab | undefined;
    if (event.key === 'ArrowRight') next = SETTINGS_TABS[index === last ? 0 : index + 1]!.id;
    else if (event.key === 'ArrowLeft') next = SETTINGS_TABS[index === 0 ? last : index - 1]!.id;
    else if (event.key === 'Home') next = SETTINGS_TABS[0]!.id;
    else if (event.key === 'End') next = SETTINGS_TABS[last]!.id;
    if (next === undefined) return;
    event.preventDefault();
    onTabChange(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
          Workspace · internal
        </p>
        <h1 className="mt-2 text-3xl tracking-tight text-bone">Settings</h1>
        <p className="mt-1 max-w-3xl text-sm text-granite">
          The partner team&apos;s membership roster, how the dashboard notifies them, and the Action
          Center&apos;s action queue and reporting policy. Everything here is a current-session
          simulation: roster changes, applied policy, and sent notifications are recorded locally,
          never provisioned or delivered, and a refresh resets them.
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 border-b border-carbon"
      >
        {SETTINGS_TABS.map(({ id, label }) => {
          const selected = id === tab;
          return (
            <button
              key={id}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              type="button"
              role="tab"
              id={SETTINGS_TAB_IDS[id].tab}
              aria-controls={SETTINGS_TAB_IDS[id].panel}
              aria-selected={selected}
              // Only the selected tab is in the tab order: the arrow keys are
              // how the rest of the list is reached.
              tabIndex={selected ? 0 : -1}
              onClick={() => onTabChange(id)}
              onKeyDown={(event) => onTabKeyDown(event, id)}
              className={`-mb-px border-b px-3 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bone ${
                selected
                  ? 'border-signal text-bone'
                  : 'border-transparent text-granite hover:text-stone'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={SETTINGS_TAB_IDS.general.panel}
        aria-labelledby={SETTINGS_TAB_IDS.general.tab}
        hidden={tab !== 'general'}
        className="space-y-6"
      >
        <Card
          title="Membership roster"
          subtitle="Every internal user on the partner team, grouped into administrators and users by role. Grouping is a display of the identity provider's roster, not an access grant."
        >
          {renderQueryStates(
            'The membership roster',
            [
              ['the team roster', teamUsers],
              ['the manager directory', managers],
            ],
            () => (
              <MembershipRoster users={users} partnerManagers={managers.data ?? []} />
            ),
          )}
        </Card>

        <section aria-labelledby="settings-notifications" className="space-y-4">
          <div className="border-t border-carbon pt-6">
            <h2 id="settings-notifications" className="text-xl tracking-tight text-bone">
              Notifications
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-granite">
              Who receives simulated notifications, the deal-registration SLA rule that fires them,
              and a composer for one-off notes.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <KpiTile
              label="Receiving notifications"
              value={routingOn === null ? '—' : `${routingOn}/${teamUsers.data?.length ?? 0}`}
              sub={
                teamUsers.data !== null
                  ? // A failed refresh keeps the last good roster on screen — the
                    // tile says so rather than reading as freshly answered.
                    teamUsers.error !== null
                    ? 'latest refresh failed — showing the last good roster'
                    : 'roster entries routed simulated notifications this session'
                  : teamUsers.error !== null
                    ? 'roster unavailable — the provider did not answer'
                    : 'roster loading — waiting on the provider'
              }
            />
            <KpiTile
              label="SLA alerts due"
              value={alerts.data === null ? '—' : `${alerts.data.totalCount}`}
              sub={
                alerts.data !== null
                  ? alerts.error !== null
                    ? 'latest refresh failed — showing the last good alert counts'
                    : `${alerts.data.approachingCount} due next business day · ${
                        alerts.data.totalCount - alerts.data.approachingCount
                      } past the ${REGISTRATION_SLA_BUSINESS_DAYS}-day SLA`
                  : alerts.error !== null
                    ? 'alert queue unavailable — the provider did not answer'
                    : 'alert queue loading — waiting on the provider'
              }
            />
          </div>

          <Card
            title="Send a notification"
            subtitle="One person, the channels they receive on. Pick a teammate, or a registration from the alert queue below."
          >
            <div ref={composerRef}>
              {renderQueryStates(
                'The notification composer',
                [
                  ['the notification roster', teamUsers],
                  ['the partner roster', partners],
                  ['the registration records', pageWindowAsQuery(registrations)],
                ],
                () => (
                  <NotificationComposer
                    users={teamUsers.data ?? []}
                    partners={partners.data ?? []}
                    registrations={registrations.rows}
                    alerts={alertList}
                    state={composer}
                    onChange={(next) => {
                      composerTouched.current = true;
                      setComposer(next);
                    }}
                    onSend={send}
                    lastSent={notifications[0]}
                    describe={describe}
                  />
                ),
              )}
            </div>
          </Card>

          <Card
            title="Partner team notification routing"
            subtitle="Which manager each user is aligned to, and whether this session routes simulated notifications to them. These controls do not grant sign-in or data access."
          >
            {renderQueryStates(
              'The team roster',
              [
                ['the notification roster', teamUsers],
                ['the manager directory', managers],
              ],
              () => (
                <TeamAccessPanel
                  users={teamUsers.data ?? []}
                  partnerManagers={managers.data ?? []}
                  addedUserIds={new Set(addedTeamUsers.map((user) => user.id))}
                  onAdd={onAddTeamUser}
                  onSetStatus={onSetTeamUserStatus}
                  onRemove={onRemoveTeamUser}
                />
              ),
            )}
          </Card>

          <Card
            title="Deal-registration SLA alerts"
            subtitle="The rule the notification service runs, the registrations it fires on at snapshot, and what has been sent this session."
          >
            {/* The queue answers from the alert digest alone: the provider
              resolves each alert's owner into the digest, so the KPI tile,
              the rows, and the notify actions stay live through a roster
              failure. The roster only names this panel's sent-log entries,
              and the log falls back to explicit user ids in the meantime. */}
            {renderQueryStates(
              'The SLA alert queue',
              [['the registration SLA alerts', alerts]],
              () => (
                <SlaAlertPanel
                  alerts={alertList}
                  totalCount={alerts.data?.totalCount ?? 0}
                  users={users}
                  notifications={notifications}
                  onNotify={(alert) => notifyAlert(alert.registration.id)}
                  onNotifyAll={notifyAllOwners}
                />
              ),
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

/**
 * Opens the composer on the alert the rule exists for: the one-business-day-out
 * warning if one is waiting on an owner, else the most urgent alert, else an
 * empty form.
 */
function composerForAlert(alerts: RegistrationSlaAlert[]): ComposerState {
  const alert =
    alerts.find((candidate) => candidate.state === 'approaching' && candidate.owner) ??
    alerts.find((candidate) => candidate.owner) ??
    alerts[0];
  if (!alert) {
    return {
      userId: null,
      template: 'sla-alert',
      registrationId: null,
      subject: '',
      body: '',
    };
  }
  const copy = slaAlertCopy(alert);
  return {
    userId: alert.owner?.id ?? null,
    template: 'sla-alert',
    registrationId: alert.registration.id,
    subject: copy.subject,
    body: copy.body,
  };
}
