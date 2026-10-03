import { expect, test } from '@playwright/test';

/**
 * VAL-SEC-001 / VAL-SEC-002 / VAL-SEC-006, browser level: with the default
 * configuration — no collector endpoint, no analytics measurement ID — a full
 * route walk makes zero requests to any telemetry, analytics, or webhook
 * destination, loads no third-party script, and the health artifact reports
 * telemetry as in-process only.
 *
 * The unit suites pin the master switch itself (off means zero egress even
 * with an endpoint configured); this spec proves the shipped default build
 * never drifts into calling out.
 */
test('VAL-SEC-001: default build makes no telemetry, analytics, or webhook requests', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Partner Performance Overview' })).toBeVisible();

  // Walk every route so each view's telemetry paths (route views, provider
  // spans, health reports) have a chance to fire.
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

  // The health artifact is local: it refreshes in-process and reports the
  // collector as not configured.
  const telemetryDetail = await page.evaluate(async () => {
    const health = (
      window as unknown as {
        GTM_HEALTH?: { refresh: () => Promise<{ checks: { name: string; detail: string }[] }> };
      }
    ).GTM_HEALTH;
    const artifact = await health?.refresh();
    return artifact?.checks.find((check) => check.name === 'telemetry')?.detail ?? null;
  });
  expect(telemetryDetail).toContain('collector not configured');

  // Every request stayed on the preview origin (or data/blob URLs): no
  // collector, analytics beacon, webhook, or third-party script was touched.
  const origin = new URL(page.url()).origin;
  const remote = requests.filter(
    (url) => !url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:'),
  );
  expect(remote).toEqual([]);

  const egress = requests.filter((url) =>
    /googletagmanager|google-analytics|sentry|ingest|collector|webhook|\/collect\b/i.test(url),
  );
  expect(egress).toEqual([]);
});
