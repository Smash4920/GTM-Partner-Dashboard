import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import type { DataProvider } from './data/DataProvider';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { ScaleDataProvider } from './data/mock/ScaleDataProvider';
import { generateDashboardData } from './data/mock/generate';

/**
 * The provider-call matrix: what every route asks of the seam, and what one
 * failure costs it.
 *
 * - Every route that exists before Action Center renders independently —
 *   including under the 100× provider, which is the scale the retired
 *   whole-book contract could not survive.
 * - A route mounts with exactly its scoped queries and nothing else's; the
 *   app shell and Production Requirements issue no provider calls at all.
 * - One failed resource fails one widget: every sibling on the route keeps
 *   its data, and the widget's focused Retry repeats exactly the failed
 *   method — one more call of it, and not one more call of anything else.
 */

const nav = () => within(screen.getByRole('navigation', { name: 'Primary' }));

interface RouteSpec {
  label: string;
  /** h1 the route renders; null where the heading is data-driven. */
  heading: string | null;
  /** The full provider-method inventory the route may issue on mount. */
  methods: string[];
  /** The method the failure matrix breaks, and the widget copy that proves it. */
  failure: {
    method: string;
    /** unavailable: no answer yet. refresh: stale data stays, failure named. */
    kind: 'unavailable' | 'refresh';
    text: string;
    retry: string;
  };
}

const ROUTES: RouteSpec[] = [
  {
    label: 'Home',
    heading: 'Partner Performance Overview',
    methods: [
      'getPartnerLeaderboard',
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getStageBreakdown',
      'getTypeBreakdown',
      'getWeeklyActivitySeries',
      'listPendingRegistrations',
    ],
    failure: {
      method: 'getPerformanceSummary',
      kind: 'unavailable',
      text: 'Performance summary unavailable:',
      retry: 'Retry performance summary',
    },
  },
  {
    label: 'Partner Performance',
    heading: 'Partner Performance',
    methods: [
      'getManagerDirectory',
      'getPartnerCertification',
      'getPartnerLeaderboard',
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getWeeklyActivitySeries',
      'getWeeklyGoalProgress',
      'listDuplicateRegistrationGroups',
      'listPendingRegistrations',
      'listScopedOpportunities',
      'listUnconvertedRegistrations',
    ],
    failure: {
      method: 'getPerformanceSummary',
      kind: 'unavailable',
      text: 'Performance summary unavailable:',
      retry: 'Retry performance summary',
    },
  },
  {
    label: 'Forecasting',
    heading: 'Forecasting',
    methods: [
      'getForecastQuality',
      'getForecastSummary',
      'getManagerForecastGroups',
      'getPartnerDirectory',
      'getWeeklyForecastSeries',
      'getWeightedForecast',
      'listQuarterOpportunities',
    ],
    failure: {
      method: 'getWeeklyForecastSeries',
      kind: 'unavailable',
      text: 'Weekly series unavailable:',
      retry: 'Retry weekly series',
    },
  },
  {
    label: 'Deal Reg Ops',
    heading: 'Deal Registration Operations',
    methods: [
      'getPartnerRoster',
      'getRegistrationOpsSummary',
      'listDuplicateRegistrationGroups',
      'listPendingRegistrations',
      'listUnconvertedRegistrations',
    ],
    failure: {
      method: 'listPendingRegistrations',
      kind: 'unavailable',
      text: 'Review queue unavailable:',
      retry: 'Retry review queue',
    },
  },
  {
    label: 'Activity Tracking',
    heading: 'Activity Tracking',
    methods: [
      'getManagerDirectory',
      'getPartnerRoster',
      'getWeeklyActivitySeries',
      'getWeeklyGoalProgress',
      'listWeeklyClassificationMeetings',
    ],
    failure: {
      method: 'getWeeklyGoalProgress',
      // The goal waits for the directory, so its first call already carries
      // the resolved manager's scope: the armed failure is an initial
      // failure, and the widget is unavailable — no org-wide placeholder
      // exists behind it to keep on screen.
      kind: 'unavailable',
      text: 'Weekly goal unavailable:',
      retry: 'Retry weekly goal',
    },
  },
  {
    label: 'Partner View',
    heading: null,
    methods: [
      'getPartnerCertification',
      'getPartnerLeaderboard',
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getTypeBreakdown',
      'listRecentRegistrations',
      'listScopedOpportunities',
      'listUnconvertedRegistrations',
    ],
    failure: {
      method: 'getPerformanceSummary',
      kind: 'unavailable',
      text: 'Performance summary unavailable:',
      retry: 'Retry performance summary',
    },
  },
  {
    label: 'Data Connections',
    heading: 'Data Connections',
    methods: [
      'getManagerDirectory',
      'getPartnerRoster',
      'getRegistrationSlaAlerts',
      'getTeamRoster',
      'listRecentRegistrations',
    ],
    failure: {
      method: 'getRegistrationSlaAlerts',
      kind: 'unavailable',
      text: 'The SLA alert queue unavailable:',
      retry: 'Retry The SLA alert queue',
    },
  },
];

/**
 * A provider that counts every method call and, once armed, fails the next
 * call of one named method — after which it serves normally, so the widget's
 * own Retry is what recovers it.
 */
function instrumentedProvider(book = generateDashboardData()) {
  const inner = new MockDataProvider(book);
  const calls = new Map<string, number>();
  const control: { armed: boolean; failMethod: string } = {
    armed: false,
    failMethod: '',
  };
  const provider = new Proxy(inner, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof prop !== 'string' || typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        calls.set(prop, (calls.get(prop) ?? 0) + 1);
        if (control.armed && prop === control.failMethod) {
          // Spend the failure: the arm is one broken resource, once.
          control.armed = false;
          return Promise.reject(new Error(`${prop} failed in transit (simulated)`));
        }
        return (value as (...fnArgs: unknown[]) => unknown).apply(target, args);
      };
    },
  }) as DataProvider;
  return { provider, calls, control };
}

function snapshot(calls: Map<string, number>): Map<string, number> {
  return new Map(calls);
}

/** The calls made between two snapshots, as a sorted method list. */
function diff(before: Map<string, number>, after: Map<string, number>): string[] {
  const grew: string[] = [];
  for (const [method, count] of after) {
    if (count > (before.get(method) ?? 0)) grew.push(method);
  }
  return grew.sort();
}

async function renderApp(provider: DataProvider) {
  const user = userEvent.setup();
  render(<App providerFactory={() => provider} />);
  await screen.findByRole(
    'heading',
    { name: 'Partner Performance Overview', level: 1 },
    { timeout: 10_000 },
  );
  return user;
}

/** Wait until no widget on screen is still in its initial loading state. */
async function settle() {
  await waitFor(() => expect(screen.queryAllByText(/^Loading /)).toHaveLength(0), {
    timeout: 10_000,
  });
}

async function visit(user: ReturnType<typeof userEvent.setup>, route: RouteSpec) {
  await user.click(nav().getByRole('button', { name: route.label }));
  if (route.heading !== null) {
    await screen.findByRole('heading', { name: route.heading, level: 1 }, { timeout: 10_000 });
  } else {
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 1 })).not.toHaveLength(0), {
      timeout: 10_000,
    });
  }
  await settle();
}

describe('App route matrix', () => {
  it('renders all eight routes independently under the scaled provider', async () => {
    const book = generateDashboardData();
    const user = await renderApp(new ScaleDataProvider(2, book));

    for (const route of [
      ...ROUTES,
      {
        label: 'Production Requirements',
        heading: 'Production Requirements',
        methods: [],
        failure: { method: '', kind: 'unavailable' as const, text: '', retry: '' },
      },
    ]) {
      await visit(user, route);
      // The boundary renders this in place of a view that threw.
      expect(screen.queryByText('Something went wrong here')).not.toBeInTheDocument();
      // No widget failed: at 100×-per-copy volume every route still answers.
      expect(screen.queryByText(/unavailable:/)).not.toBeInTheDocument();
    }
  }, 60_000);

  it('the shell and Production Requirements issue no provider calls at all', async () => {
    const { provider, calls } = instrumentedProvider();
    const user = await renderApp(provider);
    await settle();
    const afterHome = snapshot(calls);

    await user.click(nav().getByRole('button', { name: 'Production Requirements' }));
    await screen.findByRole('heading', { name: 'Production Requirements', level: 1 });

    // A static route mounts without a single provider call.
    expect(diff(afterHome, calls)).toEqual([]);
  });

  it.each(ROUTES)('$label mounts with exactly its scoped queries', async (route) => {
    const { provider, calls } = instrumentedProvider();
    const user = await renderApp(provider);
    await settle();

    // Baseline on the static route so the diff is this route's mount alone.
    await user.click(nav().getByRole('button', { name: 'Production Requirements' }));
    await screen.findByRole('heading', { name: 'Production Requirements', level: 1 });
    const before = snapshot(calls);

    await visit(user, route);
    expect(diff(before, calls)).toEqual([...route.methods].sort());
  });

  it.each(ROUTES)(
    '$label: one failed resource fails one widget, and Retry repeats only that method',
    async (route) => {
      const { provider, calls, control } = instrumentedProvider();
      const user = await renderApp(provider);
      await settle();

      // Leave the landing route before arming: the failure belongs to the
      // route under test, however the two routes happen to share methods,
      // and re-selecting the current route is a no-op rather than a remount.
      await user.click(nav().getByRole('button', { name: 'Production Requirements' }));
      await screen.findByRole('heading', { name: 'Production Requirements', level: 1 });
      control.failMethod = route.failure.method;
      control.armed = true;

      await user.click(nav().getByRole('button', { name: route.label }));
      await screen.findByText(route.failure.text, undefined, { timeout: 10_000 });
      await settle();

      // One failed resource, one failed widget: every sibling answered.
      expect(screen.queryAllByText(/unavailable:/)).toHaveLength(
        route.failure.kind === 'unavailable' ? 1 : 0,
      );
      if (route.failure.kind === 'refresh') {
        expect(screen.queryAllByText(/refresh failed:/)).toHaveLength(1);
      }
      // The boundary never tripped: the route is alive around its failure.
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();

      const afterFailure = snapshot(calls);
      await user.click(screen.getByRole('button', { name: route.failure.retry }));

      // Recovery: the widget's data replaces the failure copy.
      await waitFor(() => expect(screen.queryByText(route.failure.text)).not.toBeInTheDocument(), {
        timeout: 10_000,
      });

      // The focused retry repeated exactly the failed method — one call of
      // it, and not one more call of anything else on the route.
      expect(diff(afterFailure, calls)).toEqual([route.failure.method]);
    },
    30_000,
  );
});
