import { expect, test, type Page } from '@playwright/test';

/**
 * VAL-RES-010: Browser provider switching never mislabels data.
 *
 * The flow, all from the Forecasting route:
 *
 *   local (edit + narrowed selection)
 *     → request Simulated remote, whose first call is scripted to fail
 *       (?remoteFailFirst=1, see src/data/providers.ts)
 *     → failure state: Local mock stays committed — label, rows, and the edit
 *     → Retry: the probe passes, and label and rows commit together while the
 *       session edit and the selection stay behind
 *     → Scaled 100×: a disjoint book replaces label and rows together again.
 *
 * The `remoteFailFirst` plan exists so the failure is deterministic: the
 * seeded 15% draw would make the outcome depend on call order.
 */

const REMOTE_BANNER = /round trips with a 15% simulated failure rate/;
const SCALED_BANNER = /100 copies of the book/;

function metricValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..').locator('p').nth(1);
}

test('VAL-RES-010: switching local → failed remote → retried remote → scaled never renders mixed-source content', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  // Boot on the local mock, then attach the failure plan to the resolved URL
  // (the production preview redirects to its base path first).
  await page.goto('/');
  await page.goto(`${page.url()}?remoteFailFirst=1`);
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview', level: 1 }),
  ).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Forecasting' })
    .click();
  await expect(page.getByRole('heading', { name: 'Forecasting', level: 1 })).toBeVisible();
  const pipeline = metricValue(page, 'Partner sourced pipeline');
  const localPipeline = await pipeline.textContent();
  expect(localPipeline).not.toBe('');

  // Session state scoped to the local provider: a narrowed manager selection
  // and a revenue edit.
  const managerFilter = page.getByLabel('Partner manager');
  await managerFilter.selectOption({ index: 1 });
  const table = page.getByRole('region', { name: 'In-quarter opportunities, scrollable' });
  // Anchor on the row position, not the edit button: once the editor opens
  // the button unmounts, and a locator chained off it would re-resolve to the
  // next row.
  const firstRow = table.getByRole('row').nth(1);
  await firstRow.getByRole('button', { name: /^Edit revenue forecast for / }).click();
  await firstRow.getByRole('textbox', { name: /^Revenue forecast for / }).fill('987654321');
  await firstRow.getByRole('button', { name: 'Save revenue' }).click();
  await expect(page.getByText('$987,654,321')).toBeVisible();
  await expect(pipeline).not.toHaveText(localPipeline ?? '');

  // Request the simulated remote: the scripted first call fails, so the
  // transition must surface a failure without disturbing what is on screen.
  await page.getByLabel('Data provider').selectOption('remote');
  const failureAlert = page.getByRole('alert');
  await expect(failureAlert).toContainText('Couldn’t switch to Simulated remote');
  await expect(failureAlert).toContainText('getForecastSummary failed in transit (simulated)');
  await expect(failureAlert).toContainText('Still using Local mock');

  // Requested versus committed: the selector shows the request, while the
  // banner, the figures, the rows, and the edit all remain the local
  // provider's.
  await expect(page.getByLabel('Data provider')).toHaveValue('remote');
  await expect(page.getByText(REMOTE_BANNER)).toHaveCount(0);
  await expect(page.getByText('$987,654,321')).toBeVisible();
  await expect(managerFilter).not.toHaveValue('all');
  await expect(pipeline).not.toHaveText(localPipeline ?? '');

  // Retry the same candidate: readiness passes this time, and the commit
  // replaces label and data together. The edit and the selection were scoped
  // to the local provider's generation and stay behind.
  await page.getByRole('button', { name: 'Retry switch to Simulated remote' }).click();
  await expect(page.getByText(REMOTE_BANNER)).toBeVisible();
  await expect(page.getByText('$987,654,321')).toHaveCount(0);
  await expect(managerFilter).toHaveValue('all');
  await expect(pipeline).toHaveText(localPipeline ?? '');
  await expect(table.getByRole('row').first()).toBeVisible();

  // On to the disjoint scaled book: label and 100× figures change together at
  // the commit, never before it.
  await page.getByLabel('Data provider').selectOption('scaled');
  await expect(page.getByText(SCALED_BANNER)).toBeVisible({ timeout: 60_000 });
  await expect(pipeline).not.toHaveText(localPipeline ?? '');
  await expect(table.getByText(/· copy \d+/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(REMOTE_BANNER)).toHaveCount(0);

  // No uncaught errors and no unexpected console errors anywhere in the
  // flow. The one tolerated record is the scripted probe failure itself: the
  // telemetry seam captures every provider error, and we forced the remote's
  // first getForecastSummary to fail on purpose.
  const scriptedProbeFailure = /component: DataProvider, operation: getForecastSummary/;
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((text) => !scriptedProbeFailure.test(text))).toEqual([]);
});
