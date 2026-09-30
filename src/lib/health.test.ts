import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataProvider, ForecastSummary } from '../data/DataProvider';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import type { QueryResult } from '../data/queryMetadata';
import {
  assessHealth,
  publishHealthArtifact,
  rollupStatus,
  runReadinessChecks,
  shellHealthArtifact,
  unavailableDataSeamCheck,
} from './health';
import type { HealthArtifact } from './health';
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
    const real = slow.getForecastSummary.bind(slow);
    slow.getForecastSummary = async (access, scope) => {
      await sleep(15);
      return real(access, scope);
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
    silent.getForecastSummary = (() =>
      sleep(200) as unknown as Promise<QueryResult<ForecastSummary>>) as (
      scope: Parameters<DataProvider['getForecastSummary']>[0],
    ) => Promise<QueryResult<ForecastSummary>>;

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

  it('reports no transition when none was ever requested', async () => {
    const artifact = await assessHealth({ provider: new MockDataProvider() });

    expect(artifact.requestedProviderId).toBeNull();
    expect(artifact.providerTransitionStatus).toBe('none');
  });

  it('distinguishes the requested provider from the committed one mid-transition', async () => {
    const artifact = await assessHealth({
      provider: new MockDataProvider(),
      transition: { requestedId: 'remote', status: 'committing' },
    });

    // The committed provider is still local; the request for the remote one
    // is in flight. An operator reading the artifact can tell both halves.
    expect(artifact.requestedProviderId).toBe('remote');
    expect(artifact.providerTransitionStatus).toBe('committing');
  });

  it('names a failed provider transition in the artifact', async () => {
    const artifact = await assessHealth({
      provider: new MockDataProvider(),
      transition: { requestedId: 'remote', status: 'failed' },
    });

    expect(artifact.providerTransitionStatus).toBe('failed');
  });
});

describe('shellHealthArtifact and the unavailable seam (VAL-RES-008)', () => {
  it('produces a provisional artifact before any check has run', () => {
    const artifact = shellHealthArtifact();

    // Published at mount, so the endpoint exists even when the assessment
    // never will: the shell reports itself, and the seam is marked as not
    // yet assessed rather than silently absent or optimistically ok.
    expect(artifact.status).toBe('degraded');
    expect(artifact.service).toBe('gtm-partner-dashboard');
    expect(artifact.checks.map((check) => check.name)).toEqual(['appShell', 'dataSeam']);
    expect(artifact.checks[1]?.detail).toBe('readiness checks still running');
  });

  it('the unavailable seam check is a named check, not a missing one', async () => {
    const check = unavailableDataSeamCheck('CRM is down');
    expect(check).toEqual({ name: 'dataSeam', status: 'unavailable', detail: 'CRM is down' });

    // And a failed provider really does roll the whole artifact up to
    // unavailable, so "window.GTM_HEALTH exists" can never be mistaken for
    // "the app is healthy".
    const broken = new MockDataProvider();
    broken.getForecastSummary = async () => {
      throw new Error('CRM is down');
    };
    const artifact = await assessHealth({ provider: broken });
    expect(artifact.status).toBe('unavailable');
    expect(artifact.checks.find((entry) => entry.name === 'dataSeam')).toMatchObject({
      status: 'unavailable',
      detail: 'CRM is down',
    });
  });
});

/** A publishable artifact carrying only the identity a race test cares about. */
function artifactFor(providerId: string, status: HealthArtifact['status']): HealthArtifact {
  return { ...shellHealthArtifact(), providerId, status };
}

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

  it('a refresh settling after a newer provider published cannot overwrite it', async () => {
    // Provider A's artifact is live and A's refresh is slow. B commits and
    // re-publishes while A is still in flight. When A's stale answer finally
    // settles, B's artifact must survive — and the stale caller is handed
    // the truth that outlived it, not its own answer.
    const a = artifactFor('local', 'ok');
    let resolveA!: (artifact: HealthArtifact) => void;
    const slowA = new Promise<HealthArtifact>((resolve) => {
      resolveA = resolve;
    });
    publishHealthArtifact(a, () => slowA);

    const inFlight = window.GTM_HEALTH!.refresh();

    const b = artifactFor('remote', 'ok');
    publishHealthArtifact(b, async () => b);
    expect(window.GTM_HEALTH?.artifact).toBe(b);

    resolveA(artifactFor('local', 'unavailable'));
    const settled = await inFlight;

    expect(window.GTM_HEALTH?.artifact).toBe(b);
    expect(settled).toBe(b);
  });

  it('a refresh whose answer names another provider cannot overwrite the published artifact', async () => {
    // Even within one generation, an assessment that ran against a seam the
    // session has since left behind is stale.
    const a = artifactFor('local', 'ok');
    publishHealthArtifact(a, async () => artifactFor('remote', 'unavailable'));

    const settled = await window.GTM_HEALTH!.refresh();

    expect(window.GTM_HEALTH?.artifact).toBe(a);
    expect(settled).toBe(a);
  });

  it('a superseded refresh loses to the newer refresh', async () => {
    // Two overlapping refreshes against the same publication: the one that
    // started first settles last, and its older answer must not clobber the
    // newer refresh's result.
    const a = artifactFor('local', 'ok');
    const older = artifactFor('local', 'degraded');
    const newer = artifactFor('local', 'ok');
    let resolveOld!: (artifact: HealthArtifact) => void;
    const slow = new Promise<HealthArtifact>((resolve) => {
      resolveOld = resolve;
    });

    let calls = 0;
    publishHealthArtifact(a, () => (calls++ === 0 ? slow : Promise.resolve(newer)));

    const first = window.GTM_HEALTH!.refresh();
    const second = await window.GTM_HEALTH!.refresh();
    expect(second).toBe(newer);

    resolveOld(older);
    const firstResult = await first;

    expect(window.GTM_HEALTH?.artifact).toBe(newer);
    expect(firstResult).toBe(newer);
  });

  it('a refresh that returns null changes nothing', async () => {
    // The caller declined to refresh (the committed provider moved while the
    // assessment ran); the published artifact stays exactly as it was.
    const a = artifactFor('local', 'ok');
    publishHealthArtifact(a, async () => null);

    const settled = await window.GTM_HEALTH!.refresh();

    expect(window.GTM_HEALTH?.artifact).toBe(a);
    expect(settled).toBe(a);
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
