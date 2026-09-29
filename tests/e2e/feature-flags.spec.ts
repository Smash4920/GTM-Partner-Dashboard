import { expect, test } from '@playwright/test';

/**
 * VAL-GOV-007: feature flags remain local and non-authoritative.
 *
 * The demo's only flag inputs are build-time environment values; there is no
 * remote flag service, no privileged control UI, and no approval or emergency
 * control claim. The authenticated production control plane stays labeled
 * Prod Only on the roadmap. This spec captures every network request while
 * walking all nine routes and asserts nothing calls a flag service.
 */
test('VAL-GOV-007: feature flags stay local, non-authoritative, and make no remote request', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Partner Performance Overview' })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Production Requirements' }).click();
  await expect(page.getByRole('heading', { name: 'Production Requirements' })).toBeVisible();

  // The completed governance and fail-safe rows describe local,
  // non-authoritative evaluation that cannot alter access scope.
  const methodologyRow = page.locator('li').filter({
    hasText: /Define a feature-flag methodology/,
  });
  await expect(methodologyRow.getByText('Demo: Complete', { exact: true })).toBeVisible();
  const failSafeRow = page.locator('li').filter({
    hasText: /authorization and data-access enforcement independent/,
  });
  await expect(failSafeRow.getByText('Demo: Complete', { exact: true })).toBeVisible();
  await expect(failSafeRow).toContainText(/non-authoritative/);
  await expect(failSafeRow).toContainText(/never alter demo access scope, roles, or returned rows/);

  // The authenticated control plane is explicitly not built: Demo: Pending
  // plus Production: Prod Only.
  const controlPlaneRow = page.locator('li').filter({ hasText: /authenticated control plane/ });
  await expect(controlPlaneRow.getByText('Demo: Pending', { exact: true })).toBeVisible();
  await expect(controlPlaneRow.getByText('Production: Prod Only', { exact: true })).toBeVisible();
  await expect(controlPlaneRow).toContainText(/needs a server and identity/);

  // No remote or privileged flag control UI exists on any route: no flag
  // toggles, no approval or emergency-kill controls, no "control plane" forms.
  for (const route of [
    'Forecasting',
    'Deal Reg Ops',
    'Activity Tracking',
    'Partner View',
    'Data Connections',
    'Partner Performance',
    'Home',
    'Production Requirements',
  ]) {
    await nav.getByRole('button', { name: route }).click();
  }
  await expect(page.getByRole('switch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /flag|rollout|kill switch/i })).toHaveCount(0);
  await expect(page.getByLabel(/flag|rollout/i)).toHaveCount(0);

  // Every request stayed on the local static preview origin (or data/blob
  // URLs); nothing called a flag service or any other remote endpoint.
  const origin = new URL(page.url()).origin;
  const remote = requests.filter(
    (url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'),
  );
  expect(remote).toEqual([]);
  expect(requests.filter((url) => /flags?\//i.test(new URL(url).pathname))).toEqual([]);
});
