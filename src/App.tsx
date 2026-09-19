import { useMemo, useState } from 'react';
import { SNAPSHOT_DATE } from './data/constants';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { useDashboardData } from './data/useDashboardData';
import { formatDate } from './lib/format';
import LeadershipView from './views/LeadershipView';
import PartnerView from './views/PartnerView';

type View = 'leadership' | 'partner';

const VIEW_TABS: { id: View; label: string }[] = [
  { id: 'leadership', label: 'GTM Leadership' },
  { id: 'partner', label: 'Partner Portal' },
];

export default function App() {
  // The provider is the integration seam. Swap MockDataProvider for a
  // CRM-backed provider and everything below keeps working.
  const provider = useMemo(() => new MockDataProvider(), []);
  const { data, loading, error } = useDashboardData(provider);
  const [view, setView] = useState<View>('leadership');

  return (
    <div className="min-h-screen bg-canvas font-sans text-bone">
      <header className="sticky top-0 z-10 border-b border-carbon bg-canvas">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-6 px-6">
          <div className="flex items-center gap-3">
            <span className="inline-block h-2 w-2 rounded-full bg-signal" />
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-bone">
              GTM Partner Dashboard
            </span>
          </div>
          <nav className="ml-auto flex items-center gap-1 rounded bg-carbon p-1">
            {VIEW_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setView(tab.id)}
                className={`rounded px-3 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors duration-150 ${
                  view === tab.id
                    ? 'bg-ash text-bone'
                    : 'text-granite hover:text-stone'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-6 py-10">
        {error && (
          <p className="rounded-card border border-ash p-4 text-sm text-bone">{error}</p>
        )}
        {loading && (
          <p className="flex items-center gap-2 py-32 font-mono text-xs uppercase tracking-[0.08em] text-granite">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-signal" />
            Loading dashboard data
          </p>
        )}
        {data && view === 'leadership' && <LeadershipView data={data} />}
        {data && view === 'partner' && <PartnerView data={data} />}
      </main>

      <footer className="mx-auto max-w-[1200px] px-6 pb-12">
        <p className="font-mono text-xs text-granite">
          Mock data · deterministic snapshot as of {formatDate(SNAPSHOT_DATE.toISOString())}
        </p>
      </footer>
    </div>
  );
}
