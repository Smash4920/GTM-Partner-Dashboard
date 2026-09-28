/// <reference types="vite/client" />

/**
 * The Vite environment variables this app reads, typed once so a misspelled
 * key is a compile error rather than a silently disabled feature.
 *
 * None of these are required: with none of them set the app runs exactly as
 * before — telemetry keeps everything in-process (metrics, error insights,
 * health checks) and ships nothing over the network. A deployment that wants
 * remote observability sets them at build time (see src/lib/telemetry/config.ts).
 */
interface ImportMetaEnv {
  /** Production Requirements workspace flag: immediate off switch. */
  readonly VITE_FEATURE_PRODUCTION_REQUIREMENTS?: string;
  /** Production Requirements workspace flag: percentage rollout when no override is set. */
  readonly VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT?: string;
  /** Existing logger level override, read by src/lib/logging.ts. */
  readonly VITE_LOG_LEVEL?: string;
  /** Collector URL for web-vitals performance records (src/lib/performanceTelemetry.ts). */
  readonly VITE_METRICS_ENDPOINT?: string;
  /** Share of performance records shipped, 0 to 1. */
  readonly VITE_METRICS_SAMPLE_RATE?: string;
  /** Deployment environment stamped on performance records. */
  readonly VITE_DEPLOYMENT_ENV?: string;
  /** Collector URL for telemetry envelopes (logs, metrics, events, traces, errors, alerts, health). */
  readonly VITE_TELEMETRY_ENDPOINT?: string;
  /** Webhook URL alert payloads are POSTed to; falls back to in-app handlers only. */
  readonly VITE_ALERT_ENDPOINT?: string;
  /** Operator dashboard URL linked from deployment telemetry and runbooks. */
  readonly VITE_TELEMETRY_DASHBOARD_URL?: string;
  /** Release identifier (git SHA or tag) stamped on every envelope and the health artifact. */
  readonly VITE_RELEASE?: string;
  /** Vercel's build-time commit SHA, used when VITE_RELEASE is not set. */
  readonly VITE_VERCEL_GIT_COMMIT_SHA?: string;
  /** Minimum log level shipped to the collector when log shipping is enabled ('warn' by default). */
  readonly VITE_TELEMETRY_LOG_LEVEL?: string;
  /** Share of non-critical envelopes shipped, 0 to 1; errors and alerts always ship. */
  readonly VITE_TELEMETRY_SAMPLE_RATE?: string;
  /** Optional GA4 measurement ID for the product-event bridge. */
  readonly VITE_GA_MEASUREMENT_ID?: string;
  /** Feature flag overrides, e.g. VITE_FLAG_TELEMETRY_ENABLED=false. */
  readonly [key: `VITE_FLAG_${string}`]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  dataLayer?: unknown[][];
  gtag?: (...args: unknown[]) => void;
}
