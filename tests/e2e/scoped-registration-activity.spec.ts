import { expect, test, type Page } from '@playwright/test';

/**
 * VAL-DATA-015: Deal Reg Ops and Activity Tracking read the scoped contract.
 *
 * Three browser proofs on the deterministic seeded book:
 *
 * 1. Deal Reg Ops renders the exact registration, conflict, conversion, and
 *    SLA answers the provider computes — 18 pending registrations paged ten
 *    at a time by cursor, 14 of them past the inclusive five-business-day
 *    SLA, 44 approved-but-unconverted, 12 duplicate groups — nothing reduced
 *    from a whole book in the browser.
 * 2. Activity Tracking renders the manager-scoped goal, the manager-wide
 *    by-type split, the partner-filterable volume chart, and the bounded
 *    classification calendar in Log Meetings; committing a prospect
 *    classification refetches the roster-reading answers exactly once.
 * 3. A scripted single-method failure on the simulated remote
 *    (?remoteFailMethods=listPendingRegistrations:1, see src/data/providers.ts)
 *    leaves the sibling cards interactive, and the queue's own Retry
 *    recovers it alone.
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

test('VAL-DATA-015: Deal Reg Ops renders the exact scoped registration answers', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await primaryNavigation(page).getByRole('button', { name: 'Deal Reg Ops' }).click();
  await expect(
    page.getByRole('heading', { name: 'Deal Registration Operations', level: 1 }),
  ).toBeVisible();

  // The ops aggregate: conversion hops and the two service levels, with the
  // SLA counted on the inclusive five-business-day boundary.
  await expect(tileWith(page, 'Submitted → approved')).toHaveText(/4\.1d/);
  await expect(tileWith(page, 'Approved → opportunity')).toHaveText(/6\.8d/);
  await expect(tileWith(page, 'Pending past SLA')).toHaveText(/14/);
  await expect(tileWith(page, 'Pending past SLA')).toHaveText(/5\+ business days awaiting review/);
  // The tile's sub-copy is unique; the label alone also matches the
  // exclusivity table's status cells.
  const lapsedTile = page
    .getByText('approved, no opp · > 60 days', { exact: true })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
  await expect(lapsedTile).toHaveText(/33/);

  // The review queue reports the scoped total and pages ten rows at a time.
  const queue = cardWith(page, 'Registrations awaiting review');
  await expect(
    queue.getByText('18 pending · day counter is green inside the 5-business-day SLA'),
  ).toBeVisible();
  await expect(queue.getByText('Showing 10 of 18 pending')).toBeVisible();
  await expect(
    queue.getByText('14 of 18 pending registrations are already past the response SLA.'),
  ).toBeVisible();
  const loadMore = queue.getByRole('button', { name: 'Load 10 more' });
  await loadMore.click();
  await expect(queue.getByText('Showing 18 of 18 pending')).toBeVisible();
  await expect(loadMore).toHaveAttribute('aria-disabled', 'true');

  // The exclusivity watch and the internal conflict table answer with their
  // own scoped totals.
  const exclusivity = cardWith(page, 'Exclusivity window');
  await expect(
    exclusivity.getByText(/44 approved registrations still without an opportunity/),
  ).toBeVisible();
  await expect(exclusivity.getByText(/33 of 44 have passed the 60-day window/)).toBeVisible();
  const duplicates = cardWith(page, 'Duplicate & conflicting registrations');
  await expect(
    duplicates.getByText(/12 clients registered by more than one partner/),
  ).toBeVisible();

  // Every settled query carries its as-of/provider/completeness caption.
  expect(await page.getByText(/^As of /).count()).toBeGreaterThan(0);

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('VAL-DATA-015: Activity Tracking renders scoped aggregates and a bounded calendar', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await primaryNavigation(page).getByRole('button', { name: 'Activity Tracking' }).click();
  await expect(page.getByRole('heading', { name: 'Activity Tracking', level: 1 })).toBeVisible();

  // The view follows the directory to its first manager and renders his
  // scoped goal: ten calls this week, two of them PIO interlocks.
  const goalCard = cardWith(page, 'Progress to weekly goal');
  await expect(goalCard.getByText(/· Alex Morgan/)).toBeVisible();
  await expect(goalCard.getByText('10/10')).toBeVisible();
  await expect(goalCard.getByText('2/3')).toBeVisible();
  await expect(goalCard.getByText('10 total this week')).toBeVisible();

  // The volume chart is the manager's scoped eight-week series.
  await expect(page.getByText('30 meetings in scope')).toBeVisible();
  await expect(page.getByRole('option', { name: 'All Partners (5)' })).toBeAttached();

  // Switching managers re-scopes the aggregates, not just the labels.
  await page
    .getByRole('combobox', { name: 'Partner manager' })
    .selectOption({ label: 'Jordan Lee' });
  await expect(goalCard.getByText(/· Jordan Lee/)).toBeVisible();
  await expect(page.getByText('41 meetings in scope')).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Partner manager' })
    .selectOption({ label: 'Alex Morgan' });
  await expect(page.getByText('30 meetings in scope')).toBeVisible();

  // Log Meetings opens the cursor-paginated calendar: the week's ten calls
  // fit one 25-row page, so there is no load-more affordance.
  await page.getByRole('button', { name: 'Log Meetings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Log meetings' });
  await expect(dialog.getByText('Log meetings · Alex Morgan')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: /Partner for .* meeting/ })).toHaveCount(10);
  await expect(dialog.getByRole('button', { name: /Load more meetings/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  // Registering a prospect inside the modal drafts it onto the call;
  // submitting commits once and the roster-reading surfaces pick the
  // prospect up — the partner filter now counts six on the roster.
  await dialog
    .getByRole('combobox', { name: /Partner for .* meeting/ })
    .first()
    .selectOption('__add_partner__');
  const form = dialog.getByRole('dialog', { name: 'Add prospective partner' });
  await form.getByPlaceholder('Partner name').fill('E2E Prospect Co');
  await form.getByRole('button', { name: 'Add' }).click();
  await dialog.getByRole('button', { name: 'Submit classifications' }).click();
  await expect(page.getByRole('option', { name: 'All Partners (6)' })).toBeAttached();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('VAL-DATA-015: a failed Deal Reg Ops resource retries alone while siblings stay live', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // Boot, then attach the named failure plan to the resolved URL (the
  // production preview redirects to its base path first) and switch to the
  // simulated remote. The plan fails the first listPendingRegistrations
  // call only; every sibling method succeeds.
  await page.goto('/');
  await page.goto(`${page.url()}?remoteFailMethods=listPendingRegistrations:1`);
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();

  await primaryNavigation(page).getByRole('button', { name: 'Deal Reg Ops' }).click();
  await expect(
    page.getByRole('heading', { name: 'Deal Registration Operations', level: 1 }),
  ).toBeVisible();

  // The review queue fails closed with its own named state; the ops
  // aggregate and the exclusivity card — different provider methods —
  // render their values right through it.
  const queue = cardWith(page, 'Registrations awaiting review');
  await expect(queue.getByText('Review queue unavailable:')).toBeVisible();
  await expect(tileWith(page, 'Pending past SLA')).toHaveText(/14/);
  await expect(
    cardWith(page, 'Exclusivity window').getByText(
      /44 approved registrations still without an opportunity/,
    ),
  ).toBeVisible();
  // The transport's raw prose stays out of the DOM.
  await expect(page.getByText(/failed in transit/)).toHaveCount(0);

  // The queue's own Retry refires just that page; the plan is spent, so the
  // queue recovers and the siblings never leave the screen.
  await queue.getByRole('button', { name: 'Retry review queue' }).click();
  await expect(queue.getByText('Showing 10 of 18 pending')).toBeVisible();
  await expect(queue.getByText('Review queue unavailable:')).toHaveCount(0);
  await expect(tileWith(page, 'Pending past SLA')).toHaveText(/14/);

  // No uncaught errors and no unexpected console errors. The one tolerated
  // record is the scripted failure itself: the telemetry seam captures every
  // provider error, and we forced listPendingRegistrations's first call.
  const scriptedFailure = /component: DataProvider, operation: listPendingRegistrations/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedFailure.test(text))).toEqual([]);
});
