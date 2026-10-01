import { expect, test } from '@playwright/test';

const PROSE = 'PRIVATE-forecast-prose-VAL-CROSS-003';
const FORECAST_AGGREGATES = [
  'getForecastSummary',
  'getWeightedForecast',
  'getForecastQuality',
  'getManagerForecastGroups',
  'getWeeklyForecastSeries',
];

test('VAL-CROSS-003: forecast overlays apply once with narrow calls, retained pages, internal context and private prose', async ({
  page,
}) => {
  const calls: string[] = [];
  const logs: unknown[] = [];
  const pending: Promise<void>[] = [];
  const errors: string[] = [];
  const requests: { url: string; method: string; body: string | null }[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' ||
      (message.type() === 'warning' && message.text().includes('of chart should be greater'))
    )
      errors.push(message.text());
    for (const argument of message.args()) {
      pending.push(
        argument.jsonValue().then((value: unknown) => {
          logs.push(value);
          if (typeof value !== 'object' || value === null) return;
          const record = value as Record<string, unknown>;
          if (record.component === 'DataProvider' && record.msg === 'Provider request started') {
            calls.push(String(record.operation));
          }
        }),
      );
    }
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  );
  const settle = async () => {
    await expect(page.getByText('Updating', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/· updating/)).toHaveCount(0);
    await Promise.all(pending);
  };
  const navigate = async (name: string) => {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name, exact: true })
      .click();
  };
  const ids = () =>
    page
      .locator('[data-opportunity-id]:visible')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-opportunity-id')));

  await page.goto('/');
  await navigate('Forecasting');
  await expect(page.locator('[data-opportunity-id]:visible').first()).toBeVisible();
  const forecastIds = await ids();
  const initialRow = page
    .locator('[data-opportunity-id]:visible')
    .filter({
      has: page.getByRole('button', { name: /^Edit forecast category for/ }),
    })
    .first();
  const entityId = (await initialRow.getAttribute('data-opportunity-id'))!;
  const row = page.locator(`[data-opportunity-id="${entityId}"]:visible`);
  const client = (await row.locator('td').first().locator('p').first().innerText()).trim();
  await navigate('Action Center');
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  const more = page.getByRole('button', { name: 'Load 25 more', exact: true });
  await more.click();
  await expect(page.getByTestId('action-item')).toHaveCount(50);
  await navigate('Forecasting');
  expect(await ids()).toEqual(forecastIds);
  await settle();

  const matrix = async (action: () => Promise<void>, expected: string[]) => {
    const before = calls.length;
    await action();
    await settle();
    expect(calls.slice(before).sort()).toEqual(expected.sort());
    expect(await ids()).toEqual(forecastIds);
  };
  const editText = async (field: string, value: string) => {
    const edit = row.getByRole('button', { name: new RegExp(`^(Edit|Add) ${field} for`) });
    await edit.click();
    await row
      .getByRole('textbox', {
        name: `${field[0].toUpperCase()}${field.slice(1)} for ${client}`,
        exact: true,
      })
      .fill(value);
    await page.keyboard.press('Enter');
    await expect(
      row.getByRole('button', { name: new RegExp(`^(Edit|Add) ${field} for`) }),
    ).toBeFocused();
  };
  await matrix(
    () => editText('revenue forecast', '1000000'),
    [
      ...FORECAST_AGGREGATES,
      'listQuarterOpportunities',
      'getActionCenterSummary',
      'listActionItems',
    ],
  );
  await expect(row).toContainText('$1,000,000');
  await matrix(async () => {
    await row.getByRole('button', { name: `Edit forecast category for ${client}` }).click();
    const category = row.getByRole('combobox', { name: `Forecast category for ${client}` });
    const current = await category.inputValue();
    await category.selectOption(current === 'commit' ? 'long-shot' : 'commit');
    await expect(
      row.getByRole('button', { name: `Edit forecast category for ${client}` }),
    ).toBeFocused();
  }, [
    'getWeightedForecast',
    'getForecastQuality',
    'getWeeklyForecastSeries',
    'listQuarterOpportunities',
  ]);

  // After membership-changing revenue, note refresh retains the newly loaded
  // Action Center window. Its prose must never enter the technical call key.
  await navigate('Action Center');
  await more.click();
  await expect(page.getByTestId('action-item')).toHaveCount(50);
  await navigate('Forecasting');
  await matrix(() => editText('note', PROSE), ['getActionCenterSummary', 'listActionItems']);
  await row.getByRole('button', { name: `View note for ${client}` }).click();
  await expect(row).toContainText(PROSE);
  await navigate('Action Center');
  await expect(page.getByTestId('action-item')).toHaveCount(50);
  await navigate('Forecasting');
  await matrix(() => editText('next step', PROSE), ['getActionCenterSummary', 'listActionItems']);
  await expect(row).toContainText(PROSE);
  await matrix(() => editText('next step', ''), ['getActionCenterSummary', 'listActionItems']);

  await navigate('Action Center');
  await page.getByRole('checkbox', { name: 'Missing next step', exact: true }).check();
  const action = page.locator(`[data-action-id="opportunity:${entityId}"]`);
  while (!(await action.count()) && (await more.getAttribute('aria-disabled')) !== 'true') {
    await more.click();
  }
  await expect(action).toBeVisible();
  await expect(action).toContainText('Exposure: $1,000,000');
  await action.getByRole('button', { name: /Show evidence/ }).click();
  await expect(action.getByRole('region', { name: /Evidence for/ })).toContainText(
    'Next step is blank; qualifying causes:',
  );
  const loadedIds = await page
    .getByTestId('action-item')
    .evaluateAll((items) => items.map((item) => item.getAttribute('data-action-id')));
  expect(new Set(loadedIds).size).toBe(loadedIds.length);
  const link = action.getByRole('link', { name: 'Open Forecasting context' });
  expect(new URL((await link.getAttribute('href'))!, page.url()).origin).toBe(
    new URL(page.url()).origin,
  );
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('region', { name: 'Action context' }).getByRole('heading'),
  ).toBeFocused();
  expect(await ids()).toEqual(forecastIds);
  await expect(row).toContainText('$1,000,000');
  await page.getByRole('button', { name: 'Back to Action Center' }).click();
  await expect(link).toBeFocused();
  await expect(page.getByRole('checkbox', { name: 'Missing next step' })).toBeChecked();
  expect(
    await page
      .getByTestId('action-item')
      .evaluateAll((items) => items.map((item) => item.getAttribute('data-action-id'))),
  ).toEqual(loadedIds);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await link.click();
  await editText('next step', PROSE);
  await page.getByRole('button', { name: 'Back to Action Center' }).click();
  await expect(action).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Action Center', level: 1 })).toBeFocused();
  await settle();
  expect(errors).toEqual([]);
  expect(JSON.stringify(logs)).not.toContain(PROSE);
  expect(JSON.stringify(requests)).not.toContain(PROSE);
  expect(
    requests.every(
      ({ url, method }) => new URL(url).origin === new URL(page.url()).origin && method === 'GET',
    ),
  ).toBe(true);
  expect(requests.some(({ url }) => url.includes('/@vite/client'))).toBe(false);
});
