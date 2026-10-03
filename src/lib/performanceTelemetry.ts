import { onCLS, onFCP, onINP, onLCP, onTTFB, type MetricType } from 'web-vitals';
import { logger } from './logging';
import { resolveEndpoint } from './telemetry/config';
import { isFlagEnabled } from './telemetry/flags';

const log = logger.child({ component: 'performanceTelemetry' });
const APPLICATION = 'gtm-partner-dashboard';
const SCHEMA_VERSION = 1;

type MetricSubscriber = (callback: (metric: MetricType) => void) => void;

const METRIC_SUBSCRIBERS: readonly MetricSubscriber[] = [onCLS, onFCP, onINP, onLCP, onTTFB];

export interface PerformanceTelemetryConfig {
  endpoint: string;
  environment: string;
  release?: string;
  sampleRate: number;
}

interface TelemetryDependencies {
  fetch?: typeof globalThis.fetch;
  location: Pick<Location, 'pathname'>;
  metricSubscribers: readonly MetricSubscriber[];
  now: () => string;
  random: () => number;
  sendBeacon?: (url: string, data: BodyInit) => boolean;
}

interface WebVitalPayload {
  schemaVersion: typeof SCHEMA_VERSION;
  type: 'web-vital';
  application: typeof APPLICATION;
  environment: string;
  release?: string;
  route: string;
  timestamp: string;
  metric: {
    name: MetricType['name'];
    value: number;
    delta: number;
    rating: MetricType['rating'];
    id: string;
    navigationType: MetricType['navigationType'];
  };
}

export function parseSampleRate(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 1;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    log.warn('Invalid metrics sample rate; using full collection', { configuredValue: value });
    return 1;
  }
  return parsed;
}

function defaultConfig(): PerformanceTelemetryConfig {
  // The Web Vitals destination obeys the same endpoint policy as every other
  // telemetry egress: HTTPS, approved hosts in production, no credentials or
  // query strings, and fail-closed to local-only on any violation.
  const issues: string[] = [];
  const endpoint =
    resolveEndpoint(import.meta.env.VITE_METRICS_ENDPOINT, 'VITE_METRICS_ENDPOINT', issues, {
      production: import.meta.env.PROD,
    }) ?? '';
  for (const issue of issues) log.warn(issue);
  return {
    endpoint,
    environment: import.meta.env.VITE_DEPLOYMENT_ENV?.trim() || import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE?.trim() || undefined,
    sampleRate: parseSampleRate(import.meta.env.VITE_METRICS_SAMPLE_RATE),
  };
}

function defaultDependencies(): TelemetryDependencies {
  return {
    fetch:
      typeof globalThis.fetch === 'function'
        ? (input, init) => globalThis.fetch(input, init)
        : undefined,
    location: window.location,
    metricSubscribers: METRIC_SUBSCRIBERS,
    now: () => new Date().toISOString(),
    random: Math.random,
    sendBeacon:
      typeof navigator.sendBeacon === 'function'
        ? (url, data) => navigator.sendBeacon(url, data)
        : undefined,
  };
}

function createPayload(
  metric: MetricType,
  config: PerformanceTelemetryConfig,
  dependencies: TelemetryDependencies,
): WebVitalPayload {
  return {
    schemaVersion: SCHEMA_VERSION,
    type: 'web-vital',
    application: APPLICATION,
    environment: config.environment,
    ...(config.release ? { release: config.release } : {}),
    // Query strings and hashes can contain customer or session data. A route
    // pathname gives operators the useful breakdown without shipping either.
    route: dependencies.location.pathname,
    timestamp: dependencies.now(),
    metric: {
      name: metric.name,
      value: metric.value,
      delta: metric.delta,
      rating: metric.rating,
      id: metric.id,
      navigationType: metric.navigationType,
    },
  };
}

function sendPayload(
  endpoint: string,
  payload: WebVitalPayload,
  dependencies: TelemetryDependencies,
): void {
  const body = JSON.stringify(payload);
  const beaconBody = new Blob([body], { type: 'application/json' });

  try {
    if (dependencies.sendBeacon?.(endpoint, beaconBody)) return;
  } catch (error) {
    log.debug('Metrics beacon was unavailable; using fetch', { error });
  }

  if (!dependencies.fetch) {
    log.warn('Performance metric could not be delivered; no browser transport is available');
    return;
  }

  void dependencies
    .fetch(endpoint, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      keepalive: true,
    })
    .catch((error: unknown) => {
      // Telemetry must never make the application fail. The warning remains
      // local so a collector outage is still visible during investigation.
      log.warn('Performance metric delivery failed', { error });
    });
}

export function initializePerformanceTelemetry(
  config: PerformanceTelemetryConfig = defaultConfig(),
  dependencyOverrides: Partial<TelemetryDependencies> = {},
): boolean {
  // The master telemetry switch gates this module like every other egress
  // path: off means no observer subscriptions and no beacons or fetches.
  if (!config.endpoint || config.sampleRate <= 0) return false;
  if (!isFlagEnabled('telemetry.enabled')) return false;

  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  if (dependencies.random() >= config.sampleRate) return false;

  const report = (metric: MetricType) => {
    // Web Vitals callbacks fire for the life of the page, so the switch is
    // re-read per send: turning telemetry off stops beacons mid-session too.
    if (!isFlagEnabled('telemetry.enabled')) return;
    sendPayload(config.endpoint, createPayload(metric, config, dependencies), dependencies);
  };
  for (const subscribe of dependencies.metricSubscribers) subscribe(report);

  log.info('Performance telemetry initialized', {
    environment: config.environment,
    sampleRate: config.sampleRate,
  });
  return true;
}
