import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-mono/400.css';
import App from '../../../src/App';
import { MockDataProvider } from '../../../src/data/mock/MockDataProvider';
import { generateDashboardData } from '../../../src/data/mock/generate';
import type { QueryResult } from '../../../src/data/queryMetadata';
import '../../../src/index.css';

type FixtureMode = 'hold' | 'fail' | 'partial';
type FixtureMethod =
  | 'getTeamRoster'
  | 'getPartnerRoster'
  | 'listRecentRegistrations'
  | 'getRegistrationSlaAlerts'
  | 'getManagerDirectory';

declare global {
  interface Window {
    inlineNotificationFixture: {
      calls: Partial<Record<FixtureMethod, number>>;
      completeness: Partial<Record<FixtureMethod, 'complete' | 'partial'>>;
      arm: (method: FixtureMethod, mode: FixtureMode) => void;
      release: (method: FixtureMethod, fail?: boolean) => void;
    };
  }
}

// This input is production-built independently, never imported by src/main.
// Only bounded scoped results are exposed to tests; the book remains private.
const scenario = new URLSearchParams(location.search).get('scenario');
const book = generateDashboardData();
if (scenario === 'empty-roster') book.teamUsers = [];
if (scenario === 'ineligible') {
  book.teamUsers = book.teamUsers.map((user, index) => ({
    ...user,
    status: index % 2 === 0 ? 'invited' : 'suspended',
  }));
}
if (scenario === 'no-channels') {
  book.teamUsers = book.teamUsers.map((user) => ({ ...user, status: 'active', channels: [] }));
}
const provider = new MockDataProvider(book);
const calls: Partial<Record<FixtureMethod, number>> = {};
const completeness: Partial<Record<FixtureMethod, 'complete' | 'partial'>> = {};
const modes = new Map<FixtureMethod, FixtureMode>();
const pending = new Map<FixtureMethod, (fail: boolean) => void>();
window.inlineNotificationFixture = {
  calls,
  completeness,
  arm: (method, mode) => modes.set(method, mode),
  release: (method, fail = false) => {
    const complete = pending.get(method);
    if (!complete) throw new Error(`No pending fixture query: ${method}`);
    pending.delete(method);
    complete(fail);
  },
};

async function intercept<T extends QueryResult<unknown>>(
  method: FixtureMethod,
  run: () => Promise<T>,
): Promise<T> {
  calls[method] = (calls[method] ?? 0) + 1;
  const mode = modes.get(method);
  modes.delete(method);
  const fail =
    mode === 'hold'
      ? await new Promise<boolean>((complete) => pending.set(method, complete))
      : mode === 'fail';
  if (fail) throw new Error('Isolated notification query failure');
  const result = await run();
  completeness[method] = mode === 'partial' ? 'partial' : result.meta.completeness;
  return mode === 'partial'
    ? {
        ...result,
        meta: {
          ...result.meta,
          completeness: 'partial',
          warnings: [
            {
              code: 'unattributed-opportunities',
              message: 'Fixture: one record has no manager attribution; scoped rows remain usable.',
            },
          ],
        },
      }
    : result;
}

const team = provider.getTeamRoster.bind(provider);
provider.getTeamRoster = (...args) =>
  intercept('getTeamRoster', async () => {
    const result = await team(...args);
    // Stale routed-action evidence with a roster that cannot resolve its
    // recipient reaches the panel's otherwise unavailable no-recipient branch.
    return scenario === 'missing-recipient' ? { ...result, data: [] } : result;
  });
const partners = provider.getPartnerRoster.bind(provider);
provider.getPartnerRoster = (...args) => intercept('getPartnerRoster', () => partners(...args));
const registrations = provider.listRecentRegistrations.bind(provider);
provider.listRecentRegistrations = (...args) =>
  intercept('listRecentRegistrations', () => registrations(...args));
const alerts = provider.getRegistrationSlaAlerts.bind(provider);
provider.getRegistrationSlaAlerts = (...args) =>
  intercept('getRegistrationSlaAlerts', () => alerts(...args));
const managers = provider.getManagerDirectory.bind(provider);
provider.getManagerDirectory = (...args) =>
  intercept('getManagerDirectory', () => managers(...args));

createRoot(document.getElementById('root')!).render(<App providerFactory={() => provider} />);
