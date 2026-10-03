import { expect, test } from '@playwright/test';

// Closed inventory from VAL-GOV-002. Production dependencies remain separate.
const FINAL_MIXED_SCOPE_ROWS = [
  'Enforce role, manager, and partner access on the server',
  'Normalize source records into a canonical partner',
  'Expose source lineage, last-refresh time',
  'Add approvals and SLAs for deal registrations',
  'Serve aggregated, paginated API responses',
  'Add observability for sync health',
  'Add automated unit, integration, end-to-end, accessibility, and security tests',
  'Deploy through separate development, staging, and production environments',
  'Define a feature-flag methodology',
  'Alerts for stale high-value deals',
  'Owner, due date, disposition, and workflow links',
  'Optimistic client updates',
] as const;

test('VAL-GOV-002: every approved demo outcome is Complete and production stays Prod Only', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Production Requirements', exact: true })
    .click();
  const evidence = [];
  for (const text of FINAL_MIXED_SCOPE_ROWS) {
    const row = page.locator('main li').filter({ hasText: text });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Demo: Complete', { exact: true })).toBeVisible();
    await expect(row.getByText('Production: Prod Only', { exact: true })).toBeVisible();
    await expect(row).toContainText('Demo today:');
    await expect(row).toContainText('Production blocker:');
    evidence.push({ text, rendered: await row.innerText() });
  }
  await expect(page.locator('main li').getByText('Demo: WIP', { exact: true })).toHaveCount(0);
  await testInfo.attach('final-mixed-scope-roadmap', {
    body: JSON.stringify(evidence, null, 2),
    contentType: 'application/json',
  });
});

/**
 * VAL-GOV-008: the Partner View picker is documented — in the product, on the
 * roadmap, and in prose — as an untrusted demo presentation selector. Client
 * filtering is not authorization, external use requires trusted sign-in and
 * server-enforced row access, and the roadmap item stays Demo: Pending. The
 * picker itself is intentionally unchanged.
 */
test('VAL-GOV-008: partner picker is labeled a demo selector, not authorization', async ({
  page,
}) => {
  await page.goto('/');

  const nav = page.getByRole('navigation', { name: 'Primary' });
  await nav.getByRole('button', { name: 'Partner View' }).click();

  // The visible note beside the unchanged picker states the boundary.
  const limitation = page.getByText(/Demo selector/);
  await expect(limitation).toBeVisible();
  await expect(limitation).toContainText(/client filtering is not authorization/i);
  await expect(limitation).toContainText(/trusted sign-in and server-enforced row access/i);
  // The picker still renders and still switches partners: no gating was added.
  const picker = page.getByLabel('Viewing as');
  await expect(picker).toBeVisible();
  const heading = page.getByRole('heading', { level: 1 });
  const initialPartner = await heading.textContent();
  const currentValue = await picker.inputValue();
  const optionValues = await picker
    .locator('option')
    .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
  const other = optionValues.find((value) => value !== currentValue);
  await picker.selectOption(other as string);
  await expect(heading).not.toHaveText(initialPartner ?? '');

  await nav.getByRole('button', { name: 'Production Requirements' }).click();
  const pickerRow = page
    .locator('li')
    .filter({ hasText: /Remove the partner picker outside an internal demo mode/ });
  await expect(pickerRow.getByText('Demo: Pending', { exact: true })).toBeVisible();
  await expect(pickerRow.getByText('Production: Prod Only', { exact: true })).toBeVisible();
  await expect(pickerRow).toContainText(/untrusted demo presentation selector/);
  await expect(pickerRow).toContainText(/filtering is not authorization/);
  await expect(pickerRow).toContainText(/trusted sign-in and server-enforced row access/);

  // The deferred Forecast Quality trend stays Pending with its prerequisites.
  const trendRow = page.locator('li').filter({ hasText: /Turn per-deal judgments into trend/ });
  await expect(trendRow.getByText('Demo: Pending', { exact: true })).toBeVisible();
  await expect(trendRow.getByText('Production: Prod Only', { exact: true })).toBeVisible();
  await expect(trendRow).toContainText(/immutable historical partner-manager ownership/);
  await expect(trendRow).toContainText(/authoritative stage-entry events/);
  await expect(trendRow).toContainText(/not substitutes/);
});

/**
 * VAL-GOV-012: the shipped runtime is only the Vite/React browser app and its
 * in-process providers. A full route walk of the default build makes no live
 * integration, telemetry, analytics, or webhook request — every request stays
 * on the preview origin — and no credential travels in a URL.
 */
test('VAL-GOV-012: default build makes no live integration or telemetry request', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Partner Performance Overview' })).toBeVisible();

  // Walk every route so any hidden integration or telemetry path would fire.
  const nav = page.getByRole('navigation', { name: 'Primary' });
  for (const route of [
    'Forecasting',
    'Deal Reg Ops',
    'Activity Tracking',
    'Partner View',
    'Data Connections',
    'Partner Performance',
    'Production Requirements',
    'Home',
  ]) {
    await nav.getByRole('button', { name: route }).click();
  }

  // Every request stayed on the local preview origin (or data/blob URLs):
  // no CRM, PRM, calendar, identity, warehouse, collector, or flag service.
  const origin = new URL(page.url()).origin;
  const remote = requests.filter(
    (url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'),
  );
  expect(remote).toEqual([]);

  const integration = requests.filter((url) =>
    /salesforce|hubspot|slack|googleapis|bigquery|snowflake|sentry|okta|auth0|segment|mixpanel|googletagmanager|google-analytics|collector|ingest|webhook|flags?\//i.test(
      url,
    ),
  );
  expect(integration).toEqual([]);

  // No request carries a credential-shaped query parameter.
  const credentialBearing = requests.filter((url) =>
    /[?&](api[-_]?key|token|secret|password|client[-_]?secret)=/i.test(url),
  );
  expect(credentialBearing).toEqual([]);
});
