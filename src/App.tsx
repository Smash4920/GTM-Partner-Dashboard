import { useMemo, useRef, useState } from 'react';
import Sidebar, { type Route } from './components/Sidebar';
import { MenuIcon } from './components/icons';
import { SNAPSHOT_DATE } from './data/constants';
import { MockDataProvider } from './data/mock/MockDataProvider';
import type {
  DashboardNotification,
  ForecastCategory,
  MeetingClassification,
  NewTeamUserInput,
  Partner,
  TeamUser,
  TeamUserStatus,
} from './data/types';
import { useDashboardData } from './data/useDashboardData';
import type { NotificationDraft } from './lib/notifications';
import { formatDate } from './lib/format';
import { logger } from './lib/logging';
import ActivityTrackingView from './views/ActivityTrackingView';
import DataConnectionsView from './views/DataConnectionsView';
import DealRegistrationOpsView from './views/DealRegistrationOpsView';
import ForecastingView from './views/ForecastingView';
import HomeView from './views/HomeView';
import PartnerPerformanceView from './views/PartnerPerformanceView';
import PartnerView from './views/PartnerView';
import ProductionRequirementsView from './views/ProductionRequirementsView';

// Every session action leaves one structured record (see lib/logging.ts), so a
// session can be replayed from the console; opportunity notes and next steps
// are user prose and are deliberately not logged.
const log = logger.child({ component: 'App' });

export default function App() {
  // The provider is the integration seam. Swap MockDataProvider for a
  // CRM-backed provider and everything below keeps working.
  const provider = useMemo(() => new MockDataProvider(), []);
  const { data, loading, error } = useDashboardData(provider);
  const [route, setRoute] = useState<Route>('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

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

  // Partner-team access and notifications. Roster patches are overrides keyed
  // by user id, additions are separate, and sent notifications are their own
  // log — the same shape as the other session edits, and the same gap a live
  // provider has to close by persisting them (see Data Connections).
  const [teamUserOverrides, setTeamUserOverrides] = useState<Record<string, Partial<TeamUser>>>({});
  const [addedTeamUsers, setAddedTeamUsers] = useState<TeamUser[]>([]);
  const [notifications, setNotifications] = useState<DashboardNotification[]>([]);
  const teamUserSeq = useRef(0);
  const notificationSeq = useRef(0);

  const partners = useMemo(
    () => [...(data?.partners ?? []), ...prospects],
    [data?.partners, prospects],
  );

  // The roster the whole app sees: the identity provider's projection with any
  // session status changes applied, plus anyone added this session.
  const teamUsers = useMemo(() => {
    const base = (data?.teamUsers ?? []).map((user) =>
      teamUserOverrides[user.id] ? { ...user, ...teamUserOverrides[user.id] } : user,
    );
    return [...base, ...addedTeamUsers];
  }, [data?.teamUsers, teamUserOverrides, addedTeamUsers]);

  const addedUserIds = useMemo(
    () => new Set(addedTeamUsers.map((user) => user.id)),
    [addedTeamUsers],
  );

  // Edited forecasts, notes, next steps, and called categories are folded into
  // the opportunity book itself, so every KPI, chart, and table in the app
  // reads the corrected figure rather than the one Salesforce supplied. The
  // weighted forecast therefore moves the moment a manager re-calls a deal.
  const opportunities = useMemo(() => {
    const book = data?.opportunities ?? [];
    return book.map((opportunity) => {
      const revenue = revenueOverrides[opportunity.id];
      const note = notes[opportunity.id];
      const nextStep = nextSteps[opportunity.id];
      const call = forecastCalls[opportunity.id];
      if (
        revenue === undefined &&
        note === undefined &&
        nextStep === undefined &&
        call === undefined
      ) {
        return opportunity;
      }
      return {
        ...opportunity,
        forecastedRevenue: revenue ?? opportunity.forecastedRevenue,
        notes: note ?? opportunity.notes,
        nextStep: nextStep ?? opportunity.nextStep,
        forecastCategory: call ?? opportunity.forecastCategory,
      };
    });
  }, [data?.opportunities, revenueOverrides, notes, nextSteps, forecastCalls]);

  // The single book every view renders: provider data plus in-app edits.
  const live = useMemo(
    () => (data ? { ...data, partners, opportunities, teamUsers } : null),
    [data, partners, opportunities, teamUsers],
  );

  const setRevenue = (opportunityId: string, value: number) => {
    log.debug('Revenue forecast edited', { opportunityId, revenue: value });
    setRevenueOverrides((prev) => ({ ...prev, [opportunityId]: value }));
  };

  const setNote = (opportunityId: string, note: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (note) next[opportunityId] = note;
      else delete next[opportunityId];
      return next;
    });
  };

  const setNextStep = (opportunityId: string, nextStep: string) => {
    setNextSteps((prev) => {
      const next = { ...prev };
      if (nextStep) next[opportunityId] = nextStep;
      else delete next[opportunityId];
      return next;
    });
  };

  const setForecastCall = (opportunityId: string, category: ForecastCategory) => {
    log.debug('Forecast call changed', { opportunityId, category });
    setForecastCalls((prev) => ({ ...prev, [opportunityId]: category }));
  };

  const commitClassifications = (next: Record<string, MeetingClassification>) =>
    setClassifications(next);

  const addPartner = (name: string, partnerManagerId: string) => {
    prospectSeq.current += 1;
    const id = `prospect-${prospectSeq.current}`;
    log.debug('Prospect partner added', { partnerId: id, name, partnerManagerId });
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

  // Adding puts a name on the roster awaiting authorization; authorizing is a
  // second step, which is how a real identity provider separates the two.
  const addTeamUser = (input: NewTeamUserInput) => {
    teamUserSeq.current += 1;
    log.debug('Team user invited', {
      name: input.name,
      email: input.email,
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
  // is delivered immediately because the demo has no service behind it.
  const sendNotification = (draft: NotificationDraft) => {
    notificationSeq.current += 1;
    const id = `notification-${notificationSeq.current}`;
    log.info('Notification sent', {
      notificationId: id,
      userId: draft.userId,
      kind: draft.kind,
      channels: draft.channels,
    });
    setNotifications((prev) => [
      {
        id,
        userId: draft.userId,
        kind: draft.kind,
        subject: draft.subject,
        body: draft.body,
        channels: draft.channels,
        sentAt: new Date().toISOString(),
        status: 'delivered',
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
        </div>
      </header>

      <div className="flex">
        <Sidebar
          collapsed={!sidebarOpen}
          mobileOpen={mobileNavOpen}
          route={route}
          onNavigate={(nextRoute) => {
            setRoute(nextRoute);
            setMobileNavOpen(false);
          }}
        />

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6">
          {error && <p className="rounded-card border border-ash p-4 text-sm text-bone">{error}</p>}
          {loading && (
            <p className="flex items-center gap-2 py-32 font-mono text-xs uppercase tracking-[0.08em] text-granite">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-signal" />
              Loading dashboard data
            </p>
          )}
          {live && (
            <>
              {route === 'home' && <HomeView data={live} classifications={classifications} />}
              {route === 'partners' && (
                <PartnerPerformanceView data={live} classifications={classifications} />
              )}
              {route === 'forecasting' && (
                <ForecastingView
                  data={live}
                  revenueOverrides={revenueOverrides}
                  notes={notes}
                  nextSteps={nextSteps}
                  onSetRevenue={setRevenue}
                  onSetNote={setNote}
                  onSetNextStep={setNextStep}
                  onSetForecastCall={setForecastCall}
                />
              )}
              {route === 'registration-ops' && <DealRegistrationOpsView data={live} />}
              {route === 'activity' && (
                <ActivityTrackingView
                  data={live}
                  classifications={classifications}
                  onCommitClassifications={commitClassifications}
                  onAddPartner={addPartner}
                />
              )}
              {route === 'partner-view' && <PartnerView data={live} />}
              {route === 'production-requirements' && <ProductionRequirementsView />}
              {route === 'data-connections' && (
                <DataConnectionsView
                  data={live}
                  addedUserIds={addedUserIds}
                  notifications={notifications}
                  onAddTeamUser={addTeamUser}
                  onSetTeamUserStatus={setTeamUserStatus}
                  onRemoveTeamUser={removeTeamUser}
                  onSendNotification={sendNotification}
                />
              )}
            </>
          )}
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
