import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-mono/400.css';
import App from '../../../src/App';
import { SNAPSHOT_DATE } from '../../../src/data/constants';
import { MockDataProvider } from '../../../src/data/mock/MockDataProvider';
import { generateDashboardData } from '../../../src/data/mock/generate';
import type { QueryResult } from '../../../src/data/queryMetadata';
import { startOfWeekUtc } from '../../../src/lib/fiscal';
import '../../../src/index.css';

type FixtureMethod = 'getTeamRoster' | 'listWeeklyClassificationMeetings';
type FixtureMode = 'hold' | 'empty' | 'partial';
declare global {
  interface Window {
    modalFixture: {
      calls: Partial<Record<FixtureMethod, number>>;
      pending: Partial<Record<FixtureMethod, boolean>>;
      arm: (method: FixtureMethod, mode: FixtureMode) => void;
      release: (method: FixtureMethod, fail?: boolean) => void;
      refreshRoster: () => void;
    };
  }
}

const scenario = new URLSearchParams(location.search).get('scenario');
const book = generateDashboardData();
if (scenario === 'meetings-paged') {
  const manager = book.partnerManagers[0];
  const sample = book.activities.find((meeting) => meeting.partnerManagerId === manager.id)!;
  const week = startOfWeekUtc(SNAPSHOT_DATE).getTime();
  book.activities = [
    ...book.activities.filter((meeting) => meeting.partnerManagerId !== manager.id),
    ...Array.from({ length: 30 }, (_, index) => ({
      ...sample,
      id: `fixture-meeting-${index}`,
      occurredAt: new Date(
        week + (index % 5) * 86_400_000 + (9 * 60 + Math.floor(index / 5) * 30) * 60_000,
      ).toISOString(),
    })),
  ];
}
const provider = new MockDataProvider(book);
const calls: Partial<Record<FixtureMethod, number>> = {};
const pendingStatus: Partial<Record<FixtureMethod, boolean>> = {};
const modes = new Map<FixtureMethod, FixtureMode>();
const pending = new Map<FixtureMethod, (fail: boolean) => void>();
window.modalFixture = {
  calls,
  pending: pendingStatus,
  arm: (method, mode) => modes.set(method, mode),
  release: (method, fail = false) => {
    const complete = pending.get(method);
    if (!complete) throw new Error(`No pending modal fixture query: ${method}`);
    pending.delete(method);
    pendingStatus[method] = false;
    complete(fail);
  },
  refreshRoster: () => {
    throw new Error('Workflow fixture adapter is not mounted');
  },
};

async function intercept<T>(
  method: FixtureMethod,
  run: () => Promise<QueryResult<T>>,
  empty: (data: T) => T,
): Promise<QueryResult<T>> {
  calls[method] = (calls[method] ?? 0) + 1;
  const mode = modes.get(method);
  modes.delete(method);
  if (mode === 'hold') {
    pendingStatus[method] = true;
    const fail = await new Promise<boolean>((complete) => pending.set(method, complete));
    if (fail) throw new Error('Isolated modal query failure');
  }
  const result = await run();
  return {
    ...result,
    data: mode === 'empty' ? empty(result.data) : result.data,
    meta:
      mode === 'partial'
        ? {
            ...result.meta,
            completeness: 'partial',
            warnings: [
              {
                code: 'unattributed-opportunities',
                message: 'Isolated scoped fixture: partial answer remains usable.',
              },
            ],
          }
        : result.meta,
  };
}
const team = provider.getTeamRoster.bind(provider);
provider.getTeamRoster = (...args) =>
  intercept(
    'getTeamRoster',
    () => team(...args),
    () => [],
  );
const calendar = provider.listWeeklyClassificationMeetings.bind(provider);
provider.listWeeklyClassificationMeetings = (...args) =>
  intercept(
    'listWeeklyClassificationMeetings',
    () => calendar(...args),
    (data) => ({
      ...data,
      rows: [],
      totalCount: 0,
      nextCursor: undefined,
    }),
  );
createRoot(document.getElementById('root')!).render(<App providerFactory={() => provider} />);
