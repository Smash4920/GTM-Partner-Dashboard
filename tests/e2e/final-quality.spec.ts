import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('VAL-QUAL-001: the artifact retains the complete blocking gate and effective ratchets', async ({
  page,
}, testInfo) => {
  const policy = execFileSync(process.execPath, ['scripts/check-quality-policy.mjs'], {
    encoding: 'utf8',
  });
  expect(policy).toContain('17 blocking gate steps');
  expect(policy).toContain('coverage 95/90/96/96%');
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Partner Performance Overview' })).toBeVisible();
  const scripts = await page
    .locator('script[src]')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('src')));
  expect(scripts.some((source) => /\/assets\/index-[\w-]+\.js$/.test(source ?? ''))).toBe(true);
  expect(requests.some((url) => /@vite\/client|hot-update|localhost:5173/.test(url))).toBe(false);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  await testInfo.attach('effective-quality-policy-and-artifact', {
    body: JSON.stringify({ policy, scripts, requests }, null, 2),
    contentType: 'application/json',
  });
});
