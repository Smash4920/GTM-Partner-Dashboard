import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

const CATEGORIES = [
  ['Stale high-value deal', 17],
  ['Missing next step', 42],
  ['Slipping close date', 18],
  ['Registration SLA', 17],
  ['Partner-health deterioration', 5],
] as const;

test('VAL-ACT-001: primary navigation exposes the five-category session-only Action Center contract and bounded pages', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Action Center', exact: true })
    .click();
  await expect(page.getByRole('heading', { name: 'Demo policy', exact: true })).toBeVisible();
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  await expect(page.getByText(/session-only.*Refresh loses this state/)).toBeVisible();
  await expect(page.getByText(/simulated\/local-only.*no external delivery/)).toBeVisible();
  await expect(page.getByRole('group', { name: 'Action Center summary' })).toContainText(
    'As of Sep 18, 2026',
  );
  for (const [label, count] of CATEGORIES) {
    await expect(page.getByText(`${label}: ${count}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeEnabled();
  }
  await expect(page.getByTestId('action-item')).toHaveCount(25);
  const more = page.getByRole('button', { name: 'Load 25 more', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('action-item')).toHaveCount(50);
  await expect(more).toBeFocused();
  await expect(
    page.getByRole('group', { name: 'action items', exact: true }).getByRole('status'),
  ).toContainText('Showing 50 of 85 action items');
  expect(errors).toEqual([]);
});

test('VAL-ACT-012: all five evidence disclosures support keyboard and touch with same-origin entity context for all three kinds', async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const expectedEvidence = [
    /calendar days since (lastActivityAt|createdAt) baseline/,
    /Next step is blank; qualifying causes:/,
    /Expected close moved from .*calendar days later/,
    /submitted .*business days remaining/,
    /Prior window .*current window .*→/,
  ];
  const destinations = [
    'Forecasting',
    'Forecasting',
    'Forecasting',
    'Deal Registration Operations',
    'Partner Performance',
  ];
  for (const [index, [category]] of CATEGORIES.entries()) {
    await nav.getByRole('button', { name: 'Action Center', exact: true }).click();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('checkbox', { name: category, exact: true }).check();
    const row = page.getByTestId('action-item').first();
    await expect(row).toContainText(category);
    const id = await row.getAttribute('data-action-id');
    await expect(row).toContainText('Severity:');
    await expect(row).toContainText('Due:');
    await expect(row).toContainText('Exposure:');
    await expect(row).toContainText('Owner:');
    await expect(row).toContainText('Recommended action:');
    const disclosure = row.getByRole('button', { name: `Show evidence for ${id}`, exact: true });
    await disclosure.focus();
    await page.keyboard.press('Enter');
    const evidence = row.getByRole('region', { name: `Evidence for ${id}`, exact: true });
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    await expect(disclosure).toBeFocused();
    await expect(evidence).toContainText(expectedEvidence[index]);
    await expect(evidence).toContainText('As of Sep 18, 2026');
    await expect(evidence).toContainText('Lineage:');
    await expect(evidence).toContainText('mock-book');
    await page.keyboard.press('Space');
    await expect(evidence).toHaveCount(0);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    const link = row.getByRole('link', { name: /Open .* context/ });
    expect(new URL((await link.getAttribute('href'))!, page.url()).origin).toBe(
      new URL(page.url()).origin,
    );
    await link.click();
    await expect(
      page.getByRole('heading', { name: destinations[index], exact: true, level: 1 }),
    ).toBeVisible();
    const context = page.getByRole('region', { name: 'Action context' });
    await expect(context).toContainText(`Action context: ${id}`);
    await expect(context.getByRole('heading')).toBeFocused();
    if (index === 4)
      await expect(page.getByRole('combobox', { name: 'Partner', exact: true })).toHaveValue(
        id!.split(':')[1],
      );
    await context.getByRole('button', { name: 'Back to Action Center', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Registration SLA', exact: true }).check();
  const row = page.getByTestId('action-item').first();
  await row.getByRole('button', { name: /Show evidence/ }).tap();
  await expect(row.getByRole('region', { name: /Evidence for/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect(errors).toEqual([]);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});
