import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { startTargetPreview, type TargetState } from './support/target-preview';

const STATES: TargetState[] = ['finite', 'no-target', 'target-met'];
const ROUTES = ['Home', 'Forecasting', 'Partner Performance', 'Partner View'] as const;
const LABELS = [
  'Partner sourced pipeline coverage',
  'Pipeline coverage to goal',
  'Pipeline coverage',
  'Open pipeline',
];

function kpiTile(page: Page, label: string) {
  return page.getByText(label, { exact: true }).and(page.locator('p')).locator('..');
}

async function filterRoute(page: Page, route: (typeof ROUTES)[number]) {
  if (route === 'Forecasting' || route === 'Partner Performance') {
    await page.getByRole('combobox', { name: 'Partner manager', exact: true }).selectOption('pm-1');
    await expect(page.getByRole('combobox', { name: 'Partner manager', exact: true })).toHaveValue(
      'pm-1',
    );
  }
  if (route === 'Partner Performance') {
    await page.getByRole('combobox', { name: 'Partner', exact: true }).selectOption('partner-1');
    await expect(page.getByRole('combobox', { name: 'Partner', exact: true })).toHaveValue(
      'partner-1',
    );
  }
  if (route === 'Partner View') {
    await page.getByRole('combobox', { name: 'Viewing as' }).selectOption('partner-1');
    await expect(page.getByRole('combobox', { name: 'Viewing as' })).toHaveValue('partner-1');
  }
  if (route !== 'Forecasting') {
    await page.getByRole('button', { name: 'Q1', exact: true }).click();
    await page.getByRole('button', { name: 'Q3', exact: true }).click();
  }
}

for (const state of STATES) {
  test(`VAL-DATA-002: built ${state} fixture on all four routes`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const preview = await startTargetPreview(state);
    const requests: { url: string; method: string; type: string }[] = [];
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const sockets: string[] = [];
    const observations: { route: string; text: string; screenshot: string }[] = [];
    page.on('request', (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        type: request.resourceType(),
      });
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('websocket', (socket) => sockets.push(socket.url()));
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(preview.url);
      await expect(
        page.getByRole('heading', { name: 'Partner Performance Overview', exact: true }),
      ).toBeVisible();
      for (const route of ROUTES) {
        await page
          .getByRole('navigation', { name: 'Primary' })
          .getByRole('button', { name: route, exact: true })
          .click();
        await filterRoute(page, route);
        const tile = kpiTile(page, LABELS[ROUTES.indexOf(route)]);
        const expected =
          state === 'finite' ? '0.5x' : state === 'no-target' ? 'No target' : 'Target met';
        if (route === 'Partner View') {
          await expect(tile).toContainText(expected.toLowerCase());
          if (state === 'finite') await expect(tile).toContainText('1 open · 0.5x coverage');
        } else {
          await expect(tile.locator('p').nth(1)).toHaveText(expected);
          const subtitle =
            route === 'Forecasting'
              ? state === 'finite'
                ? '$500K goal remaining'
                : state === 'no-target'
                  ? 'No goal set'
                  : 'Goal achieved'
              : state === 'finite'
                ? '$500K sourced target remaining'
                : state === 'no-target'
                  ? 'No sourced target set'
                  : 'Sourced target achieved';
          await expect(tile).toContainText(subtitle);
        }
        if (state !== 'finite') await expect(tile).not.toContainText(/\d+(\.\d+)?x/);
        if (state === 'no-target') await expect(tile).not.toContainText(/target met/i);
        if (state === 'target-met') await expect(tile).not.toContainText(/no target/i);
        await expect(page.locator('body')).not.toContainText(/Infinity|NaN|∞/);
        const screenshot = `${state}-${route.toLowerCase().replaceAll(' ', '-')}.png`;
        await page.screenshot({ path: testInfo.outputPath(screenshot), fullPage: true });
        await testInfo.attach(screenshot, {
          path: testInfo.outputPath(screenshot),
          contentType: 'image/png',
        });
        observations.push({ route, text: (await tile.innerText()).trim(), screenshot });
      }
      expect(consoleErrors).toEqual([]);
      expect(pageErrors).toEqual([]);
      expect(sockets).toEqual([]);
      expect(requests.length).toBeGreaterThan(0);
      expect(
        requests.every((request) => new URL(request.url).origin === 'http://127.0.0.1:4173'),
      ).toBe(true);
      expect(requests.every((request) => request.method === 'GET')).toBe(true);
      expect(requests.some((request) => /\/assets\/[^/]+-[\w-]+\.js$/.test(request.url))).toBe(
        true,
      );
      expect(
        requests.some((request) => /@vite|@react-refresh|\/src\/|entry\.test/.test(request.url)),
      ).toBe(false);
      expect(preview.assets.every((asset) => /^[a-f0-9]{64}$/.test(asset.sha256))).toBe(true);
      expect(
        requests
          .filter((request) => ['script', 'stylesheet'].includes(request.type))
          .every((request) =>
            preview.assets.some((asset) => request.url.endsWith(`/assets/${asset.name}`)),
          ),
      ).toBe(true);
    } finally {
      const teardown = await preview.stop();
      const evidencePath = testInfo.outputPath('VAL-DATA-002-evidence.json');
      await writeFile(
        evidencePath,
        JSON.stringify(
          { state, preview, observations, requests, sockets, consoleErrors, pageErrors, teardown },
          null,
          2,
        ),
      );
      await testInfo.attach('VAL-DATA-002-evidence.json', {
        path: evidencePath,
        contentType: 'application/json',
      });
    }
  });
}
