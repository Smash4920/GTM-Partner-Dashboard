import { expect, type Locator, type Page } from '@playwright/test';
import type { DataProvider } from '../../../src/data/DataProvider';

export async function settleScaled(page: Page) {
  await expect(page.getByText(/^Loading /)).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Updating', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/· updating/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.scaledRetryFixture.pending)).toBe(0);
}

export async function visitScaled(page: Page, route: string) {
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: route, exact: true })
    .click();
  await settleScaled(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
}

async function rowIds(rows: Locator, attribute: string) {
  const ids = await rows.evaluateAll(
    (elements, name) => elements.map((element) => element.getAttribute(name)),
    attribute,
  );
  expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(true);
  expect(new Set(ids).size).toBe(ids.length);
  return ids;
}

interface ScaledFailure {
  route: string;
  method: keyof DataProvider;
  region: string;
  failure: string;
  sibling: (page: Page) => Promise<void>;
  retained: (page: Page) => Promise<unknown>;
}

const pipeline = (page: Page) =>
  page.getByRole('group', { name: 'pipeline opportunities', exact: true });
const book = (page: Page) => page.getByRole('region', { name: /^In-quarter opportunities/ });
const queue = (page: Page) => page.getByRole('group', { name: 'review queue', exact: true });
const actions = (page: Page) => page.getByTestId('action-item');
const funnel = (page: Page) =>
  page
    .getByRole('heading', { name: 'Deal registration funnel', exact: true })
    .locator('xpath=ancestor::section[1]');

// Closed inventory: every data-bearing route, with an independent sibling.
export const SCALED_FAILURE_ROUTES: ScaledFailure[] = [
  {
    route: 'Home',
    method: 'getPerformanceSummary',
    region: 'performance summary',
    failure: 'Performance summary unavailable:',
    sibling: async (page) => {
      await funnel(page).getByRole('button', { name: 'Count', exact: true }).click();
      await expect(funnel(page).getByText('Submitted', { exact: true })).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Partner leaderboard', exact: true }),
      ).toBeVisible();
    },
    retained: async (page) => funnel(page).innerText(),
  },
  {
    route: 'Partner Performance',
    method: 'getPerformanceSummary',
    region: 'performance summary',
    failure: 'Performance summary unavailable:',
    sibling: async (page) => {
      await expect(pipeline(page).locator('tbody tr')).toHaveCount(25);
      await pipeline(page).getByRole('button', { name: 'Load 25 more', exact: true }).click();
      await expect(pipeline(page).locator('tbody tr')).toHaveCount(50);
    },
    retained: async (page) => pipeline(page).locator('tbody tr').allTextContents(),
  },
  {
    route: 'Forecasting',
    method: 'getWeeklyForecastSeries',
    region: 'weekly series',
    failure: 'Weekly series unavailable:',
    sibling: async (page) => {
      await expect(page.getByText('Weighted forecast', { exact: true }).first()).toBeVisible();
      await expect(book(page).locator('tbody tr')).toHaveCount(25);
      await page.getByRole('button', { expanded: true }).filter({ hasText: /opps/ }).click();
      await expect(book(page)).toBeHidden();
      await page
        .getByRole('button', { expanded: false })
        .filter({ hasText: /opps/ })
        .first()
        .click();
      await expect(book(page)).toBeVisible();
    },
    retained: async (page) => rowIds(book(page).locator('tbody tr'), 'data-opportunity-id'),
  },
  {
    route: 'Deal Reg Ops',
    method: 'getPartnerRoster',
    region: 'partner roster',
    failure: 'Partner names unavailable — showing partner ids:',
    sibling: async (page) => {
      await expect(queue(page).locator('tbody tr')).toHaveCount(10);
      await expect(
        queue(page)
          .locator('td', { hasText: /^p-\d+(~\d+)?$/ })
          .first(),
      ).toBeVisible();
      await queue(page).getByRole('button', { name: 'Load 10 more', exact: true }).click();
      await expect(queue(page).locator('tbody tr')).toHaveCount(20);
    },
    // Names recover on retry, but row identity/count must not change.
    retained: async (page) =>
      queue(page)
        .locator('tbody tr')
        .evaluateAll((rows) => rows.map((row) => row.querySelector('td')?.textContent)),
  },
  {
    route: 'Activity Tracking',
    method: 'getWeeklyGoalProgress',
    region: 'weekly goal',
    failure: 'Weekly goal unavailable:',
    sibling: async (page) => {
      await expect(page.getByText('3000 meetings in scope')).toBeVisible();
      await page.getByRole('button', { name: 'Log Meetings', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /Log meetings ·/ });
      await expect(dialog.getByRole('combobox', { name: /Partner for .* meeting/ })).toHaveCount(
        25,
      );
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    },
    retained: async (page) => page.getByText('3000 meetings in scope').innerText(),
  },
  {
    route: 'Partner View',
    method: 'getTopPartnerLeaders',
    region: 'partner ranking',
    failure: 'Partner ranking unavailable:',
    sibling: async (page) => {
      // An explicit selection prevents ranking recovery from changing scope.
      await page.getByLabel('Viewing as').selectOption('p-02');
      await settleScaled(page);
      await expect(
        page.getByRole('heading', { name: 'BrightPath Consulting', level: 1 }),
      ).toBeVisible();
      await expect(page.getByText('Open pipeline', { exact: true })).toBeVisible();
    },
    retained: async (page) => page.getByRole('heading', { level: 1 }).innerText(),
  },
  {
    route: 'Settings',
    method: 'getTeamRoster',
    region: 'The team roster',
    failure: 'The team roster unavailable:',
    sibling: async (page) => {
      await expect(
        page
          .getByRole('group', { name: 'The SLA alert queue', exact: true })
          .getByRole('button', { name: 'Notify owner', exact: true })
          .first(),
      ).toBeEnabled();
    },
    retained: async (page) =>
      page.getByRole('group', { name: 'The SLA alert queue', exact: true }).innerText(),
  },
  {
    route: 'Action Center',
    method: 'getActionCenterSummary',
    region: 'Action Center summary',
    failure: 'Action Center summary unavailable:',
    sibling: async (page) => {
      await expect(actions(page)).toHaveCount(25);
      const first = await rowIds(actions(page), 'data-action-id');
      await page.getByRole('button', { name: 'Load 25 more', exact: true }).click();
      await expect(actions(page)).toHaveCount(50);
      expect((await rowIds(actions(page), 'data-action-id')).slice(0, 25)).toEqual(first);
    },
    retained: async (page) => rowIds(actions(page), 'data-action-id'),
  },
];
