import { expect, test, type Page } from '@playwright/test';

/**
 * VAL-DATA-014: Home and Partner Performance read the scoped contract.
 *
 * Three browser proofs on the deterministic seeded book:
 *
 * 1. Home renders the exact scoped aggregates the provider computes —
 *    nothing derived from a whole book in the browser — including the
 *    funnel measure toggle (a pure re-render of the same query answer) and
 *    the bounded four-quarter revenue trend.
 * 2. Partner Performance paginates its pipeline table by cursor
 *    (25-row pages, 65 in scope) and renders the scoped queue, leaderboard,
 *    and trend with their deterministic values.
 * 3. A scripted single-method failure on the simulated remote
 *    (?remoteFailMethods=getPerformanceSummary:1, see src/data/providers.ts)
 *    leaves the sibling widgets interactive, and the summary card's own
 *    Retry recovers it alone.
 */

const primaryNavigation = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

function metricValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..').locator('p').nth(1);
}

test('VAL-DATA-014: Home renders the exact scoped aggregates with a bounded trend', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview', level: 1 }),
  ).toBeVisible();

  // The default scope — whole ecosystem, Q3 — renders the provider's own
  // aggregates: 43 open opportunities worth $11.0M, $2.8M closed-won.
  await expect(metricValue(page, 'Partner sourced pipeline')).toHaveText(/^\$11(\.0)?M$/);
  await expect(page.getByText('43 open Q3 opps')).toBeVisible();
  await expect(metricValue(page, 'Closed-won Q3')).toHaveText(/^\$2\.8M$/);
  await expect(metricValue(page, 'Deal-reg approval')).toHaveText('91%');
  await expect(page.getByText('33 decided')).toBeVisible();
  await expect(metricValue(page, 'Reg → qualified opp')).toHaveText('73%');
  await expect(page.getByText('22 opps from reg')).toBeVisible();
  await expect(metricValue(page, 'Win rate Q3')).toHaveText('41%');
  await expect(metricValue(page, 'Active partners')).toHaveText('25');
  await expect(metricValue(page, 'Partner sourced pipeline coverage')).toHaveText('Target met');

  // The roster directory query feeds the header count.
  await expect(page.getByText('Whole ecosystem · 25 aligned partners')).toBeVisible();

  // The funnel card re-renders its one query answer across the measure
  // toggle: registered dollars by default, counts on the Count chip.
  const funnelCard = page
    .getByRole('heading', { name: 'Deal registration funnel' })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
  await expect(funnelCard.getByText('Submitted', { exact: true })).toBeVisible();
  await expect(funnelCard.getByText(/^\$4\.1M$/).first()).toBeVisible();
  await funnelCard.getByRole('button', { name: 'Count' }).click();
  await expect(funnelCard.getByText('51', { exact: true })).toBeVisible();
  await expect(funnelCard.getByText('18', { exact: true }).first()).toBeVisible();

  // The trend is bounded to the fiscal year's four quarters, not a history.
  const trendCard = page
    .getByRole('heading', { name: 'Revenue vs. partner sourced target' })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
  await expect(trendCard.getByText('FY27-Q1', { exact: true })).toBeVisible();
  await expect(trendCard.getByText('FY27-Q4', { exact: true })).toBeVisible();
  await expect(trendCard.getByText(/FY27-Q\d/, { exact: true })).toHaveCount(4);

  // The review queue reports its scoped total, not a browser-reduced count.
  await expect(
    page.getByText('18 pending · oldest first · colored against the 5-business-day SLA'),
  ).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('VAL-DATA-014: Partner Performance paginates the pipeline by cursor', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview', level: 1 }),
  ).toBeVisible();
  await primaryNavigation(page).getByRole('button', { name: 'Partner Performance' }).click();
  await expect(page.getByRole('heading', { name: 'Partner Performance', level: 1 })).toBeVisible();

  // 65 Q3 opportunities in scope, fetched 25 at a time: each click is one
  // more cursor page from the provider, never a re-slice of a whole list.
  await expect(page.getByText('65 Salesforce-shaped opportunities in scope')).toBeVisible();
  await expect(page.getByText('Showing 25 of 65')).toBeVisible();
  const loadMore = page.getByRole('button', { name: 'Load 25 more' });
  await loadMore.click();
  await expect(page.getByText('Showing 50 of 65')).toBeVisible();
  await loadMore.click();
  await expect(page.getByText('Showing 65 of 65')).toBeVisible();
  await expect(loadMore).toHaveCount(0);

  // Scoped siblings on the same route render their own answers.
  await expect(
    page.getByText('18 pending in scope · oldest first · colored against the 5-business-day SLA'),
  ).toBeVisible();
  const leaderboardCard = page
    .getByRole('heading', { name: 'Partner leaderboard & enablement' })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
  await expect(leaderboardCard.getByText('Kestrel Networks')).toBeVisible();
  await expect(page.getByText('All Partners').first()).toBeVisible();

  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('VAL-DATA-014: a failed Home widget retries alone while siblings stay live', async ({
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
  // simulated remote. The plan fails the first getPerformanceSummary call
  // only; every sibling method succeeds.
  await page.goto('/');
  await page.goto(`${page.url()}?remoteFailMethods=getPerformanceSummary:1`);
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview', level: 1 }),
  ).toBeVisible();
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();

  // The summary card fails closed with its own named state; the funnel —
  // a different provider method — renders its values right through it.
  await expect(page.getByText('Performance summary unavailable:')).toBeVisible();
  const funnelCard = page
    .getByRole('heading', { name: 'Deal registration funnel' })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
  await expect(funnelCard.getByText('Submitted', { exact: true })).toBeVisible();
  await expect(funnelCard.getByText(/^\$4\.1M$/).first()).toBeVisible();
  // The transport's raw prose stays out of the DOM.
  await expect(page.getByText(/failed in transit/)).toHaveCount(0);

  // The card's own Retry refires just that query; the plan is spent, so the
  // summary recovers and the funnel never leaves the screen.
  await page.getByRole('button', { name: 'Retry performance summary' }).click();
  await expect(metricValue(page, 'Partner sourced pipeline')).toHaveText(/^\$11(\.0)?M$/);
  await expect(page.getByText('Performance summary unavailable:')).toHaveCount(0);
  await expect(funnelCard.getByText(/^\$4\.1M$/).first()).toBeVisible();

  // No uncaught errors and no unexpected console errors. The one tolerated
  // record is the scripted failure itself: the telemetry seam captures every
  // provider error, and we forced getPerformanceSummary's first call.
  const scriptedFailure = /component: DataProvider, operation: getPerformanceSummary/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedFailure.test(text))).toEqual([]);
});
