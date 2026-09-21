import { useMemo, useRef, useState } from 'react';
import Sidebar, { type Route } from './components/Sidebar';
import { MenuIcon } from './components/icons';
import { SNAPSHOT_DATE } from './data/constants';
import { MockDataProvider } from './data/mock/MockDataProvider';
import type { MeetingClassification, Partner } from './data/types';
import { useDashboardData } from './data/useDashboardData';
import { formatDate } from './lib/format';
import ActivityTrackingView from './views/ActivityTrackingView';
import ForecastingView from './views/ForecastingView';
import HomeView from './views/HomeView';
import PartnerPerformanceView from './views/PartnerPerformanceView';

export default function App() {
  // The provider is the integration seam. Swap MockDataProvider for a
  // CRM-backed provider and everything below keeps working.
  const provider = useMemo(() => new MockDataProvider(), []);
  const { data, loading, error } = useDashboardData(provider);
  const [route, setRoute] = useState<Route>('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // In-app edits that override the CRM-backed mock data and re-render every
  // view live: forecast revenue deltas, opp notes, meeting classifications,
  // and prospect partners added from Log Meetings.
  const [revenueOverrides, setRevenueOverrides] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [classifications, setClassifications] = useState<Record<string, MeetingClassification>>({});
  // Only the prospects live in state; the provider's book stays the source of
  // truth, so this list cannot go stale while the data is still loading.
  const [prospects, setProspects] = useState<Partner[]>([]);
  const prospectSeq = useRef(0);

  const partners = useMemo(
    () => [...(data?.partners ?? []), ...prospects],
    [data?.partners, prospects],
  );

  // Edited forecasts and notes are folded into the opportunity book itself, so
  // every KPI, chart, and table in the app reads the corrected figure rather
  // than the one Salesforce supplied.
  const opportunities = useMemo(() => {
    const book = data?.opportunities ?? [];
    return book.map((opportunity) => {
      const revenue = revenueOverrides[opportunity.id];
      const note = notes[opportunity.id];
      if (revenue === undefined && note === undefined) return opportunity;
      return {
        ...opportunity,
        forecastedRevenue: revenue ?? opportunity.forecastedRevenue,
        notes: note ?? opportunity.notes,
      };
    });
  }, [data?.opportunities, revenueOverrides, notes]);

  // The single book every view renders: provider data plus in-app edits.
  const live = useMemo(
    () => (data ? { ...data, partners, opportunities } : null),
    [data, partners, opportunities],
  );

  const setRevenue = (opportunityId: string, value: number) =>
    setRevenueOverrides((prev) => ({ ...prev, [opportunityId]: value }));

  const setNote = (opportunityId: string, note: string) => {
    setNotes((prev) => {
      const next = { ...prev };
      if (note) next[opportunityId] = note;
      else delete next[opportunityId];
      return next;
    });
  };

  const commitClassifications = (next: Record<string, MeetingClassification>) =>
    setClassifications(next);

  const addPartner = (name: string, partnerManagerId: string) => {
    prospectSeq.current += 1;
    const id = `prospect-${prospectSeq.current}`;
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

  return (
    <div className="min-h-screen bg-canvas font-sans text-bone">
      <header className="sticky top-0 z-20 border-b border-carbon bg-canvas">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen((open) => !open)}
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
        <Sidebar collapsed={!sidebarOpen} route={route} onNavigate={setRoute} />

        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6">
          {error && (
            <p className="rounded-card border border-ash p-4 text-sm text-bone">{error}</p>
          )}
          {loading && (
            <p className="flex items-center gap-2 py-32 font-mono text-xs uppercase tracking-[0.08em] text-granite">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-signal" />
              Loading dashboard data
            </p>
          )}
          {live && (
            <>
              {route === 'home' && (
                <HomeView data={live} classifications={classifications} />
              )}
              {route === 'partners' && (
                <PartnerPerformanceView data={live} classifications={classifications} />
              )}
              {route === 'forecasting' && (
                <ForecastingView
                  data={live}
                  revenueOverrides={revenueOverrides}
                  notes={notes}
                  onSetRevenue={setRevenue}
                  onSetNote={setNote}
                />
              )}
              {route === 'activity' && (
                <ActivityTrackingView
                  data={live}
                  classifications={classifications}
                  onCommitClassifications={commitClassifications}
                  onAddPartner={addPartner}
                />
              )}
            </>
          )}
        </main>
      </div>

      <footer className="p-6">
        <p className="font-mono text-xs text-granite">
          Mock data · deterministic snapshot as of {formatDate(SNAPSHOT_DATE.toISOString())} ·
          edits stay in-app for this session
        </p>
      </footer>
    </div>
  );
}
