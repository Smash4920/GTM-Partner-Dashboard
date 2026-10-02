import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { DATA_PROVIDER_METHODS } from '../../src/data/DataProvider';
import { SCALED_FAILURE_ROUTES, settleScaled, visitScaled } from './support/scaled-retry';
import { startTargetPreview, type TargetState } from './support/target-preview';

test('VAL-RES-011: built Scaled 100× isolates failure and exact one-query retry on all eight data routes', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const preview = await startTargetPreview('scaled-retry');
  const requests: { url: string; method: string; type: string }[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const sockets: string[] = [];
  const observations: Record<string, unknown>[] = [];
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      type: request.resourceType(),
    }),
  );
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(preview.url);
    await settleScaled(page);
    await visitScaled(page, 'Production Requirements');
    await page.getByLabel('Data provider').selectOption('scaled');
    await expect(page.getByText(/100 copies of the book/)).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => window.GTM_HEALTH?.artifact.providerId))
      .toBe('scaled');
    await settleScaled(page);
    expect(
      await page.evaluate(() => ({
        scale: window.scaledRetryFixture.scale,
        size: window.scaledRetryFixture.size,
      })),
    ).toEqual({ scale: 100, size: { partners: 2500, opportunities: 21300 } });

    for (const spec of SCALED_FAILURE_ROUTES) {
      // Arm only after unmounting the previous route; shared methods cannot
      // consume the one-shot failure on landing Home or a prior sibling.
      const staticBefore = await page.evaluate(() => ({ ...window.scaledRetryFixture.calls }));
      await visitScaled(page, 'Production Requirements');
      expect(await page.evaluate(() => window.scaledRetryFixture.calls)).toEqual(staticBefore);
      await page.evaluate((method) => window.scaledRetryFixture.arm(method), spec.method);
      const failedBefore = await page.evaluate(
        (method) => ({
          calls: window.scaledRetryFixture.calls[method] ?? 0,
          delegated: window.scaledRetryFixture.delegated[method] ?? 0,
          failures: window.scaledRetryFixture.failures[method] ?? 0,
        }),
        spec.method,
      );
      await visitScaled(page, spec.route);
      const region = page.getByRole('group', { name: spec.region, exact: true });
      await expect(region.getByText(spec.failure, { exact: true })).toBeVisible();
      expect(
        await page.evaluate(
          (method) => ({
            calls: window.scaledRetryFixture.calls[method],
            delegated: window.scaledRetryFixture.delegated[method] ?? 0,
            failures: window.scaledRetryFixture.failures[method],
            armed: window.scaledRetryFixture.armed,
          }),
          spec.method,
        ),
      ).toEqual({
        calls: failedBefore.calls + 1,
        delegated: failedBefore.delegated,
        failures: failedBefore.failures + 1,
        armed: null,
      });
      await spec.sibling(page);
      await settleScaled(page);
      await expect(region.getByText(spec.failure, { exact: true })).toBeVisible();
      const retained = await spec.retained(page);
      const before = await page.evaluate(() => ({
        calls: { ...window.scaledRetryFixture.calls },
        delegated: { ...window.scaledRetryFixture.delegated },
      }));
      const slug = spec.route.toLowerCase().replaceAll(' ', '-');
      await region.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath(`${slug}-unavailable.png`) });
      await region.getByRole('button', { name: `Retry ${spec.region}`, exact: true }).click();
      await expect(region.getByText(spec.failure, { exact: true })).toHaveCount(0);
      await expect(region).toBeFocused();
      await settleScaled(page);
      const after = await page.evaluate(() => ({
        calls: { ...window.scaledRetryFixture.calls },
        delegated: { ...window.scaledRetryFixture.delegated },
      }));
      expect(after.calls).toEqual({
        ...before.calls,
        [spec.method]: before.calls[spec.method] + 1,
      });
      expect(after.delegated).toEqual({
        ...before.delegated,
        [spec.method]: (before.delegated[spec.method] ?? 0) + 1,
      });
      expect(await spec.retained(page)).toEqual(retained);
      await expect(page.getByText(/unavailable:|Something went wrong here/)).toHaveCount(0);
      await expect(page.getByLabel('Data provider')).toHaveValue('scaled');
      expect(await page.evaluate(() => window.GTM_HEALTH?.artifact.providerId)).toBe('scaled');
      await page.screenshot({ path: testInfo.outputPath(`${slug}-recovered.png`) });
      observations.push({
        route: spec.route,
        method: spec.method,
        failure: spec.failure,
        retry: `Retry ${spec.region}`,
        before,
        after,
        retainedSibling: true,
        recoveredFocus: spec.region,
      });
    }
    const counters = await page.evaluate(() => ({
      calls: window.scaledRetryFixture.calls,
      delegated: window.scaledRetryFixture.delegated,
      failures: window.scaledRetryFixture.failures,
      signals: window.scaledRetryFixture.signals,
    }));
    expect(
      Object.keys(counters.calls).every((method) =>
        (DATA_PROVIDER_METHODS as readonly string[]).includes(method),
      ),
    ).toBe(true);
    expect(counters.signals).toEqual(counters.calls);
    expect(Object.values(counters.failures).reduce((sum, count) => sum + count, 0)).toBe(8);
    observations.push({ counters });
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(sockets).toEqual([]);
    expect(
      requests.every(
        (request) =>
          new URL(request.url).origin === 'http://127.0.0.1:4173' && request.method === 'GET',
      ),
    ).toBe(true);
    expect(requests.some((request) => /\/assets\/[^/]+-[\w-]+\.js$/.test(request.url))).toBe(true);
    expect(
      requests.some((request) => /@vite|@react-refresh|\/src\/|\.test\.tsx/.test(request.url)),
    ).toBe(false);
  } finally {
    const teardown = await preview.stop();
    const path = testInfo.outputPath('VAL-RES-011-scaled-retry-evidence.json');
    await writeFile(
      path,
      JSON.stringify(
        {
          preview,
          observations,
          requests,
          sockets,
          consoleErrors,
          pageErrors,
          teardown,
        },
        null,
        2,
      ),
    );
    await testInfo.attach('VAL-RES-011-scaled-retry-evidence.json', {
      path,
      contentType: 'application/json',
    });
  }
});

const STATES: TargetState[] = ['finite', 'no-target', 'target-met'];
const ROUTES = ['Home', 'Forecasting', 'Partner Performance', 'Partner View'] as const;
const LABELS = [
  'Partner sourced pipeline coverage',
  'Pipeline coverage to goal',
  'Pipeline coverage',
  'Open pipeline',
];

test('VAL-CROSS-006: isolated built startup failure, partial actions, summary failure and failed page recover independently', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const preview = await startTargetPreview('action-resilience');
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  try {
    await page.goto(preview.url);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.GTM_HEALTH?.checks.find((check) => check.name === 'dataSeam')?.status,
        ),
      )
      .toBe('unavailable');
    expect(JSON.stringify(await page.evaluate(() => window.GTM_HEALTH?.artifact))).not.toContain(
      'PRIVATE',
    );
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('button', { name: 'Production Requirements', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Production Requirements', level: 1 }),
    ).toBeVisible();
    await nav.getByRole('button', { name: 'Data Connections', exact: true }).click();
    await page.getByRole('button', { name: /^Salesforce/ }).click();
    await expect(page.getByRole('heading', { name: 'Salesforce', level: 3 })).toBeVisible();
    await nav.getByRole('button', { name: 'Action Center', exact: true }).click();
    const summary = page.getByRole('group', { name: 'Action Center summary', exact: true });
    const items = page.getByRole('group', { name: 'action items', exact: true });
    const rows = page.getByTestId('action-item');
    await expect(
      summary.getByText('Action Center summary unavailable:', { exact: true }),
    ).toBeVisible();
    await expect(rows).toHaveCount(25);
    await expect(items).toContainText('provider local · partial');
    await expect(items).toContainText('Fixture: one opportunity lacks manager attribution');
    const first = await rows.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-action-id')),
    );
    await summary.getByRole('button', { name: 'Retry Action Center summary', exact: true }).click();
    await expect(summary).toContainText('85 unique items');
    await expect(summary).toBeFocused();
    expect(await page.evaluate(() => window.actionResilienceFixture.calls)).toMatchObject({
      getActionCenterSummary: 2,
      listActionItems: 1,
    });
    const more = page.getByRole('button', { name: 'Load 25 more', exact: true });
    await more.click();
    await expect(
      items.getByRole('button', { name: 'Retry action items', exact: true }),
    ).toBeVisible();
    await expect(more).toBeFocused();
    expect(
      await rows.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-action-id')),
      ),
    ).toEqual(first);
    await items.getByRole('button', { name: 'Retry action items', exact: true }).click();
    await expect(rows).toHaveCount(50);
    await expect(items).toBeFocused();
    expect(await page.evaluate(() => window.actionResilienceFixture.calls)).toMatchObject({
      getActionCenterSummary: 2,
      listActionItems: 3,
    });
    await expect(items).toContainText('partial');
    await expect(page.getByRole('status')).toContainText('Showing 50 of 85 action items');
    await expect(page.getByText(/PRIVATE|failed in transit/)).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(requests.every((url) => new URL(url).origin === new URL(preview.url).origin)).toBe(true);
    expect(requests.some((url) => /\/@vite\/client|\/src\//.test(url))).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('partial-and-recovered-actions.png') });
  } finally {
    const teardown = await preview.stop();
    await writeFile(
      testInfo.outputPath('fixture-lifecycle.json'),
      JSON.stringify({ preview, teardown }, null, 2),
    );
  }
});

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
