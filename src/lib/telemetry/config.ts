import { isLogLevel, type LogLevel } from '../logging';

/**
 * Configuration for the telemetry layer, read once at startup.
 *
 * Everything is optional by design: with none of these set the app behaves
 * exactly as it did before — metrics, error insights, and health checks run
 * in-process, and nothing is sent over the network. A deployment that wants
 * remote observability sets `VITE_TELEMETRY_ENDPOINT` (a collector that
 * accepts the envelope batch shape from transport.ts) and optionally the rest
 * here at build time. Vite inlines these values, so they are baked into the
 * artifact a deploy ships, which is what "configured at deployment" means for
 * a client-only app.
 *
 * Invalid values never throw: a misconfigured build should run, with the
 * problem reported in `issues` so the health artifact surfaces it instead of
 * the app guessing.
 */

/** The narrow slice of the Vite environment this layer reads. */
export interface TelemetryEnv {
  MODE?: string;
  PROD?: boolean;
  DEV?: boolean;
  /** Flag overrides are addressed by derived keys, so any string key can appear. */
  [variable: string]: string | boolean | undefined;
  VITE_TELEMETRY_ENDPOINT?: string;
  VITE_ALERT_ENDPOINT?: string;
  VITE_TELEMETRY_DASHBOARD_URL?: string;
  VITE_RELEASE?: string;
  VITE_VERCEL_GIT_COMMIT_SHA?: string;
  VITE_TELEMETRY_LOG_LEVEL?: string;
  VITE_TELEMETRY_SAMPLE_RATE?: string;
  VITE_GA_MEASUREMENT_ID?: string;
}

export interface TelemetryConfig {
  /** Collector URL for every envelope type; null means "stay in-process". */
  endpoint: string | null;
  /** Webhook URL for alert payloads; null means alerts reach in-app handlers only. */
  alertEndpoint: string | null;
  /** Operator dashboard URL stamped on telemetry batches when configured. */
  dashboardUrl: string | null;
  /** Minimum level a log record must have to be shipped when log shipping is on. */
  logShipLevel: LogLevel;
  /** Share of non-critical envelopes shipped; errors and alerts always go. */
  sampleRate: number;
  /** Optional GA4 measurement ID; null keeps product analytics in-process. */
  analyticsMeasurementId: string | null;
  /** What deployment is running, for correlating signals to a build. */
  release: string;
  /** Build mode, e.g. 'development' or 'production'. */
  environment: string;
  /** Problems found while reading configuration, in plain language. */
  issues: string[];
}

const UNLABELED_RELEASE = 'unlabeled-release';

/**
 * A release id that says what it is: production builds stamp their artifacts
 * through `VITE_RELEASE` (the pipeline sets it to the git SHA or tag), and a
 * production build without one is a deploy that cannot be correlated to a
 * commit — better to read that off the health artifact than to guess at a
 * version number that was never checked.
 */
function resolveRelease(env: TelemetryEnv): string {
  const explicit = env.VITE_RELEASE ?? env.VITE_VERCEL_GIT_COMMIT_SHA;
  if (explicit && explicit.trim() !== '') return explicit.trim();
  return env.PROD ? UNLABELED_RELEASE : 'dev';
}

/** Endpoints must be http(s) URLs; anything else is ignored and reported. */
function resolveEndpoint(value: string | undefined, name: string, issues: string[]): string | null {
  if (value === undefined || value.trim() === '') return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    issues.push(`${name} is not an http(s) URL; telemetry will stay in-process`);
    return null;
  }
  return trimmed;
}

export function readTelemetryConfig(env: TelemetryEnv = import.meta.env): TelemetryConfig {
  const issues: string[] = [];

  const logShipLevel = isLogLevel(env.VITE_TELEMETRY_LOG_LEVEL)
    ? env.VITE_TELEMETRY_LOG_LEVEL
    : undefined;
  if (env.VITE_TELEMETRY_LOG_LEVEL !== undefined && !logShipLevel) {
    issues.push('VITE_TELEMETRY_LOG_LEVEL is not one of debug/info/warn/error: defaulting to warn');
  }

  const parsedRate = Number.parseFloat(env.VITE_TELEMETRY_SAMPLE_RATE ?? '');
  const sampleRate = Number.isFinite(parsedRate)
    ? Math.min(1, Math.max(0, parsedRate))
    : Number.NaN;
  if (env.VITE_TELEMETRY_SAMPLE_RATE !== undefined && Number.isNaN(sampleRate)) {
    issues.push('VITE_TELEMETRY_SAMPLE_RATE is not a number; using full sampling');
  }

  return {
    endpoint: resolveEndpoint(env.VITE_TELEMETRY_ENDPOINT, 'VITE_TELEMETRY_ENDPOINT', issues),
    alertEndpoint: resolveEndpoint(env.VITE_ALERT_ENDPOINT, 'VITE_ALERT_ENDPOINT', issues),
    dashboardUrl: resolveEndpoint(
      env.VITE_TELEMETRY_DASHBOARD_URL,
      'VITE_TELEMETRY_DASHBOARD_URL',
      issues,
    ),
    analyticsMeasurementId:
      env.VITE_GA_MEASUREMENT_ID?.trim() === '' || env.VITE_GA_MEASUREMENT_ID === undefined
        ? null
        : env.VITE_GA_MEASUREMENT_ID.trim(),
    logShipLevel: logShipLevel ?? 'warn',
    sampleRate: Number.isNaN(sampleRate) ? 1 : sampleRate,
    release: resolveRelease(env),
    environment: env.MODE ?? 'unknown',
    issues,
  };
}

/** Random per-page-load session identifier. Generated, not stored: a reload is a new session, and nothing persists in the browser. */
export function createSessionId(): string {
  return randomHex(16);
}

/**
 * `n` random bytes as hex. Uses the platform CSPRNG when present; the fallback
 * exists for exotic runtimes (old jsdom) rather than a real security need —
 * these are correlation ids, not secrets.
 */
export function randomHex(byteCount: number): string {
  const cryptoImpl = globalThis.crypto;
  if (cryptoImpl && typeof cryptoImpl.getRandomValues === 'function') {
    const bytes = new Uint8Array(byteCount);
    cryptoImpl.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  let hex = '';
  for (let index = 0; index < byteCount * 2; index += 1) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

/** When this page load's telemetry started, for uptime reporting in the health artifact. */
export const TELEMETRY_STARTUP_EPOCH = Date.now();
