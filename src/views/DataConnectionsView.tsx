import { useEffect, useRef, useState, type ReactNode } from 'react';
import Card from '../components/Card';
import KpiTile from '../components/KpiTile';
import NotificationComposer, { type ComposerState } from '../components/NotificationComposer';
import { renderQueryStates } from '../components/QueryState';
import SlaAlertPanel from '../components/SlaAlertPanel';
import TeamAccessPanel from '../components/TeamAccessPanel';
import WireDiagram from '../components/WireDiagram';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import {
  CONNECTION_EDGES,
  CONNECTION_METHOD_COVERAGE,
  CONNECTION_NODES,
  CONNECTION_STATUS_META,
  type ConnectionEdge,
  type ConnectionNode,
} from '../data/connections';
import { REGISTRATION_SLA_BUSINESS_DAYS } from '../data/constants';
import type { DataProvider, TeamRosterScope } from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import { useDataConnectionsQueries } from '../data/useDataConnectionsQueries';
import type {
  DashboardNotification,
  NewTeamUserInput,
  TeamUser,
  TeamUserStatus,
} from '../data/types';
import { composeCopy, slaAlertCopy, type NotificationDraft } from '../lib/notifications';
import type { RegistrationSlaAlert } from '../lib/metrics';

/**
 * Data Connections: the systems the dashboard has to be wired to, who on the
 * partner team can be told about them, and the rule that tells them.
 *
 * The map is the centerpiece and the other two sections hang off it — the
 * identity provider node carries the roster that Access manages, and the
 * notification node carries the people the SLA alert rule reaches. That is
 * deliberate: authorization and alerting are not features bolted onto a
 * dashboard, they are two of the connections it needs.
 *
 * The catalog — the map, the coverage counts, the detail panel — is static
 * and renders without loading business facts. The sections that do need data
 * each run their own scoped query through `useDataConnectionsQueries`: one
 * rejected call fails exactly one section, its retry repeats only that call,
 * and the session's roster overlays ride the roster and alert queries
 * because there is no write path to an identity provider (Production: Prod
 * Only).
 */

interface DataConnectionsViewProps {
  provider: DataProvider;
  /** The session's roster overlays, ridden into the roster and alert queries. */
  teamUserOverrides: Record<string, Partial<TeamUser>>;
  /** Users added during this session — the only removable roster entries. */
  addedTeamUsers: TeamUser[];
  notifications: DashboardNotification[];
  onAddTeamUser: (input: NewTeamUserInput) => void;
  onSetTeamUserStatus: (userId: string, status: TeamUserStatus) => void;
  onRemoveTeamUser: (userId: string) => void;
  onSendNotification: (draft: NotificationDraft) => void;
}

export default function DataConnectionsView({
  provider,
  teamUserOverrides,
  addedTeamUsers,
  notifications,
  onAddTeamUser,
  onSetTeamUserStatus,
  onRemoveTeamUser,
  onSendNotification,
}: DataConnectionsViewProps) {
  // This route's data is internal notification infrastructure, so it reads
  // under the internal demo scope; a partner audience would get an empty
  // roster and an ownerless digest from the same queries.
  const rosterScope: TeamRosterScope = { overrides: teamUserOverrides, added: addedTeamUsers };
  const { teamUsers, managers, alerts, registrations, partners } = useDataConnectionsQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    roster: rosterScope,
    prospects: [],
  });

  const alertList = alerts.data?.alerts ?? [];
  const users = teamUsers.data ?? [];

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>('notifications');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [composer, setComposer] = useState<ComposerState>(() => composerForAlert([]));
  // The composer opens on the most urgent alert once the queue lands, so the
  // panel is never a blank form — unless the user has already typed into it.
  const composerTouched = useRef(false);
  useEffect(() => {
    if (alerts.data === null || composerTouched.current) return;
    setComposer(composerForAlert(alerts.data.alerts));
  }, [alerts.data]);

  const selectedNode = CONNECTION_NODES.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdges = selectedNode
    ? CONNECTION_EDGES.filter(
        (edge) => edge.from === selectedNode.id || edge.to === selectedNode.id,
      )
    : [];

  const describe = (template: ComposerState['template'], registrationId: string | null) => {
    const registration = registrations.rows.find((item) => item.id === registrationId);
    const partner = registration
      ? (partners.data ?? []).find((item) => item.id === registration.partnerId)
      : undefined;
    const alert = alertList.find((item) => item.registration.id === registrationId);
    const copy = composeCopy({ template, registration, partner, alert });
    return { subject: copy.subject, body: copy.body };
  };

  const send = () => {
    const user = users.find((candidate) => candidate.id === composer.userId);
    const registration = registrations.rows.find((item) => item.id === composer.registrationId);
    if (!user || !composer.subject.trim() || !composer.body.trim()) return;
    const copy = composeCopy({
      template: composer.template,
      registration,
      partner: registration
        ? (partners.data ?? []).find((item) => item.id === registration.partnerId)
        : undefined,
      alert: alertList.find((item) => item.registration.id === composer.registrationId),
    });
    onSendNotification({
      userId: user.id,
      kind: copy.kind,
      subject: composer.subject.trim(),
      body: composer.body.trim(),
      channels: user.channels,
      registrationId: composer.registrationId ?? undefined,
    });
  };

  const notifyAlert = (registrationId: string) => {
    const alert = alertList.find((item) => item.registration.id === registrationId);
    if (!alert) return;
    setSelectedNodeId('notifications');
    setSelectedUserId(alert.owner?.id ?? null);
    setComposer(composerForAlert([alert]));
  };

  const notifyAllOwners = () => {
    for (const alert of alertList) {
      if (!alert.owner) continue;
      const copy = slaAlertCopy(alert);
      onSendNotification({
        userId: alert.owner.id,
        kind: copy.kind,
        subject: copy.subject,
        body: copy.body,
        channels: alert.owner.channels,
        registrationId: alert.registration.id,
      });
    }
  };

  const methodsCovered = new Set(
    CONNECTION_NODES.flatMap((node) => node.methods).filter((method) =>
      CONNECTION_METHOD_COVERAGE.includes(method),
    ),
  );
  const required = CONNECTION_NODES.filter((node) => node.status === 'required').length;
  const live = CONNECTION_NODES.filter((node) => node.status === 'live').length;
  const routingOn =
    teamUsers.data === null
      ? null
      : teamUsers.data.filter((user) => user.status === 'active').length;

  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
          Integration map
        </p>
        <h1 className="mt-2 text-3xl tracking-tight text-bone">Data Connections</h1>
        <p className="mt-1 max-w-3xl text-sm text-granite">
          Every system the dashboard has to be wired to, what each one supplies, and what is still
          missing — the plumbing behind the read-only DataProvider seam. Only in-process
          mock/provider behavior runs in this demo; identity, server row enforcement, source
          freshness, the warehouse, durable writes, and external delivery are unconnected. The
          partner team&apos;s notification roster lives inside the same map, because the identity
          provider that would authorize them in production (unconnected here) is one of those
          connections, and so is the notification service that would tell a registration owner their
          response SLA is about to lapse.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiTile
          label="Connections required"
          value={`${required}`}
          sub={`of ${CONNECTION_NODES.length} systems mapped · ${live} live on mock data`}
        />
        <KpiTile
          label="Provider methods wired"
          value={`${methodsCovered.size}/${CONNECTION_METHOD_COVERAGE.length}`}
          sub="every DataProvider method has a wire"
        />
        <KpiTile
          label="Flows planned"
          value={`${CONNECTION_EDGES.length}`}
          sub={`${
            CONNECTION_EDGES.filter((edge) => edge.status === 'required').length
          } required to go live`}
        />
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
        title="Data connection map"
        subtitle="Boxes are systems, wires are data. Solid wires are live or required, dashed are planned. Click a box for what it supplies, or a teammate in the notification node to message them."
      >
        <div className="space-y-5">
          <WireDiagram
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            users={users}
            selectedUserId={selectedUserId}
            onSelectUser={(userId) => {
              setSelectedUserId(userId);
              setSelectedNodeId('notifications');
              // Picking a teammate from the node loads their own most urgent
              // alert, so the message is about something they actually own.
              const owned = alertList.filter((candidate) => candidate.owner?.id === userId);
              setComposer(
                owned.length > 0
                  ? composerForAlert(owned)
                  : (prev) => ({ ...prev, userId, subject: '', body: '' }),
              );
            }}
            alertCountByUserId={alerts.data?.alertCountByOwner ?? {}}
          />

          <div className="grid grid-cols-1 gap-5 border-t border-carbon pt-5 lg:grid-cols-2">
            <ConnectionDetail node={selectedNode} edges={selectedEdges} />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
                Send a notification
              </p>
              <p className="mt-1 text-xs text-granite">
                One person, the channels they receive on. Pick a teammate in the notification node,
                or a registration from the alert queue below.
              </p>
              <div className="mt-4">
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
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Partner team notification routing"
        subtitle="Who is on the internal roster, which manager they are aligned to, and whether this session routes simulated notifications to them. These controls do not grant sign-in or data access."
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
            resolves each alert's owner into the digest, so the KPI tile, the
            rows, and the notify actions stay live through a roster failure.
            The roster only names this panel's sent-log entries — its failure
            surfaces in the roster-driven sections above, and the log falls
            back to explicit user ids here in the meantime. */}
        {renderQueryStates('The SLA alert queue', [['the registration SLA alerts', alerts]], () => (
          <SlaAlertPanel
            alerts={alertList}
            totalCount={alerts.data?.totalCount ?? 0}
            users={users}
            notifications={notifications}
            onNotify={(alert) => notifyAlert(alert.registration.id)}
            onNotifyAll={notifyAllOwners}
          />
        ))}
      </Card>
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

function ConnectionDetail({
  node,
  edges,
}: {
  node: ConnectionNode | null;
  edges: ConnectionEdge[];
}) {
  if (!node) {
    return (
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
          Selected connection
        </p>
        <p className="mt-2 text-sm text-granite">
          Pick a box in the map to see what it supplies, how it authenticates, how fresh it is, and
          what is still missing before it can be connected.
        </p>
      </div>
    );
  }

  const meta = CONNECTION_STATUS_META[node.status];
  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
          Selected connection
        </p>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
          <span className={`font-mono text-[10px] uppercase tracking-[0.06em] ${meta.textClass}`}>
            {meta.label}
          </span>
        </span>
        {node.owner && (
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            {node.owner === 'architecture' ? 'Architecture roadmap' : 'Product roadmap'}
          </span>
        )}
      </div>
      <h3 className="mt-2 text-lg tracking-tight text-bone">{node.label}</h3>
      <p className="mt-1 max-w-xl text-sm text-stone">{node.summary}</p>

      <dl className="mt-4 space-y-3 text-sm">
        <DetailRow label="Supplies">
          <ul className="space-y-1">
            {node.supplies.map((item) => (
              <li key={item} className="flex gap-2 text-stone">
                <span
                  aria-hidden="true"
                  className="mt-2 h-1 w-1 shrink-0 rounded-full bg-graphite"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </DetailRow>
        {node.methods.length > 0 && (
          <DetailRow label="Provider methods">
            <span className="flex flex-wrap gap-1.5">
              {node.methods.map((method) => (
                <span
                  key={method}
                  className="rounded border border-ash/50 px-1.5 py-0.5 font-mono text-[10px] text-stone"
                >
                  {method}
                </span>
              ))}
            </span>
          </DetailRow>
        )}
        {node.source && <DetailRow label="Source">{node.source}</DetailRow>}
        {node.auth && <DetailRow label="Auth">{node.auth}</DetailRow>}
        {node.cadence && <DetailRow label="Cadence">{node.cadence}</DetailRow>}
      </dl>

      {node.blocker && (
        <div className="mt-4 rounded border border-signal/40 p-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
            {node.status === 'live' ? 'Limit of the demo' : 'What is missing'}
          </p>
          <p className="mt-1 text-sm text-stone">{node.blocker}</p>
        </div>
      )}

      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Wires on this box
        </p>
        <ul className="mt-2 space-y-1.5">
          {edges.map((edge) => {
            const edgeMeta = CONNECTION_STATUS_META[edge.status];
            return (
              <li key={edge.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${edgeMeta.dotClass}`} />
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-stone">
                  {edge.label}
                </span>
                <span className="text-xs text-granite">{edge.detail}</span>
              </li>
            );
          })}
          {edges.length === 0 && <li className="text-xs text-granite">No wires mapped yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">{label}</dt>
      <dd className="mt-0.5 text-stone">{children}</dd>
    </div>
  );
}
