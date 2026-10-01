import { expect, test } from '@playwright/test';

test('VAL-ACT-003: policy applies only in Action Center, resets its cursor and reloads to defaults', async ({
  page,
}) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Action Center', exact: true }).click();
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  // The existing opaque flag-cohort id is not action state. No policy keys
  // or values may be added to either store.
  const initialStorage = await page.evaluate(() => [
    Object.entries(localStorage),
    Object.entries(sessionStorage),
  ]);
  const defaults = [
    ['High value (USD)', '400000'],
    ['Stale days (calendar)', '14'],
    ['Missing-step horizon (days)', '60'],
    ['Close-slip days (calendar)', '7'],
    ['Health-window days', '28'],
    ['Minimum deteriorating drivers', '2'],
  ];
  for (const [label, value] of defaults) await expect(page.getByLabel(label)).toHaveValue(value);
  await expect(page.getByText(/Policy is session-only.*Reload restores defaults/)).toBeVisible();
  await page.getByRole('button', { name: 'Load 25 more' }).click();
  await expect(page.getByText('Showing 50 of 85 action items')).toBeVisible();
  await page.getByLabel('Stale days (calendar)').fill('1');
  // Keyboard submit exercises the same atomic validation/apply path.
  await page.getByRole('button', { name: 'Apply demo policy' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('action-item')).toHaveCount(25);
  await expect(page.getByText('85 unique items', { exact: true })).toHaveCount(0);
  await nav.getByRole('button', { name: 'Forecasting', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Forecasting', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: 'Action Center', exact: true }).click();
  await expect(page.getByLabel('Stale days (calendar)')).toHaveValue('1');
  expect(
    await page.evaluate(() => [Object.entries(localStorage), Object.entries(sessionStorage)]),
  ).toEqual(initialStorage);
  await page.reload();
  await nav.getByRole('button', { name: 'Action Center', exact: true }).click();
  for (const [label, value] of defaults) await expect(page.getByLabel(label)).toHaveValue(value);
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => [Object.entries(localStorage), Object.entries(sessionStorage)]),
  ).toEqual(initialStorage);
  expect(errors).toEqual([]);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(requests.some((url) => url.includes('/@vite/client'))).toBe(false);
});
