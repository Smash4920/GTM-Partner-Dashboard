import { defineConfig, devices } from '@playwright/test';

const port = 4173;
const baseURL = `http://127.0.0.1:${port}`;
const fixtureRun = process.env.E2E_TARGET_FIXTURES === '1';
const discovery = process.env.E2E_DISCOVERY === '1';
const productionPreview = process.env.E2E_PRODUCTION_PREVIEW === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: fixtureRun ? '**/target-state-fixtures.spec.ts' : undefined,
  testIgnore: fixtureRun || discovery ? undefined : '**/target-state-fixtures.spec.ts',
  fullyParallel: !fixtureRun,
  forbidOnly: Boolean(process.env.CI),
  retries: fixtureRun ? 0 : process.env.CI ? 2 : 0,
  workers: fixtureRun ? 1 : process.env.CI ? 1 : undefined,
  // Ordinary browser cleanup must not erase the gate's Vitest JUnit report.
  outputDir: fixtureRun ? 'build-metrics/target-state-fixtures/results' : 'test-results/e2e',
  reporter: fixtureRun
    ? [
        ['list'],
        ['html', { open: 'never', outputFolder: 'build-metrics/target-state-fixtures/report' }],
      ]
    : process.env.CI
      ? [['github'], ['html', { open: 'never' }]]
      : 'list',
  use: {
    baseURL,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer:
    fixtureRun || discovery
      ? undefined
      : {
          command: productionPreview
            ? `npm run build && sh -c 'echo $$ > "\${E2E_PREVIEW_PID_FILE:-build-metrics/e2e-preview.pid}"; exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port ${port} --strictPort'`
            : `npm run dev -- --host 127.0.0.1 --port ${port}`,
          env: {
            BASE_PATH: '/',
            // Technical seam logs let browser tests count focused retries.
            VITE_LOG_LEVEL: 'debug',
          },
          reuseExistingServer: productionPreview ? false : !process.env.CI,
          timeout: 120_000,
          url: baseURL,
        },
});
