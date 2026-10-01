import {
  type ReactNode,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import ProviderTransitionNotice from './components/ProviderTransitionNotice';
import { QueryLoading } from './components/QueryState';
import Sidebar, { type Route } from './components/Sidebar';
import { MenuIcon } from './components/icons';
import { SNAPSHOT_DATE } from './data/constants';
import type { DataProvider } from './data/DataProvider';
import { PROVIDER_OPTIONS, providerOption } from './data/providers';
import type { ProviderId } from './data/providers';
import type { SessionEdits } from './data/sessionEdits';
import { useCommittedProvider } from './data/useCommittedProvider';
import type { CommittedProvider } from './data/useCommittedProvider';
import type {
  ActionPolicy,
  DashboardNotification,
  ForecastCategory,
  MeetingClassification,
  NewTeamUserInput,
  Partner,
  TeamUser,
  TeamUserStatus,
} from './data/types';
import type { NotificationDraft } from './lib/notifications';
import { formatDate } from './lib/format';
import { DEFAULT_ACTION_POLICY } from './lib/actionPolicy';
import { isAbortError } from './lib/abort';
import { featureFlags, getFeatureFlagSubject, type FeatureFlagClient } from './lib/featureFlags';
import { assessHealth, publishHealthArtifact, shellHealthArtifact } from './lib/health';
import type { HealthArtifact } from './lib/health';
import { logger } from './lib/logging';
import { telemetry } from './lib/telemetry/telemetry';

// The two heaviest views — the operational system routes — are one lazily
// loaded chunk: the entry chunk carries the shell, the provider seam, the
// telemetry boundary, and the six daily-workflow views, and a first visit to
// Data Connections or Production Requirements downloads that chunk on
// demand. It is a single dynamic import (the barrel in views/system.ts), so
// Rollup co-locates every component and hook only those two views use
// instead of emitting a tail of micro shared chunks.
import ActivityTrackingView from './views/ActivityTrackingView';
import DealRegistrationOpsView from './views/DealRegistrationOpsView';
import ForecastingView from './views/ForecastingView';
import HomeView from './views/HomeView';
import PartnerPerformanceView from './views/PartnerPerformanceView';
import PartnerView from './views/PartnerView';
const DataConnectionsView = lazy(() =>
  import('./views/system').then((module) => ({ default: module.DataConnectionsView })),
);
const ProductionRequirementsView = lazy(() =>
  import('./views/system').then((module) => ({ default: module.ProductionRequirementsView })),
);
const ActionCenterView = lazy(() => import('./views/ActionCenterView'));

// Every session action leaves one structured record (see lib/logging.ts), so a
// session can be replayed from the console; opportunity notes and next steps
// are user prose and are deliberately not logged.
const log = logger.child({ component: 'App' });
const PRODUCTION_REQUIREMENTS_ROUTE: readonly Route[] = ['production-requirements'];
const NO_HIDDEN_ROUTES: readonly Route[] = [];

/** Route names for the chunk-loading fallback, matching the navigation labels. */
const ROUTE_LOADING_LABEL: Record<Route, string> = {
  home: 'Home',
  partners: 'Partner Performance',
  forecasting: 'Forecasting',
  'registration-ops': 'Deal Reg Ops',
  activity: 'Activity Tracking',
  'partner-view': 'Partner View',
  'production-requirements': 'Production Requirements',
  'data-connections': 'Data Connections',
  'action-center': 'Action Center',
};

interface AppProps {
  flagClient?: FeatureFlagClient;
  /**
   * Test seam: builds provider instances for the transition coordinator. The
   * production default is `createProvider`; tests inject tagged or
   * failure-free providers so transitions are deterministic.
   */
  providerFactory?: (id: ProviderId) => DataProvider;
  /** Test seam: the readiness probe a candidate must pass to commit. */
  probeProvider?: (candidate: DataProvider, signal: AbortSignal) => Promise<unknown>;
}

function hiddenRoutes(productionRequirementsEnabled: boolean): readonly Route[] {
  return productionRequirementsEnabled ? NO_HIDDEN_ROUTES : PRODUCTION_REQUIREMENTS_ROUTE;
}

function FlaggedContent({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  return enabled ? children : null;
}

export default function App({
  flagClient = featureFlags,
  providerFactory,
  probeProvider,
}: AppProps) {
  const [route, setRoute] = useState<Route>('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [flagSubject] = useState(getFeatureFlagSubject);
  const productionRequirementsEnabled = flagClient.isEnabled('productionRequirements', {
    subjectKey: flagSubject,
  });

  // In-app edits that override the CRM-backed mock data and re-render every
  // view live: forecast revenue deltas, opp notes, next steps, meeting
  // classifications, and prospect partners added from Log Meetings.
  const [revenueOverrides, setRevenueOverrides] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [nextSteps, setNextSteps] = useState<Record<string, string>>({});
  const [forecastCalls, setForecastCalls] = useState<Record<string, ForecastCategory>>({});
  const [classifications, setClassifications] = useState<Record<string, MeetingClassification>>({});
  // Only the prospects live in state; the provider's book stays the source of
  // truth, so this list cannot go stale while the data is still loading.
  const [prospects, setProspects] = useState<Partner[]>([]);
  const prospectSeq = useRef(0);

  // Partner-team notification roster and simulated notifications. Roster
  // patches are overrides keyed by user id, additions are separate, and sent
  // notifications are their own session log — the same shape as the other
  // session edits, and the same gap a live provider has to close by persisting
  // them (see Data Connections).
  const [teamUserOverrides, setTeamUserOverrides] = useState<Record<string, Partial<TeamUser>>>({});
  const [addedTeamUsers, setAddedTeamUsers] = useState<TeamUser[]>([]);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const [actionPolicy, setActionPolicy] = useState<Readonly<ActionPolicy>>(DEFAULT_ACTION_POLICY);
  const teamUserSeq = useRef(0);
  const notificationSeq = useRef(0);

  // The provider is the integration seam, and the header's selector is a
  // *request*, not a switch: a candidate provider has to pass a readiness
  // probe before it commits. Until then the previous provider — its label,
  // its data, and the session's edits — stays authoritative, so no frame ever
  // pairs one provider's label with another's rows. The commit is a single
  // batched update: provider object, id, and generation move together, and
  // every piece of session state resets in the same batch, because an edit
  // recorded against one provider's ids is meaningless to another's.
  const resetSessionState = useCallback(() => {
    setRevenueOverrides({});
    setNotes({});
    setNextSteps({});
    setForecastCalls({});
    setClassifications({});
    setProspects([]);
    prospectSeq.current = 0;
    setTeamUserOverrides({});
    setAddedTeamUsers([]);
    teamUserSeq.current = 0;
    setNotifications([]);
    setActionPolicy(DEFAULT_ACTION_POLICY);
    notificationSeq.current = 0;
  }, []);

  const handleProviderCommit = useCallback(
    (next: CommittedProvider) => {
      log.info('Provider committed', { providerId: next.id, generation: next.generation });
      resetSessionState();
    },
    [resetSessionState],
  );

  const transition = useCommittedProvider({
    createCandidate: providerFactory,
    probe: probeProvider,
    onCommit: handleProviderCommit,
  });
  const { committed } = transition;
  const provider = committed.provider;
  const providerId = committed.id;
  const providerMeta = providerOption(providerId);
  const requestedMeta = providerOption(transition.requestedId);

  // Route and provider are the two halves of "where is this session": every
  // telemetry envelope, error capture, and the health artifact carry them, so
  // a signal can always be answered with "on the Forecasting view, against
  // the simulated remote provider". The provider effect also records the
  // initial selection — a session's first record of what it was wired to.
  useEffect(() => {
    telemetry.setRoute(route);
  }, [route]);

  useEffect(() => {
    telemetry.setProviderId(providerId);
  }, [providerId]);

  // The session's edits in the shape the scoped contract takes: every route
  // is on the scoped contract now, so the provider aggregates the corrected
  // book itself and there is no folded-book copy of these edits left.
  const forecastEdits = useMemo<SessionEdits>(
    () => ({ revenueOverrides, notes, nextSteps, forecastCalls }),
    [revenueOverrides, notes, nextSteps, forecastCalls],
  );

  // window.GTM_HEALTH exists from the first effect after the shell mounts —
  // before any readiness check, provider ping, or route query has resolved,
  // and it keeps existing when every one of those fails. The provisional
  // artifact says only what the shell already knows about itself; the real
  // assessment replaces it as soon as it lands, whatever it lands on. The
  // refresh handle reads the provider and the transition through a ref, so
  // an operator's refresh() probes the seam the session is on now, not the
  // one it happened to boot with.
  const healthContextRef = useRef({
    provider,
    requestedId: transition.requestedId,
    status: transition.status,
  });
  // The assessment in flight, so the work it asked the provider for can be
  // cancelled — not merely ignored — when it becomes obsolete: a newer
  // refresh starts, the committed provider is replaced, or the shell
  // unmounts. The publication and identity guards below still fence any
  // answer a signal-ignoring provider produces afterwards.
  const healthProbe = useRef<AbortController | null>(null);
  useEffect(() => {
    const previous = healthContextRef.current;
    healthContextRef.current = {
      provider,
      requestedId: transition.requestedId,
      status: transition.status,
    };
    if (previous.provider !== provider) {
      // The committed provider moved: a probe still running against the old
      // seam is obsolete, so its provider-visible work stops now.
      healthProbe.current?.abort();
      healthProbe.current = null;
    }
  }, [provider, transition.requestedId, transition.status]);

  // Unmount abandons the in-flight probe: its provider work is cancelled at
  // the seam. StrictMode's simulated unmount runs this too; the boot
  // effect's re-run starts the replacement assessment.
  useEffect(
    () => () => {
      healthProbe.current?.abort();
      healthProbe.current = null;
    },
    [],
  );

  const refreshHealth = useCallback(async (): Promise<HealthArtifact | null> => {
    const started = healthContextRef.current;
    // A newer refresh supersedes one still in flight: the abandoned
    // assessment's provider work stops at the seam rather than running on
    // to an answer the publication guard would discard anyway.
    healthProbe.current?.abort();
    const controller = new AbortController();
    healthProbe.current = controller;
    try {
      const artifact = await assessHealth({
        provider: started.provider,
        signal: controller.signal,
        transition: {
          requestedId: started.requestedId,
          status:
            started.status === 'idle'
              ? 'committed'
              : started.status === 'probing'
                ? 'committing'
                : 'failed',
        },
      });
      // The assessment was superseded, or the committed provider moved
      // while it ran: this artifact speaks for a seam that is no longer
      // committed. Returning null lets the publisher leave the current
      // artifact alone — the transition's own publication already carries
      // the newly committed identity, and probing again is the next
      // refresh's job.
      return !controller.signal.aborted && healthContextRef.current.provider === started.provider
        ? artifact
        : null;
    } catch (error) {
      // An aborted assessment is a cancelled one, not a failed one: nothing
      // is published or reported for it.
      if (isAbortError(error)) return null;
      throw error;
    }
  }, []);

  const lastHealthArtifact = useRef<HealthArtifact | null>(null);
  const publishHealth = useCallback(
    (artifact: HealthArtifact) => {
      lastHealthArtifact.current = artifact;
      publishHealthArtifact(artifact, refreshHealth);
    },
    [refreshHealth],
  );

  const healthBooted = useRef(false);
  useEffect(() => {
    if (!healthBooted.current) {
      healthBooted.current = true;
      publishHealth(shellHealthArtifact());
    }
    // The assessment runs on every mount, not once: StrictMode's simulated
    // unmount aborts the first boot probe (the unmount cleanup above), so
    // the remount starts its replacement — and the supersede abort inside
    // refreshHealth keeps exactly one assessment live either way.
    void refreshHealth().then((artifact) => {
      // A null artifact means the assessment was abandoned — superseded, or
      // the committed provider moved mid-probe; the transition's own
      // publication stands and nothing is reported for the abandoned probe.
      if (artifact === null) return;
      // Only the assessed artifact ships as telemetry; the provisional one
      // would alert on a boot that has not finished judging itself.
      telemetry.reportHealth(artifact);
      publishHealth(artifact);
    });
  }, [refreshHealth, publishHealth]);

  // A provider request or commit changes who the artifact speaks for, so the
  // published document follows without re-running the whole assessment.
  useEffect(() => {
    const artifact = lastHealthArtifact.current;
    if (artifact === null) return;
    publishHealth({
      ...artifact,
      providerId,
      requestedProviderId: transition.requestedId,
      providerTransitionStatus:
        transition.status === 'idle'
          ? 'committed'
          : transition.status === 'probing'
            ? 'committing'
            : 'failed',
    });
  }, [providerId, transition.requestedId, transition.status, publishHealth]);

  const setRevenue = (opportunityId: string, value: number) => {
    log.debug('Revenue forecast edited', { opportunityId, revenue: value });
    telemetry.track('forecast_revenue_edited', { opportunityId });
    setRevenueOverrides((prev) => ({ ...prev, [opportunityId]: value }));
  };

  // An emptied field is stored as '' rather than deleted. Deleting the key
  // would drop back through the `??` below to the provider's value, so
  // clearing a next step the CRM supplied would silently restore it and the
  // edit would appear to fail. Empty string is the tombstone: "the manager
  // cleared this", which is a different fact from "the manager never touched
  // it" and has to outlive the keystroke that produced it.
  const setNote = (opportunityId: string, note: string) =>
    setNotes((prev) => ({ ...prev, [opportunityId]: note }));

  const setNextStep = (opportunityId: string, nextStep: string) =>
    setNextSteps((prev) => ({ ...prev, [opportunityId]: nextStep }));

  const setForecastCall = (opportunityId: string, category: ForecastCategory) => {
    log.debug('Forecast call changed', { opportunityId, category });
    telemetry.track('forecast_call_changed', { opportunityId, category });
    setForecastCalls((prev) => ({ ...prev, [opportunityId]: category }));
  };

  const commitClassifications = (next: Record<string, MeetingClassification>) => {
    telemetry.track('meeting_classifications_committed', { count: Object.keys(next).length });
    setClassifications(next);
  };

  const addPartner = (name: string, partnerManagerId: string) => {
    prospectSeq.current += 1;
    const id = `prospect-${prospectSeq.current}`;
    log.debug('Prospect partner added', { partnerId: id, name, partnerManagerId });
    telemetry.track('partner_added', { partnerId: id, partnerManagerId });
    setProspects((prev) => [
      ...prev,
      {
        id,
        name,
        type: 'referral',
        tier: 'registered',
        region: 'na',
        accountManager: 'Pending assignment',
        partnerManagerId,
        joinedAt: SNAPSHOT_DATE.toISOString(),
        prospect: true,
      },
    ]);
    return id;
  };

  // Adding puts a name on the session roster with notification routing off;
  // turning routing on is a second step. Both are local simulations — neither
  // provisions or authorizes sign-in or data access, which a real identity
  // provider (Prod Only) would own.
  const addTeamUser = (input: NewTeamUserInput) => {
    teamUserSeq.current += 1;
    log.debug('Team user invited', {
      name: input.name,
      email: input.email,
      role: input.role,
      partnerManagerId: input.partnerManagerId,
    });
    // The analytics event carries the role and the manager, never the name or
    // address: identifiers and counts only, the same rule the log layer
    // applies, and redaction would mask the rest on the way out regardless.
    telemetry.track('team_user_invited', {
      role: input.role,
      partnerManagerId: input.partnerManagerId,
    });
    setAddedTeamUsers((prev) => [
      ...prev,
      {
        id: `session-user-${teamUserSeq.current}`,
        name: input.name,
        email: input.email,
        role: input.role,
        partnerManagerId: input.partnerManagerId,
        status: 'invited',
        channels: input.channels,
        addedAt: new Date().toISOString(),
      },
    ]);
  };

  const setTeamUserStatus = (userId: string, status: TeamUserStatus) => {
    log.debug('Team user status changed', { userId, status });
    const patch: Partial<TeamUser> = { status };
    if (status === 'active') patch.authorizedAt = new Date().toISOString();
    if (addedTeamUsers.some((user) => user.id === userId)) {
      setAddedTeamUsers((prev) =>
        prev.map((user) => (user.id === userId ? { ...user, ...patch } : user)),
      );
      return;
    }
    setTeamUserOverrides((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }));
  };

  const removeTeamUser = (userId: string) => {
    log.debug('Session team user removed', { userId });
    setAddedTeamUsers((prev) => prev.filter((user) => user.id !== userId));
  };

  // Sends are timestamped off the session clock, not the snapshot: the data is
  // mocked at a fixed date, but an action taken now happened now. The record
  // is simulated and local to this session — the demo has no sender behind it,
  // so nothing is ever delivered.
  const sendNotification = (draft: NotificationDraft) => {
    notificationSeq.current += 1;
    const id = `notification-${notificationSeq.current}`;
    log.info('Notification sent', {
      notificationId: id,
      userId: draft.userId,
      kind: draft.kind,
      channels: draft.channels,
    });
    telemetry.track('notification_sent', { kind: draft.kind, channels: draft.channels });
    setNotifications((prev) => [
      {
        id,
        userId: draft.userId,
        kind: draft.kind,
        subject: draft.subject,
        body: draft.body,
        channels: draft.channels,
        sentAt: new Date().toISOString(),
        status: 'simulated-local',
        registrationId: draft.registrationId,
      },
      ...prev,
    ]);
  };

  return (
    <div className="min-h-screen bg-canvas font-sans text-bone">
      <header className="sticky top-0 z-20 border-b border-carbon bg-canvas">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => {
              setSidebarOpen((open) => !open);
              setMobileNavOpen((open) => !open);
            }}
            aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            aria-expanded={sidebarOpen}
            className="rounded p-2 text-granite transition-colors hover:bg-ash/20 hover:text-stone"
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            <MenuIcon />
          </button>
          <div className="flex items-center gap-3">
            <span className="inline-block h-2 w-2 rounded-full bg-signal" />
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-bone">
              GTM Partner Dashboard
            </span>
          </div>
          <p className="ml-auto hidden font-mono text-[10px] uppercase tracking-[0.06em] text-granite md:block">
            Mock data · snapshot {formatDate(SNAPSHOT_DATE.toISOString())}
          </p>
          <label className="ml-auto flex items-center gap-2 md:ml-4">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              Provider
            </span>
            <select
              value={transition.requestedId}
              onChange={(event) => transition.requestProvider(event.target.value as ProviderId)}
              aria-label="Data provider"
              className="rounded border border-ash bg-carbon px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-bone focus:border-signal focus:outline-none"
            >
              {PROVIDER_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="flex">
        <Sidebar
          collapsed={!sidebarOpen}
          mobileOpen={mobileNavOpen}
          route={route}
          hiddenRoutes={hiddenRoutes(productionRequirementsEnabled)}
          onNavigate={(nextRoute) => {
            setRoute(nextRoute);
            setMobileNavOpen(false);
          }}
        />

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6">
          {/* A requested provider is not the provider. While the candidate's
              readiness probe runs — or after it fails — the committed provider
              keeps the screen, and the notice says so out loud. The banner
              below only ever names the committed provider, so the label and
              the data always belong to the same source. */}
          <ProviderTransitionNotice
            status={transition.status}
            failure={transition.failure}
            requestedLabel={requestedMeta.label}
            committedLabel={providerMeta.label}
            onRetry={transition.retry}
            onCancel={transition.cancel}
          />
          {providerId !== 'local' && (
            <p className="mb-6 rounded-card border border-ash p-4 text-xs text-granite">
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
                {providerMeta.label}
              </span>{' '}
              {providerMeta.summary}
            </p>
          )}
          <RouteContent
            route={route}
            providerId={providerId}
            generation={committed.generation}
            productionRequirementsEnabled={productionRequirementsEnabled}
            provider={provider}
            forecastEdits={forecastEdits}
            classifications={classifications}
            prospects={prospects}
            teamUserOverrides={teamUserOverrides}
            addedTeamUsers={addedTeamUsers}
            notifications={notifications}
            actionPolicy={actionPolicy}
            onPolicyChange={setActionPolicy}
            onSetRevenue={setRevenue}
            onSetNote={setNote}
            onSetNextStep={setNextStep}
            onSetForecastCall={setForecastCall}
            onCommitClassifications={commitClassifications}
            onAddPartner={addPartner}
            onAddTeamUser={addTeamUser}
            onSetTeamUserStatus={setTeamUserStatus}
            onRemoveTeamUser={removeTeamUser}
            onSendNotification={sendNotification}
          />
        </main>
      </div>

      <footer className="p-6">
        <p className="font-mono text-xs text-granite">
          Mock data · deterministic snapshot as of {formatDate(SNAPSHOT_DATE.toISOString())} · edits
          stay in-app for this session
        </p>
      </footer>
    </div>
  );
}

/** Everything RouteContent needs from the shell, in one place. */
interface RouteContentProps {
  route: Route;
  providerId: ProviderId;
  generation: number;
  productionRequirementsEnabled: boolean;
  provider: DataProvider;
  forecastEdits: SessionEdits;
  classifications: Record<string, MeetingClassification>;
  prospects: Partner[];
  teamUserOverrides: Record<string, Partial<TeamUser>>;
  addedTeamUsers: TeamUser[];
  notifications: DashboardNotification[];
  actionPolicy: Readonly<ActionPolicy>;
  onPolicyChange: (policy: ActionPolicy) => void;
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
  onSetNextStep: (opportunityId: string, nextStep: string) => void;
  onSetForecastCall: (opportunityId: string, category: ForecastCategory) => void;
  onCommitClassifications: (next: Record<string, MeetingClassification>) => void;
  onAddPartner: (name: string, partnerManagerId: string) => string;
  onAddTeamUser: (input: NewTeamUserInput) => void;
  onSetTeamUserStatus: (userId: string, status: TeamUserStatus) => void;
  onRemoveTeamUser: (userId: string) => void;
  onSendNotification: (draft: NotificationDraft) => void;
}

/**
 * The route kinds, with one failure contract: every route is scoped or
 * static. Production Requirements and the connection catalog are static and
 * render through total provider failure; every other route reads the scoped
 * contract and carries per-widget failure state, so one rejected provider
 * call fails exactly one card or section, and its retry repeats only that
 * call. There is no whole-book load left to blank a route.
 */
function RouteContent({
  route,
  providerId,
  generation,
  productionRequirementsEnabled,
  provider,
  forecastEdits,
  classifications,
  prospects,
  teamUserOverrides,
  addedTeamUsers,
  notifications,
  actionPolicy,
  onPolicyChange,
  onSetRevenue,
  onSetNote,
  onSetNextStep,
  onSetForecastCall,
  onCommitClassifications,
  onAddPartner,
  onAddTeamUser,
  onSetTeamUserStatus,
  onRemoveTeamUser,
  onSendNotification,
}: RouteContentProps) {
  // The key is the selection-reconciliation rule: a new committed provider
  // generation remounts the route, so view-local selections — a manager
  // filter, an expanded group, a picked partner — reset to their defaults
  // instead of pointing at ids another provider's directory may not even
  // contain.
  const boundaryKey = `${providerId}:${generation}`;
  // One Suspense boundary for the lazily loaded route chunks. The fallback is
  // the same named loading surface the scoped queries render, so a chunk
  // fetch reads exactly like a query's initial load and announces itself the
  // same way. It replaces only the route area — header, navigation, and the
  // provider transition notice stay put while the chunk downloads.
  return (
    <Suspense fallback={<QueryLoading label={ROUTE_LOADING_LABEL[route]} />}>
      {route === 'action-center' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:action-center`}>
          <ActionCenterView
            provider={provider}
            policy={actionPolicy}
            onPolicyChange={onPolicyChange}
            edits={forecastEdits}
            classifications={classifications}
            prospects={prospects}
            roster={{ overrides: teamUserOverrides, added: addedTeamUsers }}
          />
        </ErrorBoundary>
      )}
      {route === 'production-requirements' && (
        <FlaggedContent enabled={productionRequirementsEnabled}>
          <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:production-requirements`}>
            <ProductionRequirementsView />
          </ErrorBoundary>
        </FlaggedContent>
      )}
      {route === 'data-connections' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:data-connections`}>
          <DataConnectionsView
            provider={provider}
            teamUserOverrides={teamUserOverrides}
            addedTeamUsers={addedTeamUsers}
            notifications={notifications}
            onAddTeamUser={onAddTeamUser}
            onSetTeamUserStatus={onSetTeamUserStatus}
            onRemoveTeamUser={onRemoveTeamUser}
            onSendNotification={onSendNotification}
          />
        </ErrorBoundary>
      )}
      {route === 'forecasting' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:forecasting`}>
          <ForecastingView
            provider={provider}
            edits={forecastEdits}
            onSetRevenue={onSetRevenue}
            onSetNote={onSetNote}
            onSetNextStep={onSetNextStep}
            onSetForecastCall={onSetForecastCall}
          />
        </ErrorBoundary>
      )}
      {route === 'home' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:home`}>
          <HomeView
            provider={provider}
            edits={forecastEdits}
            classifications={classifications}
            prospects={prospects}
          />
        </ErrorBoundary>
      )}
      {route === 'partners' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:partners`}>
          <PartnerPerformanceView
            provider={provider}
            edits={forecastEdits}
            classifications={classifications}
            prospects={prospects}
          />
        </ErrorBoundary>
      )}
      {route === 'registration-ops' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:registration-ops`}>
          <DealRegistrationOpsView provider={provider} prospects={prospects} />
        </ErrorBoundary>
      )}
      {route === 'activity' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:activity`}>
          <ActivityTrackingView
            provider={provider}
            classifications={classifications}
            onCommitClassifications={onCommitClassifications}
            onAddPartner={onAddPartner}
            prospects={prospects}
          />
        </ErrorBoundary>
      )}
      {route === 'partner-view' && (
        <ErrorBoundary key={boundaryKey} resetKey={`${boundaryKey}:partner-view`}>
          <PartnerView provider={provider} edits={forecastEdits} prospects={prospects} />
        </ErrorBoundary>
      )}
    </Suspense>
  );
}
