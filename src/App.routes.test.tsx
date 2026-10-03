import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
// Cold lazy-chunk delivery belongs to the production-preview matrix.
import './views/system';
import './views/ActionCenterView';
import './components/WorkflowPanel';
import type { DataProvider } from './data/DataProvider';
import { MockDataProvider } from './data/mock/MockDataProvider';
import { ScaleDataProvider } from './data/mock/ScaleDataProvider';
import { generateDashboardData } from './data/mock/generate';
import { providerSessionBook } from './test/providerSessionFixtures';

/**
 * The provider-call matrix: what every route asks of the seam, and what one
 * failure costs it.
 *
 * - Every registered route, including Action Center, renders independently —
 *   including a 2× component fixture. The production-preview VAL-RES-011
 *   browser matrix separately exercises the genuine 100× provider.
 * - A route mounts with exactly its scoped queries and nothing else's; the
 *   app shell and the static routes (Production Requirements, the Data
 *   Connections catalog) issue no provider calls at all.
 * - One failed resource fails one widget: every sibling on the route keeps
 *   its data, and the widget's focused Retry repeats exactly the failed
 *   method — one more call of it, and not one more call of anything else.
 */

const nav = () => within(screen.getByRole('navigation', { name: 'Primary' }));

// Only immutable source records are shared: each test gets fresh cursors,
// failure controls, and call counters, independent of execution order.
const BASE_BOOK = generateDashboardData();

interface RouteSpec {
  label: string;
  /** h1 the route renders; null where the heading is data-driven. */
  heading: string | null;
  /** The full provider-method inventory the route may issue on mount. */
  methods: string[];
  /**
   * The method the failure matrix breaks, and the widget copy that proves
   * it. Static routes have no provider call to break, so they carry none.
   */
  failure?: {
    method: string;
    /** unavailable: no answer yet. refresh: stale data stays, failure named. */
    kind: 'unavailable' | 'refresh';
    text: string;
    retry: string;
  };
}

const ROUTES: RouteSpec[] = [
  {
    label: 'Action Center',
    heading: 'Action Center',
    methods: ['getActionCenterSummary', 'listActionItems'],
    failure: {
      method: 'getActionCenterSummary',
      kind: 'unavailable',
      text: 'Action Center summary unavailable:',
      retry: 'Retry Action Center summary',
    },
  },
  {
    label: 'Home',
    heading: 'Partner Performance Overview',
    methods: [
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getStageBreakdown',
      'getTopPartnerLeaders',
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
    // The certification query and the three registration-row queries are
    // deliberately absent here: the certification starts only when a
    // partner is selected (see the certification-gating tests in
    // usePartnerPerformanceQueries.test.ts), and the review queue,
    // exclusivity, and duplicates collections are drill-down-gated — the
    // default All Partners scope fires none of them.
    methods: [
      'getManagerDirectory',
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationFunnel',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getWeeklyActivitySeries',
      'getWeeklyGoalProgress',
      'listPartnerLeaderboard',
      'listScopedOpportunities',
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
      'listRecentRegistrations',
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
      'getPartnerRoster',
      'getPerformanceSummary',
      'getQuarterlyRevenueTrend',
      'getRegistrationOpsSummary',
      'getStageBreakdown',
      'getTopPartnerLeaders',
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
    // The connection catalog is static, like Production Requirements: the
    // map and the coverage counts render from the catalog alone, so the
    // route mounts without a single provider call.
    label: 'Data Connections',
    heading: 'Data Connections',
    methods: [],
  },
  {
    label: 'Settings',
    heading: 'Settings',
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
function instrumentedProvider(book = BASE_BOOK) {
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
  it('renders all ten routes independently under the scaled provider', async () => {
    // A populated, hand-built book keeps this a component wiring check.
    // Production-volume generation and bounds belong to the 100× browser proof.
    const book = providerSessionBook('SCALED');
    const user = await renderApp(new ScaleDataProvider(2, book));

    for (const route of [
      ...ROUTES,
      {
        label: 'Production Requirements',
        heading: 'Production Requirements',
        methods: [],
      },
    ]) {
      await visit(user, route);
      // The boundary renders this in place of a view that threw.
      expect(screen.queryByText('Something went wrong here')).not.toBeInTheDocument();
      // No widget failed: every route answers against this 2× component fixture.
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

  // Static routes have no provider call to fail, so the failure matrix covers
  // the routes that read the seam.
  const FAILURE_ROUTES = ROUTES.filter(
    (route): route is RouteSpec & { failure: NonNullable<RouteSpec['failure']> } =>
      route.failure !== undefined,
  );

  it.each(FAILURE_ROUTES)(
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
      const failure = screen.getByText(route.failure.text).closest('p')!;
      await user.click(within(failure).getByRole('button', { name: route.failure.retry }));

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

/**
 * The optional-resource matrix: some queries are enhancements a route can
 * degrade around — the Settings notification roster (the SLA digest carries
 * its own resolved owners), the Partner View ranking (the portal can open on
 * the roster's first partner), and the Home roster (the review queue falls
 * back to explicit partner ids). A failure of one of these must leave the
 * primary content live, name the failed resource, and offer a retry that
 * repeats exactly that method.
 */
interface OptionalResourceSpec {
  route: string;
  method: string;
  /** The retry button's accessible name. */
  retry: string;
  /** Waits for the named failure and proves the primary content stayed live. */
  expectFailure: () => Promise<void>;
  /** Optional interaction between the failure and the retry. */
  beforeRetry?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>;
  /** Post-retry recovery evidence; must not issue calls beyond the retry. */
  expectRecovered: () => Promise<void>;
}

/** The card whose heading carries this title. */
function cardWithTitle(title: string) {
  const heading = screen.getByRole('heading', { name: title });
  const card = heading.closest('section');
  if (!card) throw new Error(`no card titled "${title}"`);
  return within(card);
}

const OPTIONAL_RESOURCE_FAILURES: OptionalResourceSpec[] = [
  {
    route: 'Home',
    method: 'getPartnerRoster',
    retry: 'Retry partner roster',
    expectFailure: async () => {
      // The roster failure is named with the explicit id fallback while the
      // summary KPIs, leaderboard, and review queue keep rendering.
      const region = await screen.findByRole('group', { name: 'partner roster' });
      await within(region).findByText('Partner names unavailable — showing partner ids:');
      expect(within(region).getByText('Failed to load the partner roster')).toBeInTheDocument();
      expect(screen.queryByText('Performance summary unavailable:')).not.toBeInTheDocument();
      expect(screen.getByText('Kestrel Networks')).toBeInTheDocument();
      expect(
        cardWithTitle('Registrations awaiting review').getAllByText(/^p-\d+$/).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(/aligned partners/)).not.toBeInTheDocument();
    },
    expectRecovered: async () => {
      await waitFor(() =>
        expect(screen.queryByText(/Partner names unavailable/)).not.toBeInTheDocument(),
      );
      // The queue's partner column resolves to names and the header count
      // returns.
      expect(
        cardWithTitle('Registrations awaiting review').queryByText(/^p-\d+$/),
      ).not.toBeInTheDocument();
      expect(screen.getByText(/· 25 aligned partners/)).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'partner roster' })).toHaveFocus();
    },
  },
  {
    route: 'Partner View',
    method: 'getTopPartnerLeaders',
    retry: 'Retry partner ranking',
    expectFailure: async () => {
      // The portal does not wait on the failed ranking: it opens on the
      // roster's first partner, not the ranked leader, and names the failure.
      const region = await screen.findByRole('group', { name: 'partner ranking' });
      await within(region).findByText('Partner ranking unavailable:');
      expect(within(region).getByText('Failed to rank the partners')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', { name: 'Northwind Solutions', level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/viewing as/i)).toBeEnabled();
    },
    // The picker keeps working through the ranking failure; pinning an
    // explicit selection also keeps the recovered ranking from switching the
    // portal under the retry, so the call-count proof below is exact.
    beforeRetry: async (user) => {
      await user.selectOptions(screen.getByLabelText(/viewing as/i), ['p-02']);
      await screen.findByRole('heading', { name: 'BrightPath Consulting', level: 1 });
      await settle();
    },
    expectRecovered: async () => {
      await waitFor(() =>
        expect(screen.queryByText(/Partner ranking unavailable/)).not.toBeInTheDocument(),
      );
      // The explicit selection owns the portal; the recovered ranking does
      // not yank it back to the leader.
      expect(
        screen.getByRole('heading', { name: 'BrightPath Consulting', level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'partner ranking' })).toHaveFocus();
    },
  },
  {
    route: 'Settings',
    method: 'getTeamRoster',
    retry: 'Retry The team roster',
    expectFailure: async () => {
      // The roster-driven sections name the roster failure…
      await screen.findByText('The team roster unavailable:');
      expect(screen.getByText('The notification composer unavailable:')).toBeInTheDocument();
      // …while the SLA alert queue, which never needed the roster, stays
      // live: KPI counts, rows, and owner actions included.
      expect(screen.queryByText('The SLA alert queue unavailable:')).not.toBeInTheDocument();
      const queue = screen.getByRole('group', { name: 'The SLA alert queue' });
      await within(queue).findByText(/past the SLA/);
      expect(within(queue).getAllByRole('button', { name: 'Notify owner' }).length).toBeGreaterThan(
        0,
      );
      expect(within(queue).getByRole('button', { name: /^Notify all \d+ owners$/ })).toBeEnabled();
      const tile = screen.getByText('SLA alerts due').parentElement;
      if (!tile) throw new Error('no SLA alerts tile');
      expect(within(tile).getByText('17')).toBeInTheDocument();
    },
    expectRecovered: async () => {
      // The roster section recovers and the composer — which shares the
      // roster query — comes back without its own retry.
      const roster = screen.getByRole('group', { name: 'The team roster' });
      await within(roster).findAllByText('Alex Morgan');
      await waitFor(() => expect(screen.queryByText(/unavailable:/)).not.toBeInTheDocument());
      const composer = screen.getByRole('group', { name: 'The notification composer' });
      expect(within(composer).getByRole('button', { name: /^Send to / })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'The team roster' })).toHaveFocus();
    },
  },
];

describe('App route matrix: optional resource failures', () => {
  it.each(OPTIONAL_RESOURCE_FAILURES)(
    '$route: a failed $method keeps the primary content live and retries only that method',
    async (spec) => {
      const { provider, calls, control } = instrumentedProvider();
      const user = await renderApp(provider);
      await settle();

      // Same arming discipline as the primary matrix: the failure belongs to
      // the route under test, not the landing route's copies of the method.
      await user.click(nav().getByRole('button', { name: 'Production Requirements' }));
      await screen.findByRole('heading', { name: 'Production Requirements', level: 1 });
      control.failMethod = spec.method;
      control.armed = true;

      await user.click(nav().getByRole('button', { name: spec.route }));
      await spec.expectFailure();
      await settle();
      // The boundary never tripped: the route is alive around its failure.
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();

      if (spec.beforeRetry !== undefined) await spec.beforeRetry(user);
      const afterFailure = snapshot(calls);
      const region = screen.getByRole('group', { name: spec.retry.replace(/^Retry /, '') });
      await user.click(within(region).getByRole('button', { name: spec.retry }));

      await spec.expectRecovered();
      // The focused retry repeated exactly the failed method — one call of
      // it, and not one more call of anything else on the route.
      expect(diff(afterFailure, calls)).toEqual([spec.method]);
    },
    30_000,
  );
});
