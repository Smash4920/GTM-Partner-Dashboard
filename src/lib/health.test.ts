import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataProvider, ForecastSummary } from '../data/DataProvider';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { assessHealth, publishHealthArtifact, rollupStatus, runReadinessChecks } from './health';
import { clearFlagOverrides } from './telemetry/flags';
import { telemetry } from './telemetry/telemetry';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  root.id = 'root';
  root.appendChild(document.createElement('main'));
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  clearFlagOverrides();
  mountRoot();
});

afterEach(() => {
  clearFlagOverrides();
  vi.unstubAllEnvs();
  document.getElementById('root')?.remove();
  delete window.GTM_HEALTH;
  // The offline test shadows the prototype getter with an own property; delete
  // it so the navigator reports truthfully for the rest of this file again.
  Reflect.deleteProperty(window.navigator, 'onLine');
});

describe('rollupStatus', () => {
  it('is ok only when every check is ok', () => {
    expect(rollupStatus([{ name: 'a', status: 'ok' }])).toBe('ok');
    expect(
      rollupStatus([
        { name: 'a', status: 'ok' },
        { name: 'b', status: 'degraded' },
      ]),
    ).toBe('degraded');
    expect(
      rollupStatus([
        { name: 'a', status: 'degraded' },
        { name: 'b', status: 'unavailable' },
      ]),
    ).toBe('unavailable');
    expect(rollupStatus([])).toBe('ok');
  });
});

describe('runReadinessChecks', () => {
  it('reports a healthy session: shell mounted, online, flags valid, seam answering', async () => {
    const checks = await runReadinessChecks({ provider: new MockDataProvider() });

    const summary = Object.fromEntries(checks.map((check) => [check.name, check.status]));
    expect(summary).toEqual({
      appShell: 'ok',
      network: 'ok',
      flags: 'ok',
      telemetry: 'ok',
      errors: 'ok',
      dataSeam: 'ok',
    });
    const dataSeam = checks.find((check) => check.name === 'dataSeam');
    expect(dataSeam?.latencyMs).toBeGreaterThanOrEqual(0);
    expect(dataSeam?.detail).toContain('getForecastSummary');
  });

  it('marks the shell unavailable when nothing was rendered into the root', async () => {
    document.getElementById('root')?.remove();

    const checks = await runReadinessChecks({ provider: new MockDataProvider() });

    expect(checks.find((check) => check.name === 'appShell')?.status).toBe('unavailable');
  });

  it('marks the session degraded while the browser reports it is offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const checks = await runReadinessChecks({ provider: new MockDataProvider() });

    expect(checks.find((check) => check.name === 'network')?.detail).toContain('offline');
  });

  it('marks flags degraded when the build shipped a value it cannot parse', async () => {
    vi.stubEnv('VITE_FLAG_TELEMETRY_ENABLED', 'maybe');

    const checks = await runReadinessChecks({ provider: new MockDataProvider() });

    const flags = checks.find((check) => check.name === 'flags');
    expect(flags?.status).toBe('degraded');
    expect(flags?.detail).toContain('VITE_FLAG_TELEMETRY_ENABLED');
  });

  it('reads a failing collector through the telemetry check and degrades on it', async () => {
    const checks = await runReadinessChecks({
      provider: new MockDataProvider(),
      transportStatus: {
        enabled: true,
        endpoint: 'https://collector.test/ingest',
        queued: 3,
        shipped: 0,
        dropped: 9,
        failedBatches: 2,
        lastDeliveryAt: null,
        lastFailureAt: '2026-09-18T00:00:00.000Z',
        lastFailureReason: 'collector responded 503',
      },
    });

    const telemetryCheck = checks.find((check) => check.name === 'telemetry');
    expect(telemetryCheck?.status).toBe('degraded');
    expect(telemetryCheck?.detail).toContain('collector responded 503');
  });

  it('keeps the telemetry check green through recoverable batch failures', async () => {
    const checks = await runReadinessChecks({
      provider: new MockDataProvider(),
      transportStatus: {
        enabled: true,
        endpoint: 'https://collector.test/ingest',
        queued: 0,
        shipped: 42,
        dropped: 2,
        failedBatches: 1,
        lastDeliveryAt: '2026-09-18T00:00:00.000Z',
        lastFailureAt: '2026-09-17T00:00:00.000Z',
        lastFailureReason: 'collector responded 502',
      },
    });

    const telemetryCheck = checks.find((check) => check.name === 'telemetry');
    expect(telemetryCheck?.status).toBe('ok');
    expect(telemetryCheck?.detail).toContain('42 envelopes delivered');
  });

  it('degrades the data seam past the healthy latency budget without failing it', async () => {
    const slow = new MockDataProvider();
    slow.getForecastSummary = async () => {
      await sleep(15);
      return {} as ForecastSummary;
    };

    const checks = await runReadinessChecks({
      provider: slow,
      healthyPingMs: 1,
      pingBudgetMs: 5_000,
    });

    const dataSeam = checks.find((check) => check.name === 'dataSeam');
    expect(dataSeam?.status).toBe('degraded');
    // Any measurable latency above the 1ms budget proves the check timed the
    // real call; wall-clock scheduling can fire a 15ms timer a tick early, so
    // the bound stays loose rather than flaky.
    expect(dataSeam?.latencyMs ?? 0).toBeGreaterThan(1);
  });

  it('marks the data seam unavailable when the provider throws or never answers in budget', async () => {
    const broken = new MockDataProvider();
    broken.getForecastSummary = async () => {
      throw new Error('CRM is down');
    };

    const checks = await runReadinessChecks({ provider: broken });

    const dataSeam = checks.find((check) => check.name === 'dataSeam');
    expect(dataSeam?.status).toBe('unavailable');
    expect(dataSeam?.detail).toBe('CRM is down');
  });

  it('cuts off a ping that exceeds its budget instead of waiting for it', async () => {
    const silent = new MockDataProvider();
    silent.getForecastSummary = (() => sleep(200) as unknown as Promise<ForecastSummary>) as (
      scope: Parameters<DataProvider['getForecastSummary']>[0],
    ) => Promise<ForecastSummary>;

    const checks = await runReadinessChecks({
      provider: silent,
      pingBudgetMs: 20,
    });

    const dataSeam = checks.find((check) => check.name === 'dataSeam');
    expect(dataSeam?.status).toBe('unavailable');
    expect(dataSeam?.detail).toContain('ping exceeded 20ms');
  });
});

describe('assessHealth', () => {
  it('folds the checks into one artifact stamped with the session context', async () => {
    const artifact = await assessHealth({ provider: new MockDataProvider() });

    expect(artifact.status).toBe('ok');
    expect(artifact.service).toBe('gtm-partner-dashboard');
    expect(artifact.environment).toBe(import.meta.env.MODE);
    expect(artifact.sessionId).toMatch(/^[0-9a-f]{32}$/);
    expect(artifact.checks).toHaveLength(6);
    expect(Number.isNaN(Date.parse(artifact.generatedAt))).toBe(false);
    expect(artifact.uptimeMs).toBeGreaterThanOrEqual(0);
  });
});

describe('publishHealthArtifact', () => {
  it('publishes the artifact on the page with a live refresh handle', async () => {
    const first = await assessHealth({ provider: new MockDataProvider() });
    publishHealthArtifact(first, () =>
      assessHealth({ provider: new MockDataProvider(), healthyPingMs: 0 }),
    );

    expect(window.GTM_HEALTH?.artifact.status).toBe('ok');
    expect(window.GTM_HEALTH?.checks).toHaveLength(6);

    const refreshed = await window.GTM_HEALTH?.refresh();

    expect(refreshed?.checks).toHaveLength(6);
    expect(window.GTM_HEALTH?.artifact).toBe(refreshed);
  });
});

describe('recent errors in the readiness report', () => {
  it('degrades the session once captures pass the budget', async () => {
    // Goes last in this file: the windowed counter is session state shared
    // with the singleton telemetry instance the health checks read.
    for (let index = 0; index < 5; index += 1) {
      telemetry.captureError(new Error(`synthetic failure ${index}`), {
        category: 'health-test',
        severity: 'info',
      });
    }

    const checks = await runReadinessChecks({ provider: new MockDataProvider() });

    const errors = checks.find((check) => check.name === 'errors');
    expect(errors?.status).toBe('degraded');
    expect(errors?.detail).toContain('5 captured errors');
  });
});
