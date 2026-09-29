import type { DataProvider } from '../data/DataProvider';
import { CURRENT_FISCAL_QUARTER } from '../data/constants';
import { TELEMETRY_STARTUP_EPOCH } from './telemetry/config';
import { flagIssues, flagSnapshot } from './telemetry/flags';
import { telemetry } from './telemetry/telemetry';
import type { TransportStatus } from './telemetry/transport';

/**
 * Runtime health for a deployed static app.
 *
 * A client-only SPA has no process to probe and no port to curl, so "health
 * check" here means two honest things rather than an empty stub:
 *
 * 1. A readiness assessment the running app performs on itself — is the shell
 *    mounted, is the data seam answering and how fast, is the browser online,
 *    did the build start with valid flags, is telemetry delivering, and how
 *    many errors has this session captured lately. Each check reports ok /
 *    degraded / unavailable with a latency or a reason, and the rollup is the
 *    worst result of the set.
 * 2. A public health artifact: the assessment as a JSON document, published at
 *    `window.GTM_HEALTH` on the deployed page. An operator (or a synthetic
 *    monitor, or an on-call engineer with the page open in a console) can run
 *    `await window.GTM_HEALTH.refresh()` and read exactly what the app
 *    believes about itself, on the release it is actually serving.
 *
 * The artifact is also shipped as a `health` telemetry envelope and alerts when
 * anything is short of ok, so a degraded deploy announces itself instead of
 * waiting to be asked.
 */

export type HealthStatus = 'ok' | 'degraded' | 'unavailable';

export interface HealthCheck {
  name: string;
  status: HealthStatus;
  latencyMs?: number;
  detail?: string;
}

export interface HealthArtifact {
  status: HealthStatus;
  service: string;
  release: string;
  environment: string;
  sessionId: string;
  route: string | null;
  /** The committed provider: the one whose answers are actually on screen. */
  providerId: string | null;
  /** The provider the operator last asked for, when it differs from the committed one. */
  requestedProviderId: string | null;
  /** Where the last provider request stands; 'none' when nothing was ever requested. */
  providerTransitionStatus: 'none' | 'committing' | 'committed' | 'failed';
  generatedAt: string;
  uptimeMs: number;
  checks: HealthCheck[];
}

/** What the page publishes as `window.GTM_HEALTH`. */
interface HealthEndpoint {
  /** The most recently assessed artifact. */
  readonly artifact: HealthArtifact;
  readonly checks: readonly HealthCheck[];
  /** Re-runs every check against the live runtime and returns the result. */
  refresh(): Promise<HealthArtifact>;
}

declare global {
  interface Window {
    GTM_HEALTH?: HealthEndpoint;
  }
}

export interface ReadinessOptions {
  /** The instrumented provider behind the app's data seam. */
  provider: DataProvider;
  /** Fiscal quarter the data-seam ping asks about; defaults to the snapshot quarter. */
  quarter?: string;
  /** How long the data-seam ping may take before the check is 'unavailable'. */
  pingBudgetMs?: number;
  /** Latency at or under counts as a healthy seam; above it, 'degraded'. */
  healthyPingMs?: number;
  now?: () => number;
  /** Window for the recent-error check. */
  recentErrorWindowMs?: number;
  /** Captures at or above this count in the window mark the session degraded. */
  recentErrorBudget?: number;
  /**
   * Overrides the telemetry transport status the check reads; a deployment
   * harness can assess against a status it already holds instead of the
   * running app's own.
   */
  transportStatus?: TransportStatus;
  /**
   * The requested-vs-committed provider transition, so the artifact can
   * distinguish "serving remote" from "still local while remote probes".
   */
  transition?: { requestedId: string; status: 'committing' | 'committed' | 'failed' };
}

const DEFAULT_PING_BUDGET_MS = 10_000;
/** Under two seconds is a healthy answer from the seam; the simulated remote wire lands at ~250 ms. */
const DEFAULT_HEALTHY_PING_MS = 2_000;
const DEFAULT_RECENT_ERROR_WINDOW_MS = 5 * 60_000;
const DEFAULT_RECENT_ERROR_BUDGET = 5;

const HEALTH_SERVICE = 'gtm-partner-dashboard';

/** Worst result wins: one unavailable check makes the artifact unavailable. */
export function rollupStatus(checks: readonly HealthCheck[]): HealthStatus {
  let status: HealthStatus = 'ok';
  for (const check of checks) {
    if (check.status === 'unavailable') return 'unavailable';
    if (check.status === 'degraded') status = 'degraded';
  }
  return status;
}

function appShellCheck(): HealthCheck {
  if (typeof document === 'undefined') {
    return { name: 'appShell', status: 'unavailable', detail: 'no document to render into' };
  }
  const root = document.getElementById('root');
  if (!root || root.childElementCount === 0) {
    return { name: 'appShell', status: 'unavailable', detail: 'React root is empty' };
  }
  return { name: 'appShell', status: 'ok', detail: `${root.childElementCount} root children` };
}

function networkCheck(): HealthCheck {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { name: 'network', status: 'degraded', detail: 'browser reports it is offline' };
  }
  return { name: 'network', status: 'ok', detail: 'browser reports it is online' };
}

function flagsCheck(): HealthCheck {
  const issues = flagIssues();
  if (issues.length > 0) {
    return { name: 'flags', status: 'degraded', detail: issues.join('; ') };
  }
  const enabled = flagSnapshot().filter((flag) => flag.enabled).length;
  return { name: 'flags', status: 'ok', detail: `${enabled} flags enabled` };
}

function telemetryCheck(status: TransportStatus): HealthCheck {
  if (!status.enabled) {
    return {
      name: 'telemetry',
      status: 'ok',
      detail: 'collector not configured; metrics and errors stay in-process',
    };
  }
  if (status.failedBatches > 0 && status.shipped === 0) {
    return {
      name: 'telemetry',
      status: 'degraded',
      detail: `no batch delivered; last failure: ${status.lastFailureReason ?? 'unknown'}`,
    };
  }
  if (status.failedBatches > 0) {
    return {
      name: 'telemetry',
      status: 'ok',
      detail: `${status.failedBatches} batch failures, but ${status.shipped} envelopes delivered`,
    };
  }
  return { name: 'telemetry', status: 'ok', detail: `${status.shipped} envelopes delivered` };
}

function recentErrorsCheck(windowMs: number, budget: number): HealthCheck {
  const count = telemetry.recentErrorCount(windowMs);
  if (count >= budget) {
    return {
      name: 'errors',
      status: 'degraded',
      detail: `${count} captured errors in the last ${Math.round(windowMs / 1000)}s (budget ${budget})`,
    };
  }
  return { name: 'errors', status: 'ok', detail: `${count} captured errors recently` };
}

/**
 * The data-seam ping: one fixed-size aggregate through the real provider. It
 * is deliberately the smallest scoped query on the contract
 * (`getForecastSummary`), so the check measures the seam a user depends on
 * without paying for the book, and it goes through the instrumented wrapper,
 * so the ping is itself measured by the same metrics it is checking.
 */
async function dataSeamCheck(
  provider: DataProvider,
  quarter: string,
  pingBudgetMs: number,
  healthyPingMs: number,
  now: () => number,
): Promise<HealthCheck> {
  const startedAt = now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`ping exceeded ${pingBudgetMs}ms`)), pingBudgetMs);
  });
  try {
    await Promise.race([provider.getForecastSummary({ quarter }), deadline]);
    const latencyMs = now() - startedAt;
    return {
      name: 'dataSeam',
      status: latencyMs <= healthyPingMs ? 'ok' : 'degraded',
      latencyMs,
      detail: `getForecastSummary answered in ${latencyMs}ms`,
    };
  } catch (error) {
    return {
      name: 'dataSeam',
      status: 'unavailable',
      latencyMs: now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * The dataSeam check for a shell that never got a readiness answer: the seam
 * did not just ping slow, it failed before any route's queries could run.
 * Publishing this check (instead of omitting it) is what lets an operator
 * tell "healthy app" apart from "health endpoint that never ran".
 */
export function unavailableDataSeamCheck(detail: string): HealthCheck {
  return { name: 'dataSeam', status: 'unavailable', detail };
}

export async function runReadinessChecks(options: ReadinessOptions): Promise<HealthCheck[]> {
  const staticChecks = [
    appShellCheck(),
    networkCheck(),
    flagsCheck(),
    telemetryCheck(options.transportStatus ?? telemetry.transportStatus()),
    recentErrorsCheck(
      options.recentErrorWindowMs ?? DEFAULT_RECENT_ERROR_WINDOW_MS,
      options.recentErrorBudget ?? DEFAULT_RECENT_ERROR_BUDGET,
    ),
  ];
  const dataSeam = await dataSeamCheck(
    options.provider,
    options.quarter ?? CURRENT_FISCAL_QUARTER,
    options.pingBudgetMs ?? DEFAULT_PING_BUDGET_MS,
    options.healthyPingMs ?? DEFAULT_HEALTHY_PING_MS,
    options.now ?? Date.now,
  );
  return [...staticChecks, dataSeam];
}

/**
 * The provisional artifact the app publishes the moment the shell mounts,
 * before any readiness check has resolved. It exists so `window.GTM_HEALTH`
 * is never absent — a page whose only signal is "the endpoint never
 * appeared" forces an operator to guess whether the app is healthy or never
 * booted. The checks it lists are the two things the shell already knows
 * about itself; everything else waits for the first real assessment.
 */
export function shellHealthArtifact(now: () => number = Date.now): HealthArtifact {
  const context = telemetry.contextSnapshot();
  return {
    status: 'degraded',
    service: HEALTH_SERVICE,
    release: context.release,
    environment: context.environment,
    sessionId: context.sessionId,
    route: context.route,
    providerId: context.providerId,
    requestedProviderId: null,
    providerTransitionStatus: 'none',
    generatedAt: new Date(now()).toISOString(),
    uptimeMs: Math.max(0, now() - TELEMETRY_STARTUP_EPOCH),
    checks: [
      appShellCheck(),
      { name: 'dataSeam', status: 'degraded', detail: 'readiness checks still running' },
    ],
  };
}

/** Runs every check and folds the results into one publishable artifact. */
export async function assessHealth(options: ReadinessOptions): Promise<HealthArtifact> {
  const now = options.now ?? Date.now;
  const [checks, context] = await Promise.all([
    runReadinessChecks(options),
    Promise.resolve(telemetry.contextSnapshot()),
  ]);
  return {
    status: rollupStatus(checks),
    service: HEALTH_SERVICE,
    release: context.release,
    environment: context.environment,
    sessionId: context.sessionId,
    route: context.route,
    providerId: context.providerId,
    requestedProviderId: options.transition?.requestedId ?? null,
    providerTransitionStatus: options.transition?.status ?? 'none',
    generatedAt: new Date(now()).toISOString(),
    uptimeMs: Math.max(0, now() - TELEMETRY_STARTUP_EPOCH),
    checks,
  };
}

/**
 * Publishes the artifact at `window.GTM_HEALTH`. `refresh` re-runs the
 * assessment, so the endpoint stays live rather than pinning startup state;
 * it is also the documented way for an operator or a synthetic monitor to ask
 * the deployed page how it is doing.
 */
export function publishHealthArtifact(
  artifact: HealthArtifact,
  refresh: () => Promise<HealthArtifact>,
): void {
  if (typeof window === 'undefined') return;
  window.GTM_HEALTH = {
    artifact,
    checks: artifact.checks,
    refresh: async () => {
      const next = await refresh();
      window.GTM_HEALTH = {
        artifact: next,
        checks: next.checks,
        refresh: window.GTM_HEALTH?.refresh ?? refresh,
      };
      return next;
    },
  };
}
