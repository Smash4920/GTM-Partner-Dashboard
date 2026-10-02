import { expect, test } from '@playwright/test';

test('VAL-ACT-016: all five categories create selected-channel simulated local records without delivery', async ({
  page,
}) => {
  const requests: { url: string; method: string }[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  // Keep action time deterministic even when parallel axe scans take the
  // journey across a minute boundary. Native timers continue normally.
  await page.clock.setFixedTime(new Date('2026-10-01T12:34:56.000Z'));
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Action Center', exact: true })
    .click();
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  const before = await page.evaluate(() => [
    Object.entries(localStorage),
    Object.entries(sessionStorage),
  ]);
  const categories = [
    ['stale-high-value', 'Stale high-value deal'],
    ['missing-next-step', 'Missing next step'],
    ['close-date-slip', 'Slipping close date'],
    ['registration-sla', 'Registration SLA'],
    ['partner-health', 'Partner-health deterioration'],
  ];
  for (const [value, label] of categories) {
    await page.getByRole('checkbox', { name: label, exact: true }).check();
    const row = page.getByTestId('action-item').first();
    await expect(row).toContainText(label);
    const id = await row.getAttribute('data-action-id');
    await row.getByRole('button', { name: 'Notify owner', exact: true }).focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('region', { name: `Notification for ${id}` });
    await expect(panel.getByLabel('Subject')).toBeFocused();
    await expect(panel.getByRole('combobox', { name: 'To', exact: true })).toBeDisabled();
    await panel.getByLabel('Template').selectOption(value);
    await expect(panel.getByLabel('Subject')).toHaveValue(new RegExp(`^${label}:`));
    await expect(panel.getByLabel('Message')).toHaveValue(
      /Entity:.*Evidence:.*Recommended action:/,
    );
    await expect(panel.getByText(/session-only.*Refresh clears/)).toBeVisible();
    // Select one configured channel; neither email nor Slack is forced.
    for (const checkbox of await panel.getByRole('checkbox').all()) await checkbox.uncheck();
    await panel.getByRole('button', { name: /Send to/ }).click();
    await expect(panel.getByRole('checkbox').first()).toBeFocused();
    await expect(panel.getByText('Select at least one configured channel.')).toBeVisible();
    await panel.getByRole('checkbox', { name: 'Use Email' }).check();
    await panel.getByRole('button', { name: /Send to/ }).focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByText('Simulated / local only · 12:34 · email')).toBeVisible();
    await row.getByRole('button', { name: 'Close notification' }).click();
    await page.getByRole('checkbox', { name: label, exact: true }).uncheck();
    await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  }
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Data Connections', exact: true }).click();
  await expect(page.getByText('Sent this session · 5')).toBeVisible();
  const notificationLog = page
    .getByRole('heading', { name: 'Deal-registration SLA alerts' })
    .locator('xpath=ancestor::section[1]');
  for (const [, label] of categories)
    await expect(notificationLog.getByText(new RegExp(`^${label}:`)).first()).toBeVisible();
  expect(
    await page.evaluate(() => [Object.entries(localStorage), Object.entries(sessionStorage)]),
  ).toEqual(before);
  await page.reload();
  await nav.getByRole('button', { name: 'Data Connections', exact: true }).click();
  await expect(page.getByText('Sent this session · 0')).toBeVisible();
  expect(errors).toEqual([]);
  expect(
    requests.every(
      ({ url, method }) => new URL(url).origin === new URL(page.url()).origin && method === 'GET',
    ),
  ).toBe(true);
  expect(requests.some(({ url }) => url.includes('/@vite/client'))).toBe(false);
});

test('VAL-ACT-016: an unavailable recipient roster blocks composition and its focused retry recovers', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?remoteFailMethods=getTeamRoster:1');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Action Center', exact: true }).click();
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  const row = page.getByTestId('action-item').first();
  await row.getByRole('button', { name: 'Notify owner' }).click();
  const roster = page.getByRole('group', { name: 'action notification roster' });
  await expect(roster.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(page.getByLabel('Subject')).toHaveCount(0);
  await expect(page.getByTestId('action-item')).toHaveCount(25);
  await roster.getByRole('button', { name: 'Retry action notification roster' }).click();
  await expect(roster.getByLabel('Subject')).toBeVisible();
  await expect(roster.getByRole('button', { name: /Send to/ })).toBeEnabled();
  expect(errors).toEqual([]);
});
