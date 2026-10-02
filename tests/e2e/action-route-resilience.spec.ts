import { expect, test, type Locator, type Page } from '@playwright/test';
import { DATA_PROVIDER_METHODS } from '../../src/data/DataProvider';
import { INTERNAL_DEMO_SCOPE } from '../../src/data/accessScope';
import { CURRENT_FISCAL_QUARTER } from '../../src/data/constants';
import { MockDataProvider } from '../../src/data/mock/MockDataProvider';
import { formatUsdCompact } from '../../src/lib/format';

/**
 * Run against a production preview with VITE_LOG_LEVEL=debug. This uses the
 * existing structured seam logs, not an injected provider or runtime fixture.
 * Debug logging is necessary to prove successful call counts as well as failures.
 */
const navigation = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const actionRows = (page: Page) => page.getByTestId('action-item');
const LEGACY_METHOD =
  /^(listPartners|listOpportunities|listRegistrations|listActivities|listTargets|listCertifications|listPipelineSnapshots|loadBook|useDashboardData)$/;

function observe(page: Page) {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const requests: string[] = [];
  const started: string[] = [];
  const pending: Promise<void>[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
    for (const argument of message.args()) {
      pending.push(
        argument.jsonValue().then((value: unknown) => {
          if (typeof value !== 'object' || value === null) return;
          const record = value as Record<string, unknown>;
          if (record.component !== 'DataProvider' || typeof record.operation !== 'string') return;
          if (record.msg === 'Provider request started') started.push(record.operation);
        }),
      );
    }
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
  return {
    errors,
    pageErrors,
    requests,
    started,
    async flush() {
      await Promise.all(pending);
    },
  };
}

type Observations = ReturnType<typeof observe>;

async function settle(page: Page, observations: Observations) {
  await expect(page.getByText(/^Loading /)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Updating', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/· updating/)).toHaveCount(0);
  await observations.flush();
}

function expectSafePreview(page: Page, observations: Observations, failures: string[] = []) {
  const origin = new URL(page.url()).origin;
  expect(
    observations.requests.filter(
      (url) => !url.startsWith(`${origin}/`) && !/^(data|blob):/.test(url),
    ),
  ).toEqual([]);
  expect(
    observations.requests.filter((url) => /\/@vite\/client|\/src\/|\/@react-refresh/.test(url)),
  ).toEqual([]);
  expect(observations.pageErrors).toEqual([]);
  expect(
    observations.errors.filter(
      (text) =>
        !failures.some((method) => text.includes(`component: DataProvider, operation: ${method},`)),
    ),
  ).toEqual([]);
  expect(
    observations.started.length,
    'Build the preview with VITE_LOG_LEVEL=debug',
  ).toBeGreaterThan(0);
  expect(observations.started.filter((method) => LEGACY_METHOD.test(method))).toEqual([]);
  expect(
    observations.started.filter(
      (method) => !(DATA_PROVIDER_METHODS as readonly string[]).includes(method),
    ),
  ).toEqual([]);
}

async function visit(page: Page, route: string, heading = route) {
  await navigation(page).getByRole('button', { name: route, exact: true }).click();
  if (route === 'Partner View') {
    await expect(page.getByLabel('Viewing as')).toBeEnabled();
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  } else {
    await expect(page.getByRole('heading', { name: heading, exact: true, level: 1 })).toBeVisible();
  }
}

async function bootOnStaticRoute(page: Page, observations: Observations, plan?: string) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview', level: 1 }),
  ).toBeVisible();
  await settle(page, observations);
  if (plan !== undefined) {
    const url = new URL(page.url());
    url.searchParams.set('remoteFailMethods', plan);
    await page.goto(url.href);
  }
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview', level: 1 }),
  ).toBeVisible();
  await settle(page, observations);
  await visit(page, 'Production Requirements');
  await settle(page, observations);
}

async function remote(page: Page) {
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();
  // A provider commit relabels the last health artifact without pinging again.
  // Assess the new seam through its existing public refresh handle before
  // taking route call snapshots, rather than trusting the old provider's check.
  await expect
    .poll(() => page.evaluate(() => window.GTM_HEALTH?.artifact.providerId))
    .toBe('remote');
  await page.evaluate(() => window.GTM_HEALTH?.refresh());
}

function card(page: Page, title: string) {
  return page
    .getByRole('heading', { name: title, exact: true })
    .locator('xpath=ancestor::section[1]');
}

async function ids(rows: Locator, attribute: string) {
  const values = await rows.evaluateAll(
    (elements, name) => elements.map((element) => element.getAttribute(name)),
    attribute,
  );
  expect(values.every((value) => typeof value === 'string' && value.length > 0)).toBe(true);
  expect(new Set(values).size).toBe(values.length);
  return values;
}

async function expectOnlyCalls(observations: Observations, before: number, methods: string[]) {
  await observations.flush();
  expect(observations.started.slice(before).sort()).toEqual([...methods].sort());
}

interface FailureRoute {
  route: string;
  heading?: string;
  method: string;
  region: string;
  failure: string;
  retry: string;
  sibling: (page: Page) => Promise<void>;
}

const FAILURE_ROUTES: FailureRoute[] = [
  {
    route: 'Forecasting',
    method: 'getWeeklyForecastSeries',
    region: 'weekly series',
    failure: 'Weekly series unavailable:',
    retry: 'Retry weekly series',
    sibling: async (page) => {
      await expect(page.getByText('Weighted forecast', { exact: true }).first()).toBeVisible();
      const book = page.getByRole('region', { name: /^In-quarter opportunities/ });
      await expect(book.locator('tbody tr').first()).toBeVisible();
      const toggle = page.getByRole('button', { expanded: true }).filter({ hasText: /opps/ });
      await toggle.click();
      await expect(book).toBeHidden();
      await page
        .getByRole('button', { expanded: false })
        .filter({ hasText: /opps/ })
        .first()
        .click();
      await expect(book).toBeVisible();
    },
  },
  {
    route: 'Home',
    heading: 'Partner Performance Overview',
    method: 'getPerformanceSummary',
    region: 'performance summary',
    failure: 'Performance summary unavailable:',
    retry: 'Retry performance summary',
    sibling: async (page) => {
      const funnel = card(page, 'Deal registration funnel');
      await funnel.getByRole('button', { name: 'Count', exact: true }).click();
      await expect(funnel.getByText('51', { exact: true })).toBeVisible();
      await expect(page.getByText('Kestrel Networks', { exact: true }).first()).toBeVisible();
    },
  },
  {
    route: 'Partner Performance',
    method: 'getPerformanceSummary',
    region: 'performance summary',
    failure: 'Performance summary unavailable:',
    retry: 'Retry performance summary',
    sibling: async (page) => {
      const pipeline = page.getByRole('group', { name: 'pipeline opportunities', exact: true });
      await expect(pipeline.getByText('Showing 25 of 65')).toBeVisible();
      await pipeline.getByRole('button', { name: 'Load 25 more', exact: true }).click();
      await expect(pipeline.getByText('Showing 50 of 65')).toBeVisible();
    },
  },
  {
    route: 'Deal Reg Ops',
    heading: 'Deal Registration Operations',
    method: 'getPartnerRoster',
    region: 'partner roster',
    failure: 'Partner names unavailable — showing partner ids:',
    retry: 'Retry partner roster',
    sibling: async (page) => {
      const queue = page.getByRole('group', { name: 'review queue', exact: true });
      await expect(queue.getByText('Showing 10 of 18 pending')).toBeVisible();
      await expect(queue.locator('td', { hasText: /^p-\d+$/ }).first()).toBeVisible();
      await queue.getByRole('button', { name: 'Load 10 more', exact: true }).click();
      await expect(queue.getByText('Showing 18 of 18 pending')).toBeVisible();
    },
  },
  {
    route: 'Activity Tracking',
    method: 'getWeeklyGoalProgress',
    region: 'weekly goal',
    failure: 'Weekly goal unavailable:',
    retry: 'Retry weekly goal',
    sibling: async (page) => {
      await expect(page.getByText('30 meetings in scope')).toBeVisible();
      await page.getByRole('button', { name: 'Log Meetings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /Log meetings ·/ });
      await expect(dialog.getByText('Showing 10 of 10 meeting calendar')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    },
  },
  {
    route: 'Partner View',
    method: 'getTopPartnerLeaders',
    region: 'partner ranking',
    failure: 'Partner ranking unavailable:',
    retry: 'Retry partner ranking',
    sibling: async (page) => {
      await expect(
        page.getByRole('heading', { name: 'Northwind Solutions', level: 1 }),
      ).toBeVisible();
      await page.getByLabel('Viewing as').selectOption('p-02');
      await expect(
        page.getByRole('heading', { name: 'BrightPath Consulting', level: 1 }),
      ).toBeVisible();
      await expect(page.getByText('Open pipeline', { exact: true })).toBeVisible();
    },
  },
  {
    route: 'Data Connections',
    method: 'getTeamRoster',
    region: 'The team roster',
    failure: 'The team roster unavailable:',
    retry: 'Retry The team roster',
    sibling: async (page) => {
      const queue = page.getByRole('group', { name: 'The SLA alert queue', exact: true });
      await expect(
        queue.getByRole('button', { name: 'Notify owner', exact: true }).first(),
      ).toBeEnabled();
      await page.getByRole('button', { name: /^Salesforce/ }).click();
      await expect(page.getByRole('heading', { name: 'Salesforce', level: 3 })).toBeVisible();
    },
  },
  {
    route: 'Action Center',
    method: 'getActionCenterSummary',
    region: 'Action Center summary',
    failure: 'Action Center summary unavailable:',
    retry: 'Retry Action Center summary',
    sibling: async (page) => {
      await expect(actionRows(page)).toHaveCount(25);
      await page.getByRole('button', { name: 'Load 25 more', exact: true }).click();
      await expect(actionRows(page)).toHaveCount(50);
      await expect(page.getByText('Showing 50 of 85 action items')).toBeVisible();
    },
  },
];

test('VAL-DATA-001 VAL-RES-002 VAL-RES-006: Forecast manager change never relabels prior summary or metadata after failure and focused retry', async ({
  page,
}) => {
  const observations = observe(page);
  // Readiness, health refresh, org and pm-01 succeed; pm-02's first answer fails.
  await bootOnStaticRoute(page, observations, 'getForecastSummary:4:1');
  await remote(page);
  await visit(page, 'Forecasting');
  await settle(page, observations);
  const manager = page.getByRole('combobox', { name: 'Partner manager', exact: true });
  const summary = page.getByRole('group', { name: 'forecast summary', exact: true });
  const weighted = page.getByRole('group', { name: 'weighted forecast', exact: true });
  const weeks = page.getByRole('group', { name: 'weekly series', exact: true });
  await manager.selectOption('pm-01');
  await settle(page, observations);
  const previousSummary = await summary.textContent();
  const weightedText = await weighted.textContent();
  const weeklyText = await weeks.textContent();
  const before = observations.started.length;
  await manager.selectOption('pm-02');
  // Whether still pending or already failed, the prior answer has disappeared.
  await expect(summary.getByText('Partner sourced pipeline', { exact: true })).toHaveCount(0);
  await expect(summary.getByText(/As of .*provider remote/)).toHaveCount(0);
  await expect(summary).not.toHaveText(previousSummary ?? '');
  await expect(summary.getByText('Forecast summary unavailable:', { exact: true })).toBeVisible();
  await expect(
    summary.getByText('Latest forecast summary refresh failed:', { exact: true }),
  ).toHaveCount(0);
  await expect(weighted).toHaveText(weightedText ?? '');
  await expect(weeks).toHaveText(weeklyText ?? '');
  await settle(page, observations);
  expect(
    observations.started.slice(before).filter((method) => method !== 'listQuarterOpportunities'),
  ).toEqual(['getForecastSummary']);

  const retryBefore = observations.started.length;
  await summary.getByRole('button', { name: 'Retry forecast summary', exact: true }).click();
  await settle(page, observations);
  const expected = (
    await new MockDataProvider().getForecastSummary(INTERNAL_DEMO_SCOPE, {
      quarter: CURRENT_FISCAL_QUARTER,
      partnerManagerId: 'pm-02',
    })
  ).data;
  await expect(
    summary
      .getByText('Partner sourced pipeline', { exact: true })
      .locator('..')
      .locator('p')
      .nth(1),
  ).toHaveText(formatUsdCompact(expected.openPipelineValue));
  await expect(summary.getByText(/As of .*provider remote/)).toBeVisible();
  await expect(summary).toBeFocused();
  await expectOnlyCalls(observations, retryBefore, ['getForecastSummary']);
  await expect(weighted).toHaveText(weightedText ?? '');
  await expect(weeks).toHaveText(weeklyText ?? '');
  expectSafePreview(page, observations, ['getForecastSummary']);
});

for (const spec of FAILURE_ROUTES) {
  test(`VAL-RES-009: ${spec.route} names its controlled failure, keeps siblings interactive and retries only that query with focus`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const observations = observe(page);
    // The remote commits on a static route: landing Home cannot spend a
    // shared method's failure before the route under test mounts.
    await bootOnStaticRoute(page, observations, `${spec.method}:1`);
    await remote(page);
    await visit(page, spec.route, spec.heading);
    const region = page.getByRole('group', { name: spec.region, exact: true });
    await expect(region.getByText(spec.failure, { exact: true })).toBeVisible();
    await settle(page, observations);
    await spec.sibling(page);
    await settle(page, observations);
    await expect(region.getByText(spec.failure, { exact: true })).toBeVisible();
    await expect(page.getByText(/failed in transit|Something went wrong here/)).toHaveCount(0);

    const before = observations.started.length;
    await region.getByRole('button', { name: spec.retry, exact: true }).click();
    await expect(region.getByText(spec.failure, { exact: true })).toHaveCount(0);
    await expect(region).toBeFocused();
    await settle(page, observations);
    await expectOnlyCalls(observations, before, [spec.method]);
    expect(
      observations.errors.filter((text) => text.includes(`operation: ${spec.method},`)),
    ).toHaveLength(1);
    expectSafePreview(page, observations, [spec.method]);
  });
}

test('VAL-RES-009: total named Data Connections failure leaves Production Requirements and the catalog usable', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const observations = observe(page);
  const methods = [
    'getManagerDirectory',
    'getPartnerRoster',
    'getRegistrationSlaAlerts',
    'getTeamRoster',
    'listRecentRegistrations',
  ];
  await bootOnStaticRoute(page, observations, methods.map((method) => `${method}:1`).join(','));
  await remote(page);
  await visit(page, 'Data Connections');
  await expect(page.getByText('The team roster unavailable:', { exact: true })).toBeVisible();
  await expect(page.getByText('The SLA alert queue unavailable:', { exact: true })).toBeVisible();
  await expect(
    page.getByText('The notification composer unavailable:', { exact: true }),
  ).toBeVisible();
  await settle(page, observations);
  for (const label of [/^Salesforce/, /^Identity provider \(SSO\)/, /^Notification service/]) {
    await page.getByRole('button', { name: label }).click();
    await expect(page.getByText('What is missing', { exact: true })).toBeVisible();
  }
  const before = observations.started.length;
  await visit(page, 'Production Requirements');
  await settle(page, observations);
  await expectOnlyCalls(observations, before, []);
  await expect(page.getByText(/failed in transit/)).toHaveCount(0);
  expectSafePreview(page, observations, methods);
});

test('VAL-RES-011: Scaled 100× settles all nine routes, filters and appends unique bounded cursor pages without a legacy gate', async ({
  page,
}) => {
  test.setTimeout(240_000);
  page.setDefaultTimeout(15_000);
  const observations = observe(page);
  await bootOnStaticRoute(page, observations);
  await page.getByLabel('Data provider').selectOption('scaled');
  await expect(page.getByText(/100 copies of the book/)).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => window.GTM_HEALTH?.artifact.providerId))
    .toBe('scaled');
  await settle(page, observations);

  for (const spec of [...FAILURE_ROUTES, { route: 'Production Requirements' }]) {
    const before = observations.started.length;
    await visit(page, spec.route, 'heading' in spec ? spec.heading : undefined);
    await settle(page, observations);
    await expect(
      page.getByText(/unavailable:|refresh failed:|Something went wrong here/),
    ).toHaveCount(0);
    if (spec.route === 'Production Requirements') {
      await expectOnlyCalls(observations, before, []);
    } else {
      expect(
        observations.started.slice(before).length,
        `${spec.route} must issue scoped queries`,
      ).toBeGreaterThan(0);
    }

    if (spec.route === 'Action Center') {
      await expect(actionRows(page)).toHaveCount(25);
      const first = await ids(actionRows(page), 'data-action-id');
      const beforePage = observations.started.length;
      await page.getByRole('button', { name: 'Load 25 more', exact: true }).click();
      await expect(actionRows(page)).toHaveCount(50);
      const appended = await ids(actionRows(page), 'data-action-id');
      expect(appended.slice(0, 25)).toEqual(first);
      await settle(page, observations);
      await expectOnlyCalls(observations, beforePage, ['listActionItems']);
      await page.getByRole('checkbox', { name: 'Registration SLA', exact: true }).check();
      await settle(page, observations);
      await expect(actionRows(page)).toHaveCount(25);
      for (const row of await actionRows(page).all())
        await expect(row).toContainText('Registration SLA');
      await page.getByRole('combobox', { name: 'Severity', exact: true }).selectOption('critical');
      await settle(page, observations);
      await expect(actionRows(page)).toHaveCount(25);
      for (const row of await actionRows(page).all()) await expect(row).toContainText('critical');
      await page.getByLabel('Owner ID', { exact: true }).fill('no-such-demo-owner');
      await settle(page, observations);
      await expect(actionRows(page)).toHaveCount(0);
      await expect(page.getByText('No matching action items.', { exact: true })).toBeVisible();
    } else if (spec.route === 'Forecasting') {
      const table = page.getByRole('region', { name: /^In-quarter opportunities/ });
      const rows = table.locator('tbody tr');
      await expect(rows).toHaveCount(25);
      // Identity must come from the domain id, not customer text or row position.
      const first = await ids(rows, 'data-opportunity-id');
      const beforePage = observations.started.length;
      await page.getByRole('button', { name: 'Load 25 more', exact: true }).click();
      await expect(rows).toHaveCount(50);
      expect((await ids(rows, 'data-opportunity-id')).slice(0, 25)).toEqual(first);
      await settle(page, observations);
      await expectOnlyCalls(observations, beforePage, ['listQuarterOpportunities']);
      const weeks = page.getByRole('group', { name: 'weekly series', exact: true });
      const ticks = weeks.locator('.recharts-xAxis .recharts-cartesian-axis-tick');
      await expect(ticks).toHaveCount(13);
      await page
        .getByRole('combobox', { name: 'Partner manager', exact: true })
        .selectOption({ index: 1 });
      await settle(page, observations);
      await expect(
        page.getByText(/organization-level history: snapshots do not record manager ownership/),
      ).toBeVisible();
      await expect(rows).toHaveCount(50);
      await expect(ticks).toHaveCount(13);
    } else if (spec.route === 'Partner Performance') {
      await page
        .getByRole('combobox', { name: 'Partner manager', exact: true })
        .selectOption({ index: 1 });
      await settle(page, observations);
      await expect(
        page.getByRole('combobox', { name: 'Partner manager', exact: true }),
      ).not.toHaveValue('all');
      await expect(
        page
          .getByRole('group', { name: 'pipeline opportunities', exact: true })
          .locator('tbody tr'),
      ).toHaveCount(25);
    } else if (spec.route === 'Activity Tracking') {
      await page
        .getByRole('combobox', { name: 'Partner manager', exact: true })
        .selectOption({ index: 1 });
      await settle(page, observations);
      await page.getByRole('button', { name: 'Log Meetings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /Log meetings ·/ });
      await expect(dialog.getByRole('combobox', { name: /Partner for .* meeting/ })).toHaveCount(
        25,
      );
      await dialog.getByRole('button', { name: 'Load more meetings', exact: true }).click();
      await expect(dialog.getByRole('combobox', { name: /Partner for .* meeting/ })).toHaveCount(
        50,
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    } else if (spec.route === 'Partner View') {
      const picker = page.getByLabel('Viewing as');
      const first = await picker.inputValue();
      await picker.selectOption({ index: 1 });
      await settle(page, observations);
      await expect(picker).not.toHaveValue(first);
      await expect(
        page.getByText('Demo selector — client filtering is not authorization'),
      ).toBeVisible();
    } else if (spec.route === 'Home') {
      await card(page, 'Deal registration funnel')
        .getByRole('button', { name: 'Count', exact: true })
        .click();
      await expect(
        card(page, 'Deal registration funnel').getByText('Submitted', { exact: true }),
      ).toBeVisible();
    } else if (spec.route === 'Deal Reg Ops') {
      const queue = page.getByRole('group', { name: 'review queue', exact: true });
      await expect(queue.locator('tbody tr')).toHaveCount(10);
      await queue.getByRole('button', { name: 'Load 10 more', exact: true }).click();
      await expect(queue.locator('tbody tr')).toHaveCount(20);
    } else if (spec.route === 'Data Connections') {
      await page.getByRole('button', { name: /^Salesforce/ }).click();
      await expect(page.getByRole('heading', { name: 'Salesforce', level: 3 })).toBeVisible();
    }
    await settle(page, observations);
  }
  expectSafePreview(page, observations);
});

test('VAL-CROSS-006: remote startup ping, Action Center summary and second-page failures preserve local health, retained ids and retry focus', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const observations = observe(page);
  const failures = ['getForecastSummary', 'getActionCenterSummary', 'listActionItems'];
  await bootOnStaticRoute(
    page,
    observations,
    'getForecastSummary:1:1,getActionCenterSummary:1,listActionItems:1:1',
  );
  await expect.poll(() => page.evaluate(() => Boolean(window.GTM_HEALTH))).toBe(true);
  await remote(page);
  // The readiness probe succeeded; the new provider's first health ping
  // failed. The shell still publishes its local operator-facing artifact.
  await expect
    .poll(() =>
      page.evaluate(
        () => window.GTM_HEALTH?.checks.find((check) => check.name === 'dataSeam')?.status,
      ),
    )
    .toBe('unavailable');
  const health = await page.evaluate(() => window.GTM_HEALTH?.artifact);
  expect(health?.providerId).toBe('remote');
  expect(health?.checks.find((check) => check.name === 'appShell')?.status).toBe('ok');
  expect(health?.checks.find((check) => check.name === 'telemetry')?.detail).toBe(
    'collector not configured; metrics and errors stay in-process',
  );
  await expect(
    page.getByRole('heading', { name: 'Production Requirements', level: 1 }),
  ).toBeVisible();

  await visit(page, 'Action Center');
  const summary = page.getByRole('group', { name: 'Action Center summary', exact: true });
  const items = page.getByRole('group', { name: 'action items', exact: true });
  await expect(
    summary.getByText('Action Center summary unavailable:', { exact: true }),
  ).toBeVisible();
  await expect(actionRows(page)).toHaveCount(25);
  await settle(page, observations);
  const first = await ids(actionRows(page), 'data-action-id');

  let before = observations.started.length;
  await summary.getByRole('button', { name: 'Retry Action Center summary', exact: true }).click();
  await expect(summary.getByText('85 unique items', { exact: true })).toBeVisible();
  await expect(summary).toBeFocused();
  await settle(page, observations);
  await expectOnlyCalls(observations, before, ['getActionCenterSummary']);
  expect(await ids(actionRows(page), 'data-action-id')).toEqual(first);

  before = observations.started.length;
  await items.getByRole('button', { name: 'Load 25 more', exact: true }).click();
  await expect(
    items.getByRole('button', { name: 'Retry action items', exact: true }),
  ).toBeVisible();
  await expect(items.getByText('Showing 25 of 85 action items')).toBeVisible();
  await settle(page, observations);
  await expectOnlyCalls(observations, before, ['listActionItems']);
  expect(await ids(actionRows(page), 'data-action-id')).toEqual(first);
  await expect(summary.getByText('85 unique items', { exact: true })).toBeVisible();
  await expect(page.getByText(/failed in transit|Something went wrong here/)).toHaveCount(0);

  before = observations.started.length;
  await items.getByRole('button', { name: 'Retry action items', exact: true }).click();
  await expect(actionRows(page)).toHaveCount(50);
  await expect(items.getByText('Showing 50 of 85 action items')).toBeVisible();
  await expect(items.getByRole('button', { name: 'Load 25 more', exact: true })).toBeFocused();
  await settle(page, observations);
  await expectOnlyCalls(observations, before, ['listActionItems']);
  expect((await ids(actionRows(page), 'data-action-id')).slice(0, 25)).toEqual(first);

  const refreshed = await page.evaluate(() => window.GTM_HEALTH?.refresh());
  expect(refreshed?.checks.find((check) => check.name === 'dataSeam')?.status).toBe('ok');
  for (const method of failures) {
    expect(
      observations.errors.filter((text) => text.includes(`operation: ${method},`)),
    ).toHaveLength(1);
  }
  await observations.flush();
  expectSafePreview(page, observations, failures);
});
