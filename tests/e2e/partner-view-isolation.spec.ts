import { expect, test, type Page } from '@playwright/test';

/**
 * VAL-CROSS-004: Partner View and Data Connections read the scoped contract.
 *
 * Three browser proofs on the deterministic seeded book:
 *
 * 1. Partner View renders only the selected partner's projection — the
 *    provider's own partner-scoped aggregate, cursor-paged rows, and nothing
 *    else: switching the (preserved, honestly labeled) demo picker re-scopes
 *    every card, and no Sell To row, conflict, or other partner's record can
 *    appear. The picker copy states this is demo filtering, not
 *    authorization.
 * 2. Data Connections renders its static catalog without touching business
 *    facts, while the roster and the bounded SLA alert queue arrive as their
 *    own scoped answers on Settings.
 * 3. A scripted per-method failure on the simulated remote
 *    (?remoteFailMethods=..., see src/data/providers.ts) fails exactly the
 *    Settings sections behind those methods, and each section's Retry repeats
 *    only its own failed query while the static catalog never leaves the
 *    screen.
 */

const primaryNavigation = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

/** The card whose heading carries this title. */
function cardWith(page: Page, title: RegExp) {
  return page
    .getByRole('heading', { name: title })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
}

/** The KPI tile whose label matches. */
function tileWith(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..');
}

test('VAL-CROSS-004: Partner View renders only the selected partner projection', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await primaryNavigation(page).getByRole('button', { name: 'Partner View' }).click();

  // The picker is the demo furniture it always was, opening on the partner
  // the portal-visible leaderboard ranks first, and the adjacent copy says
  // what the picker is: presentation filtering, never authorization.
  const picker = page.getByLabel('Viewing as');
  await expect(page.getByRole('heading', { level: 1, name: 'Kestrel Networks' })).toBeVisible();
  await expect(picker).toHaveValue('p-16');
  await expect(
    page.getByText(/Demo selector — client filtering is not authorization/),
  ).toBeVisible();
  await expect(page.getByText(/trusted sign-in and server-enforced row access/)).toBeVisible();

  // The KPIs are the scoped aggregate's own numbers for Kestrel Networks.
  await expect(tileWith(page, 'Open pipeline')).toHaveText(/\$511\.2K/);
  await expect(tileWith(page, 'Open pipeline')).toHaveText(/4 open/);
  await expect(tileWith(page, 'Awaiting review')).toHaveText(/2/);
  await expect(tileWith(page, 'Partner strategists certified')).toHaveText(/2\/3/);

  // The pipeline is the partner's own seven opportunities — cursor-bounded,
  // and Sell To never crosses, because the scope excludes it before the
  // answer exists.
  const pipeline = page.getByRole('region', { name: 'Pipeline opportunities, scrollable' });
  await expect(pipeline.getByText('Pinnacle Media Co.', { exact: true })).toBeVisible();
  await expect(pipeline.getByText(/^sell to$/i)).toHaveCount(0);
  await expect(
    cardWith(page, /^Pipeline opportunities/).getByText('Showing 7 of 7 opportunities'),
  ).toBeVisible();

  // The history is the partner's own registrations, newest first, a page at
  // a time — not a browser-side filter over everyone's book.
  const historyCard = cardWith(page, /^Deal registrations$/);
  await expect(historyCard.getByText('Showing 8 of 12 registrations')).toBeVisible();
  await expect(historyCard.getByText('Borealis Food Corp.', { exact: true })).toBeVisible();
  await historyCard.getByRole('button', { name: 'Load 8 more' }).click();
  await expect(historyCard.getByText('Showing 12 of 12 registrations')).toBeVisible();

  // Conflicts are internal material; the card exists only on Deal Reg Ops.
  await expect(page.getByText('Duplicate & conflicting registrations')).toHaveCount(0);

  // Switching the picker re-scopes every card: the new partner's rows arrive
  // and nothing of the previous partner's projection survives.
  await picker.selectOption('p-14');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Atlas Bridge Consulting' }),
  ).toBeVisible();
  await expect(historyCard.getByText('Dunelight Automotive Group', { exact: true })).toBeVisible();
  await expect(historyCard.getByText('Borealis Food Corp.', { exact: true })).toHaveCount(0);
  await expect(pipeline.getByText('Pinnacle Media Co.', { exact: true })).toHaveCount(0);
  await expect(pipeline.getByText('Atlas Construction Industries', { exact: true })).toHaveCount(0);
  await expect(pipeline.getByText(/^sell to$/i)).toHaveCount(0);

  // Every settled query carries its as-of/provider/completeness caption.
  expect(await page.getByText(/^As of /).count()).toBeGreaterThan(0);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('VAL-CROSS-004: Data Connections renders its static catalog and Settings pairs it with scoped roster and alert answers', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await primaryNavigation(page).getByRole('button', { name: 'Data Connections' }).click();
  await expect(page.getByRole('heading', { name: 'Data Connections', level: 1 })).toBeVisible();

  // The catalog is static: the map and its KPIs are not business facts.
  await expect(page.getByRole('group', { name: 'Data connection map' })).toBeVisible();
  await expect(tileWith(page, 'Connections required')).toHaveText(/\d+/);

  // The roster and the alert queue now live on Settings and arrive as their
  // own scoped answers: the session roster with its routing states, and the
  // urgent window of the alert digest with the whole queue's depth in the cap
  // line.
  await primaryNavigation(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(tileWith(page, 'Receiving notifications')).toHaveText(/7\/8/);
  await expect(tileWith(page, 'SLA alerts due')).toHaveText(/17/);
  await expect(
    tileWith(page, 'SLA alerts due').getByText(/3 due next business day · 14 past the 5-day SLA/),
  ).toBeVisible();
  const queue = cardWith(page, /^Deal-registration SLA alerts$/);
  await expect(
    queue.getByText('Showing the 8 most urgent of 17 registrations flagged against the SLA.'),
  ).toBeVisible();
  await expect(queue.getByText('Borealis Pharma Group', { exact: true })).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Notify all 8 owners' })).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('VAL-CROSS-004: a failed Settings section retries alone while the static catalog stays live', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // Boot, then attach the named failure plan to the resolved URL and switch
  // to the simulated remote. The plan fails the first roster call and the
  // first alert-digest call only; every sibling method succeeds, so the
  // readiness probe commits and only those sections fall.
  await page.goto('/');
  await page.goto(`${page.url()}?remoteFailMethods=getTeamRoster:1,getRegistrationSlaAlerts:1`);
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();

  await primaryNavigation(page).getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();

  // Each failed section names itself, in its own query's stable copy — the
  // roster query's failure is shared by the membership roster, the routing
  // panel, and the composer.
  await expect(page.getByText('The team roster unavailable:')).toBeVisible();
  await expect(page.getByText('The notification composer unavailable:')).toBeVisible();
  await expect(page.getByText('Failed to load the notification roster')).toHaveCount(3);
  await expect(page.getByText('The SLA alert queue unavailable:')).toBeVisible();
  await expect(page.getByText('Failed to load the registration SLA alerts')).toBeVisible();
  await expect(tileWith(page, 'Receiving notifications')).toHaveText(/—/);
  // The transport's raw prose stays out of the DOM.
  await expect(page.getByText(/failed in transit/)).toHaveCount(0);

  // The roster section's Retry repeats only the failed roster query: the
  // section recovers, focus lands on its named region, and the alert queue
  // waits for its own retry.
  await page.getByRole('button', { name: 'Retry The team roster' }).click();
  await expect(tileWith(page, 'Receiving notifications')).toHaveText(/7\/8/);
  await expect(page.getByRole('group', { name: 'The team roster' })).toBeFocused();
  await expect(page.getByText('The SLA alert queue unavailable:')).toBeVisible();

  await page.getByRole('button', { name: 'Retry The SLA alert queue' }).click();
  await expect(tileWith(page, 'SLA alerts due')).toHaveText(/17/);
  await expect(page.getByRole('group', { name: 'The SLA alert queue' })).toBeFocused();

  // The static catalog never waited on the provider.
  await primaryNavigation(page).getByRole('button', { name: 'Data Connections' }).click();
  await expect(page.getByRole('heading', { name: 'Data Connections', level: 1 })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Data connection map' })).toBeVisible();
  await expect(tileWith(page, 'Connections required')).toHaveText(/\d+/);

  // No uncaught errors and no unexpected console errors. The tolerated
  // records are the scripted failures themselves: the telemetry seam
  // captures every provider error, and we forced the first call of each.
  const scriptedFailure =
    /component: DataProvider, operation: (getTeamRoster|getRegistrationSlaAlerts)/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedFailure.test(text))).toEqual([]);
});
