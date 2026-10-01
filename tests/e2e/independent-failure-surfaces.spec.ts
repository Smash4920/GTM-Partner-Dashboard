import { expect, test, type Page } from '@playwright/test';

/**
 * Independent failure surfaces: a named query failure degrades exactly its
 * own surface while retained sibling data stays live, and a focused retry
 * repeats only the failed work.
 *
 * Four browser proofs on the production preview, all on the simulated remote
 * with a named failure plan (?remoteFailMethods=method:count or the
 * method:skip:count form that lets the first calls succeed, see
 * src/data/providers.ts):
 *
 * 1. Deal Reg Ops: a failed partner-roster lookup leaves the registration
 *    cards interactive with the explicit partner-id fallback, and the named
 *    partner-roster Retry repeats only that method, restores the names, and
 *    lands focus on the roster's region.
 * 2. Data Connections: three sections fail on different methods at once; the
 *    static catalog stays interactive, and one section Retry repeats every
 *    failed dependency of that section exactly once — recovering the shared
 *    roster dependency recovers every section that was waiting on it.
 * 3. Data Connections again, with skip plans: a session roster edit refreshes
 *    the roster and alert queries and both refreshes fail — every section
 *    keeps its last good answers under a "Latest refresh failed" line, the
 *    tiles keep their numbers and say the refresh failed, and each section
 *    Retry repeats exactly the dependencies it owes.
 * 4. Activity Tracking: the meeting calendar's first page fails — the goal
 *    and volume cards never blink, and the Log Meetings modal names the
 *    failure with an armed Retry that recovers the week and lands focus
 *    inside the dialog.
 *
 * The load-more failure of the calendar's second page is rehearsed in the
 * MeetingLogModal component tests: no seeded manager's week exceeds one
 * 25-row page, so the Load more affordance never renders against the
 * production preview's data.
 */

const primaryNavigation = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

/** The card whose heading carries this title. */
function cardWith(page: Page, title: string) {
  return page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
}

/** The KPI tile whose label matches. */
function tileWith(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..');
}

/** Console errors, page errors, and off-origin requests, collected per test. */
function watch(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('request', (request) => requests.push(request.url()));
  return { consoleErrors, pageErrors, requests };
}

/** Every request stayed on the preview origin (or data/blob URLs). */
function expectSameOriginOnly(page: Page, requests: string[]) {
  const origin = new URL(page.url()).origin;
  const remote = requests.filter(
    (url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'),
  );
  expect(remote).toEqual([]);
}

/** Boots the app, attaches the named failure plan, and commits the remote. */
async function bootRemoteWithPlan(page: Page, plan: string) {
  await page.goto('/');
  // Attach the plan to the resolved URL (the preview redirects to its base
  // path first), then switch providers.
  await page.goto(`${page.url()}?remoteFailMethods=${plan}`);
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();
}

test('VAL-DATA-015: a failed Deal Reg Ops partner roster keeps cards live and retries alone', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { consoleErrors, pageErrors, requests } = watch(page);
  // Skip plan: Home fires the first getPartnerRoster call after the provider
  // commits, so the deterministic landing needs the skip — wait for Home's
  // roster-derived caption, which proves that call completed (an aborted one
  // would consume no slot and race the navigation).
  await bootRemoteWithPlan(page, 'getPartnerRoster:1:1');
  await expect(page.getByText(/· \d+ aligned partners/)).toBeVisible();

  await primaryNavigation(page).getByRole('button', { name: 'Deal Reg Ops' }).click();
  await expect(
    page.getByRole('heading', { name: 'Deal Registration Operations', level: 1 }),
  ).toBeVisible();

  // The roster failure is named beside the cards it degrades; the transport's
  // raw prose stays out of the DOM.
  const rosterRegion = page.getByRole('group', { name: 'partner roster' });
  await expect(
    rosterRegion.getByText('Partner names unavailable — showing partner ids:'),
  ).toBeVisible();
  await expect(rosterRegion.getByText('Failed to load the partner roster')).toBeVisible();
  await expect(page.getByText(/failed in transit/)).toHaveCount(0);

  // The registration cards stay interactive: the queue still answers, its
  // partner column falls back to the explicit ids, and paging still works.
  const queue = cardWith(page, 'Registrations awaiting review');
  await expect(queue.getByText('Showing 10 of 18 pending')).toBeVisible();
  await expect(queue.locator('td', { hasText: /^p-\d+$/ }).first()).toBeVisible();
  await expect(tileWith(page, 'Pending past SLA')).toHaveText(/14/);
  await queue.getByRole('button', { name: 'Load 10 more' }).click();
  await expect(queue.getByText('Showing 18 of 18 pending')).toBeVisible();

  // The named retry repeats only the roster lookup: the names resolve, the
  // queue keeps its rows, and focus lands on the roster's region.
  await rosterRegion.getByRole('button', { name: 'Retry partner roster' }).click();
  await expect(queue.locator('td', { hasText: /^p-\d+$/ })).toHaveCount(0);
  await expect(queue.getByText('Showing 18 of 18 pending')).toBeVisible();
  await expect(rosterRegion.getByText(/Partner names unavailable/)).toHaveCount(0);
  await expect(rosterRegion).toBeFocused();

  expectSameOriginOnly(page, requests);
  // The only tolerated console error is the scripted failure itself.
  const scriptedFailure = /component: DataProvider, operation: getPartnerRoster/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedFailure.test(text))).toEqual([]);
  expect(consoleErrors.filter((text) => scriptedFailure.test(text)).length).toBeGreaterThan(0);
});

test('VAL-RES-009: Data Connections fails each section independently and retries every failed dependency once', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { consoleErrors, pageErrors, requests } = watch(page);
  await bootRemoteWithPlan(
    page,
    'getTeamRoster:1,getRegistrationSlaAlerts:1,listRecentRegistrations:1',
  );

  await primaryNavigation(page).getByRole('button', { name: 'Data Connections' }).click();
  await expect(page.getByRole('heading', { name: 'Data Connections', level: 1 })).toBeVisible();

  // Three sections fail on three different methods, each by its own name;
  // the data-derived tiles degrade to a dash with truthful subtitles.
  await expect(page.getByText('The team roster unavailable:')).toBeVisible();
  await expect(page.getByText('The SLA alert queue unavailable:')).toBeVisible();
  await expect(page.getByText('The notification composer unavailable:')).toBeVisible();
  await expect(
    tileWith(page, 'Receiving notifications').getByText('—', { exact: true }),
  ).toBeVisible();
  await expect(
    tileWith(page, 'Receiving notifications').getByText(
      /roster unavailable — the provider did not answer/,
    ),
  ).toBeVisible();
  await expect(
    tileWith(page, 'SLA alerts due').getByText(
      /alert queue unavailable — the provider did not answer/,
    ),
  ).toBeVisible();

  // The static catalog never waited on any of it.
  await page.getByRole('button', { name: /^Salesforce/ }).click();
  await expect(page.getByRole('heading', { name: 'Salesforce', level: 3 })).toBeVisible();

  // The alert queue's retry repeats every failed dependency of the section —
  // the alerts and the shared roster — so the roster section recovers without
  // its own retry, while the composer still waits on the registrations.
  const alertQueue = page.getByRole('group', { name: 'The SLA alert queue' });
  const roster = page.getByRole('group', { name: 'The team roster' });
  await alertQueue.getByRole('button', { name: 'Retry The SLA alert queue' }).click();
  await expect(alertQueue.getByText(/past the SLA/)).toBeVisible();
  await expect(roster.getByText('Alex Morgan').first()).toBeVisible();
  await expect(page.getByText('The team roster unavailable:')).toHaveCount(0);
  await expect(page.getByText('The SLA alert queue unavailable:')).toHaveCount(0);
  await expect(page.getByText('The notification composer unavailable:')).toBeVisible();
  await expect(page.getByText('Failed to load the registration records')).toBeVisible();
  // Focus landed on the retried section's region, never the document body.
  await expect(alertQueue).toBeFocused();

  // The composer's retry repeats its remaining failed dependency.
  const composer = page.getByRole('group', { name: 'The notification composer' });
  await composer.getByRole('button', { name: 'Retry The notification composer' }).click();
  await expect(composer.getByRole('button', { name: /^Send to / })).toBeVisible();
  await expect(page.getByText(/unavailable:/)).toHaveCount(0);
  await expect(composer).toBeFocused();

  expectSameOriginOnly(page, requests);
  // Each scripted failure logged exactly its own operation; nothing else errored.
  const scriptedFailure =
    /component: DataProvider, operation: (getTeamRoster|getRegistrationSlaAlerts|listRecentRegistrations)/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedFailure.test(text))).toEqual([]);
  for (const operation of [
    'getTeamRoster',
    'getRegistrationSlaAlerts',
    'listRecentRegistrations',
  ]) {
    expect(
      consoleErrors.filter((text) => text.includes(`operation: ${operation}`)).length,
    ).toBeGreaterThan(0);
  }
});

test('VAL-DATA-015: a failed Data Connections refresh keeps the last good answers and says so', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { consoleErrors, pageErrors, requests } = watch(page);
  // Skip plans: the initial loads succeed; the overlay-driven refresh of the
  // roster and of the alerts is each method's second call — and both fail.
  await bootRemoteWithPlan(page, 'getTeamRoster:1:1,getRegistrationSlaAlerts:1:1');

  await primaryNavigation(page).getByRole('button', { name: 'Data Connections' }).click();
  await expect(page.getByRole('heading', { name: 'Data Connections', level: 1 })).toBeVisible();

  // Healthy first: the seeded answers render with their truthful subtitles.
  const roster = page.getByRole('group', { name: 'The team roster' });
  const alertQueue = page.getByRole('group', { name: 'The SLA alert queue' });
  const composer = page.getByRole('group', { name: 'The notification composer' });
  await expect(roster.getByText('Alex Morgan').first()).toBeVisible();
  await expect(alertQueue.getByText(/past the SLA/)).toBeVisible();
  await expect(tileWith(page, 'Receiving notifications').getByText('7/8')).toBeVisible();
  await expect(tileWith(page, 'SLA alerts due').getByText('17', { exact: true })).toBeVisible();

  // A session roster edit refreshes exactly the two queries that read the
  // roster — and both refreshes fail with raw transport prose.
  await roster.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog', { name: 'Add internal user' });
  await form.getByLabel('Name').fill('E2E Teammate');
  await form.getByLabel('Work email').fill('e2e.teammate@factory.ai');
  await form.getByRole('button', { name: 'Add to roster' }).click();

  // Every section that reads a failed dependency keeps its retained content
  // under a named refresh-failure line; the raw prose never renders.
  await expect(page.getByText('Latest refresh failed:')).toHaveCount(3);
  await expect(roster.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(alertQueue.getByText('Failed to load the registration SLA alerts')).toBeVisible();
  await expect(composer.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(page.getByText(/failed in transit/)).toHaveCount(0);
  // The last good answers stay on screen. The session edit rides inside the
  // roster query's scope, so the new teammate truthfully appears only once a
  // refreshed answer lands — the retained answer is the last good one.
  await expect(roster.getByText('Alex Morgan').first()).toBeVisible();
  await expect(alertQueue.getByText(/past the SLA/)).toBeVisible();
  await expect(composer.getByRole('button', { name: /^Send to / })).toBeVisible();
  // The tiles keep the prior numbers and say the latest refresh failed.
  await expect(tileWith(page, 'Receiving notifications').getByText('7/8')).toBeVisible();
  await expect(
    tileWith(page, 'Receiving notifications').getByText(
      'latest refresh failed — showing the last good roster',
    ),
  ).toBeVisible();
  await expect(tileWith(page, 'SLA alerts due').getByText('17', { exact: true })).toBeVisible();
  await expect(
    tileWith(page, 'SLA alerts due').getByText(
      'latest refresh failed — showing the last good alert counts',
    ),
  ).toBeVisible();

  // The roster section's retry repeats only the roster query: the composer
  // section shares that dependency and recovers with it, while the alert
  // queue is still owed its own retry.
  await roster.getByRole('button', { name: 'Retry The team roster' }).click();
  await expect(page.getByText('Latest refresh failed:')).toHaveCount(1);
  await expect(roster).toBeFocused();
  await expect(alertQueue.getByText('Failed to load the registration SLA alerts')).toBeVisible();
  await expect(
    tileWith(page, 'Receiving notifications').getByText(
      'roster entries routed simulated notifications this session',
    ),
  ).toBeVisible();

  // The alert queue's retry fires exactly its failed dependency, and the
  // route is fully recovered — the session edit included.
  await alertQueue.getByRole('button', { name: 'Retry The SLA alert queue' }).click();
  await expect(page.getByText('Latest refresh failed:')).toHaveCount(0);
  await expect(alertQueue).toBeFocused();
  await expect(roster.getByText('E2E Teammate')).toBeVisible();
  await expect(
    tileWith(page, 'SLA alerts due').getByText(/due next business day · \d+ past the 5-day SLA/),
  ).toBeVisible();

  expectSameOriginOnly(page, requests);
  // Call-count evidence at the seam: each method's log shows exactly one
  // failure — the scripted refresh — between its successful calls.
  const scriptedFailure =
    /component: DataProvider, operation: (getTeamRoster|getRegistrationSlaAlerts)/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedFailure.test(text))).toEqual([]);
  for (const operation of ['getTeamRoster', 'getRegistrationSlaAlerts']) {
    expect(consoleErrors.filter((text) => text.includes(`operation: ${operation}`))).toHaveLength(
      1,
    );
  }
});

test('VAL-RES-009: a failed first calendar page is named inside Log Meetings and retries there', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const { consoleErrors, pageErrors, requests } = watch(page);
  await bootRemoteWithPlan(page, 'listWeeklyClassificationMeetings:1');

  await primaryNavigation(page).getByRole('button', { name: 'Activity Tracking' }).click();
  await expect(page.getByRole('heading', { name: 'Activity Tracking', level: 1 })).toBeVisible();

  // The calendar's sibling cards — different provider methods — answer right
  // through the failure.
  await expect(cardWith(page, 'Progress to weekly goal').getByText('10/10')).toBeVisible();
  await expect(page.getByText('30 meetings in scope')).toBeVisible();

  // The calendar's failure is named inside the modal it feeds, with stable
  // copy and a retry that repeats only the failed page.
  await page.getByRole('button', { name: 'Log Meetings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log meetings' });
  await expect(dialog.getByText('Log meetings · Alex Morgan')).toBeVisible();
  await expect(dialog.getByText(/Failed to load the week.s meetings/)).toBeVisible();
  await expect(dialog.getByText(/failed in transit/)).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Retry meeting calendar' }).click();
  await expect(dialog.getByRole('combobox', { name: /Partner for .* meeting/ })).toHaveCount(10);
  await expect(dialog.getByText('Showing 10 meetings this week')).toBeVisible();
  // A successful retry lands focus on the calendar's region inside the
  // dialog, never drops it to the document body.
  await expect(dialog.getByRole('group', { name: 'meeting calendar' })).toBeFocused();

  expectSameOriginOnly(page, requests);
  // The only tolerated console error is the scripted failure itself.
  const scriptedFailure = /component: DataProvider, operation: listWeeklyClassificationMeetings/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedFailure.test(text))).toEqual([]);
  expect(consoleErrors.filter((text) => scriptedFailure.test(text)).length).toBeGreaterThan(0);
});
