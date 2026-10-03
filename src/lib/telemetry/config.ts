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

/**
 * Collector hosts approved for production telemetry. The list is checked in
 * because approving a destination is a privacy review, not a deploy-time
 * detail: a production build only ships telemetry to a host named here.
 * It is intentionally empty — no external collector has been approved, so
 * production telemetry stays local-only until a host is added in a reviewed
 * change.
 */
const APPROVED_TELEMETRY_HOSTS: readonly string[] = [];

/**
 * Loopback hosts a development or test collector may use over plain HTTP.
 * `import.meta.env.DEV` is replaced at build time, so in a production bundle
 * this is an empty list and the loopback exception is dead code that the
 * minifier removes — production output contains no HTTP exception.
 */
const LOOPBACK_HOSTS: readonly string[] = import.meta.env.DEV
  ? ['127.0.0.1', 'localhost', '[::1]']
  : [];

export interface EndpointPolicy {
  /** Production builds refuse anything but HTTPS on an approved host. */
  production: boolean;
  /**
   * The telemetry collector is a data destination, so production requires an
   * approved host. Metadata URLs (the operator dashboard link) skip that one
   * check but keep every other rule.
   */
  requireApprovedHost?: boolean;
}

/**
 * Validates a configured telemetry URL, failing closed: any rejection returns
 * null (local-only behavior) with a plain-language entry in `issues`.
 *
 * Rejected: unparseable or protocol-relative URLs, embedded credentials,
 * query strings and fragments (both can smuggle secrets or record data),
 * non-HTTPS schemes, non-default ports, and — for data destinations in
 * production — hosts outside APPROVED_TELEMETRY_HOSTS. The one exception is
 * loopback HTTP for development and test collectors, compiled out of
 * production builds.
 */
export function resolveEndpoint(
  value: string | undefined,
  name: string,
  issues: string[],
  policy: EndpointPolicy,
): string | null {
  if (value === undefined || value.trim() === '') return null;
  const trimmed = value.trim();

  const reject = (cause: string): null => {
    issues.push(`${name} rejected: ${cause}; telemetry stays in-process`);
    return null;
  };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return reject('not a valid URL');
  }
  if (url.username !== '' || url.password !== '') {
    return reject('must not embed credentials');
  }
  if (url.search !== '' || url.hash !== '') {
    return reject('must not carry a query string or fragment');
  }
  if (url.protocol === 'http:' && !policy.production && LOOPBACK_HOSTS.includes(url.hostname)) {
    return trimmed;
  }
  if (url.protocol !== 'https:') {
    return reject('must be an HTTPS URL');
  }
  if (url.port !== '') {
    return reject('must use the default HTTPS port');
  }
  if ((policy.requireApprovedHost ?? true) && !APPROVED_TELEMETRY_HOSTS.includes(url.hostname)) {
    return reject('host is not on the approved telemetry host list');
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

  const policy: EndpointPolicy = { production: env.PROD === true };

  return {
    endpoint: resolveEndpoint(
      env.VITE_TELEMETRY_ENDPOINT,
      'VITE_TELEMETRY_ENDPOINT',
      issues,
      policy,
    ),
    dashboardUrl: resolveEndpoint(
      env.VITE_TELEMETRY_DASHBOARD_URL,
      'VITE_TELEMETRY_DASHBOARD_URL',
      issues,
      {
        ...policy,
        requireApprovedHost: false,
      },
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
