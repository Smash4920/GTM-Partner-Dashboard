import { addGlobalSink, LEVEL_WEIGHT, logger } from '../logging';
import type { HealthArtifact } from '../health';
import { allowlistEventProperties, type AnalyticsEventName } from './allowlist';
import { readTelemetryConfig, createSessionId, randomHex, type TelemetryConfig } from './config';
import { isFlagEnabled } from './flags';
import {
  createErrorTracker,
  type ErrorCaptureOptions,
  type ErrorInsight,
  type ErrorRecord,
} from './errors';
import { MetricsRegistry, type MetricAttributes } from './metrics';
import { createAlertDispatcher, type Alert, type AlertHandler, type AlertInput } from './alerts';
import { createTransport, type TransportStatus } from './transport';
import {
  formatTraceparent,
  newTraceIds,
  readIncomingTraceContext,
  startSpan as startTraceSpan,
  type Span,
  type SpanAttributes,
  type SpanData,
  type SpanStatus,
  type TraceContext,
} from './trace';

/**
 * The telemetry facade: one object the app talks to, composing config, flags,
 * traces, metrics, error capture, alerts, product analytics, and the
 * transport.
 *
 * Privacy model, stated once: this app has no signed-in user, so no envelope
 * carries one. The context is a random per-page-load session id, the active
 * route and provider, the release, and the build mode — enough to correlate
 * signals, none of it a person. Product events carry identifiers and counts,
 * never user prose, matching the logging rules. The transport enforces the
 * per-envelope field allowlists (src/lib/telemetry/allowlist.ts) before
 * anything is queued and redacts field-by-field (src/lib/redact.ts) as a
 * second pass, so names, prose, records, secrets, and raw error text can
 * never leave the browser.
 *
 * Local behavior is unchanged by default: with no `VITE_TELEMETRY_ENDPOINT`
 * there is no network traffic at all, and every in-process consumer (health
 * checks, error insights, alert handlers, metric snapshots) still works. The
 * `telemetry.enabled` master switch is enforced at the transport boundary —
 * off means zero requests, beacons, script loads, or lifecycle flushes — and
 * product analytics additionally requires `analytics.enabled`, which
 * defaults off pending privacy approval.
 */

const SERVICE_NAME = 'gtm-partner-dashboard';
const GA_SEND_PAGE_VIEW_OPTION = 'send_page_view';

interface TelemetryContextSnapshot {
  release: string;
  environment: string;
  dashboardUrl: string | null;
  sessionId: string;
  route: string | null;
  providerId: string | null;
  /** W3C trace context of the session; every envelope is stamped with it. */
  traceparent: string;
}

export interface TelemetryOptions {
  /** Defaults to the build-time configuration from readTelemetryConfig(). */
  config?: TelemetryConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Trace context served with the page; defaults to readIncomingTraceContext(). */
  incomingTraceContext?: TraceContext | null;
  /** Transport flush cadence; the default suits production. */
  flushIntervalMs?: number;
}

export interface TelemetryFacade {
  /** Where this session is, and what it is running: stamped on every envelope. */
  contextSnapshot(): TelemetryContextSnapshot;
  /** Records the active route; also emits a route_view analytics event. */
  setRoute(route: string): void;
  /** Records the active provider; also emits a provider_selected event. */
  setProviderId(providerId: string): void;
  addBreadcrumb(message: string, data?: Record<string, unknown>): void;
  /** Contextual error capture: envelope, metric, fingerprint insight, alert. */
  captureError(error: unknown, options?: ErrorCaptureOptions): ErrorRecord;
  recordCounter(name: string, attributes?: MetricAttributes): void;
  recordDuration(name: string, durationMs: number, attributes?: MetricAttributes): void;
  /**
   * Opens a child span of the session trace. Ending it ships the span as a
   * trace envelope carrying the `traceparent` a server would receive.
   */
  startSpan(name: string, attributes?: SpanAttributes): Span;
  /**
   * Emits a product analytics event. Requires both the telemetry master
   * switch and the analytics.enabled opt-in (off by default); properties are
   * filtered to the event's registered allowlist before they leave.
   */
  track(event: AnalyticsEventName, properties?: Record<string, unknown>): void;
  /** Ships a health artifact, and alerts on anything short of 'ok'. */
  reportHealth(artifact: HealthArtifact): void;
  raiseAlert(input: AlertInput): Alert | null;
  /** Subscribes an in-app alert consumer; the returned function unsubscribes. */
  registerAlertHandler(handler: AlertHandler): () => void;
  transportStatus(): TransportStatus;
  errorInsights(): ErrorInsight[];
  recentErrorCount(windowMs: number): number;
  /** Ships metric deltas plus everything queued; runs on its own cadence too. */
  flush(): Promise<void>;
  /** Detaches from the process; for tests and teardown, not the running app. */
  dispose(): void;
}

function installGa4(measurementId: string): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (window.gtag) return;

  window.dataLayer = window.dataLayer ?? [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer?.push(args);
  };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { [GA_SEND_PAGE_VIEW_OPTION]: false });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.appendChild(script);
}

export function createTelemetry(options: TelemetryOptions = {}): TelemetryFacade {
  const config = options.config ?? readTelemetryConfig();
  const now = options.now ?? Date.now;
  const sessionId = createSessionId();
  const log = logger.child({ component: 'Telemetry' });

  // The analytics script installs only when the session starts with both
  // switches on. The check runs once here rather than per event: a runtime
  // override must never be able to pull a third-party script into a session
  // that began with analytics off (fail closed, VAL-SEC-001/002).
  if (
    config.analyticsMeasurementId &&
    isFlagEnabled('telemetry.enabled') &&
    isFlagEnabled('analytics.enabled')
  ) {
    installGa4(config.analyticsMeasurementId);
  }

  let route: string | null = null;
  let providerId: string | null = null;

  const contextSnapshot = (): TelemetryContextSnapshot => ({
    release: config.release,
    environment: config.environment,
    dashboardUrl: config.dashboardUrl,
    sessionId,
    route,
    providerId,
    traceparent: sessionTraceparent,
  });

  // ---- session trace ------------------------------------------------------

  // One page load is one trace. A deployment that serves a traceparent with
  // the page (query parameter or meta tag) keeps its trace — everything the
  // client emits correlates to the server request that delivered it. Without
  // one, this is the trace's root: a client-generated id for the session.
  const incoming = options.incomingTraceContext ?? readIncomingTraceContext();
  const sessionTraceparent = formatTraceparent({
    version: '00',
    traceId: incoming?.traceId ?? newTraceIds().traceId,
    // The server's span id stays as the parent of everything the client does;
    // with no server context, the session's own span id takes the root slot.
    parentSpanId: incoming?.parentSpanId ?? randomHex(8),
    traceFlags: incoming?.traceFlags ?? '01',
  });

  // ---- composition --------------------------------------------------------

  const metrics = new MetricsRegistry();

  const transport = createTransport({
    endpoint: config.endpoint,
    sampleRate: config.sampleRate,
    // The master switch, enforced at the single egress boundary: off means
    // nothing queues, schedules, flushes, or sends — whatever the rest of
    // the facade was asked to record.
    isEgressAllowed: () => isFlagEnabled('telemetry.enabled'),
    getMeta: () => ({
      service: SERVICE_NAME,
      release: config.release,
      environment: config.environment,
      dashboardUrl: config.dashboardUrl,
      sessionId,
      route,
      providerId,
    }),
    fetchImpl: options.fetchImpl,
    now,
    flushIntervalMs: options.flushIntervalMs,
    beforeFlush: () => {
      // Metric deltas join the batch being flushed, so a collector sees
      // increments per interval rather than ever-growing session totals.
      for (const delta of metrics.drainCounterDeltas()) {
        transport.enqueue({
          type: 'metric',
          traceparent: sessionTraceparent,
          data: { kind: 'counter', ...delta },
        });
      }
      for (const delta of metrics.drainDurationDeltas()) {
        transport.enqueue({
          type: 'metric',
          traceparent: sessionTraceparent,
          data: { kind: 'duration', ...delta },
        });
      }
    },
    onDeliveryFailure: (failure) => {
      alertDispatcher.raise({
        key: 'telemetry.transport_failed',
        severity: 'warning',
        title: 'Telemetry delivery is failing',
        summary:
          failure.kind === 'http'
            ? `Collector responded with HTTP ${failure.status}.`
            : 'Collector unreachable: network-level failure.',
        detail:
          failure.kind === 'http'
            ? { failureKind: 'http', status: failure.status }
            : { failureKind: 'network' },
      });
    },
  });

  const alertDispatcher = createAlertDispatcher({
    release: config.release,
    environment: config.environment,
    sessionId,
    now,
    onAlert: (alert) => {
      log.warn('Alert raised', {
        alertKey: alert.key,
        severity: alert.severity,
        suppressed: alert.suppressed,
        title: alert.title,
      });
      transport.enqueue(
        { type: 'alert', traceparent: sessionTraceparent, data: { ...alert } },
        { critical: true },
      );
    },
  });

  const errorTracker = createErrorTracker({
    getContext: () => ({ route, providerId }),
    metrics,
    onEnvelope: (data, traceparent) => {
      transport.enqueue(
        {
          type: 'error',
          ...(traceparent !== undefined ? { traceparent } : { traceparent: sessionTraceparent }),
          data,
        },
        { critical: true },
      );
    },
    raiseAlert: (input) => {
      alertDispatcher.raise(input);
    },
    now,
  });

  // ---- log shipping -------------------------------------------------------

  // Off by default (telemetry.logShipping): when enabled, records at or above
  // the configured level ride the transport, redacted at the boundary.
  const removeLogSink = addGlobalSink((record) => {
    if (!isFlagEnabled('telemetry.logShipping')) return;
    if (LEVEL_WEIGHT[record.level] < LEVEL_WEIGHT[config.logShipLevel]) return;
    transport.enqueue({
      type: 'log',
      traceparent: sessionTraceparent,
      data: { ...record },
    });
  });

  return {
    contextSnapshot,

    setRoute(nextRoute: string) {
      route = nextRoute;
      if (!isFlagEnabled('telemetry.enabled')) return;
      errorTracker.addBreadcrumb('Route changed', { route: nextRoute });
      transport.enqueue({
        type: 'event',
        traceparent: sessionTraceparent,
        data: { event: 'route_view', properties: { route: nextRoute } },
      });
    },

    setProviderId(nextProviderId: string) {
      providerId = nextProviderId;
      if (!isFlagEnabled('telemetry.enabled')) return;
      errorTracker.addBreadcrumb('Provider selected', { providerId: nextProviderId });
      transport.enqueue({
        type: 'event',
        traceparent: sessionTraceparent,
        data: { event: 'provider_selected', properties: { providerId: nextProviderId } },
      });
    },

    addBreadcrumb(message: string, data?: Record<string, unknown>) {
      errorTracker.addBreadcrumb(message, data);
    },

    captureError(error: unknown, captureOptions: ErrorCaptureOptions = {}): ErrorRecord {
      return errorTracker.capture(error, captureOptions);
    },

    recordCounter(name: string, attributes?: MetricAttributes) {
      metrics.increment(name, attributes);
    },

    recordDuration(name: string, durationMs: number, attributes?: MetricAttributes) {
      metrics.recordDuration(name, durationMs, attributes);
    },

    startSpan(name: string, attributes?: SpanAttributes): Span {
      const span = startTraceSpan(name, {
        parentTraceparent: sessionTraceparent,
        attributes,
        now,
      });
      return {
        name: span.name,
        traceId: span.traceId,
        traceparent: span.traceparent,
        setAttribute: (attribute, value) => span.setAttribute(attribute, value),
        end(status?: SpanStatus): SpanData {
          const data = span.end(status);
          transport.enqueue({
            type: 'trace',
            traceparent: span.traceparent,
            data: { ...data },
          });
          return data;
        },
      };
    },

    track(event: AnalyticsEventName, properties?: Record<string, unknown>) {
      // Analytics is independently opt-in: both the master switch and the
      // analytics switch must be on, and only the event's registered
      // properties leave — here for the analytics bridge, and again at the
      // transport boundary for the envelope.
      if (!isFlagEnabled('telemetry.enabled') || !isFlagEnabled('analytics.enabled')) return;
      const safeProperties = allowlistEventProperties(event, properties ?? {}) ?? {};
      if (config.analyticsMeasurementId && typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', event, safeProperties);
      }
      transport.enqueue({
        type: 'event',
        traceparent: sessionTraceparent,
        data: { event, properties: safeProperties },
      });
    },

    reportHealth(artifact: HealthArtifact) {
      log.info('Health readiness assessed', {
        status: artifact.status,
        providerId: artifact.providerId,
        route: artifact.route,
        checks: artifact.checks.map((check) => `${check.name}:${check.status}`).join(','),
      });
      transport.enqueue({
        type: 'health',
        traceparent: sessionTraceparent,
        data: { ...artifact },
      });
      if (artifact.status !== 'ok') {
        alertDispatcher.raise({
          key: 'health.degraded',
          severity: artifact.status === 'unavailable' ? 'critical' : 'warning',
          title: `Dashboard health is ${artifact.status}`,
          summary: `Runtime readiness reported ${artifact.status}: ${artifact.checks
            .filter((check) => check.status !== 'ok')
            .map((check) => check.name)
            .join(', ')}`,
          detail: { status: artifact.status, checks: artifact.checks },
        });
      }
    },

    raiseAlert(input: AlertInput): Alert | null {
      return alertDispatcher.raise(input);
    },

    registerAlertHandler(handler: AlertHandler): () => void {
      return alertDispatcher.registerHandler(handler);
    },

    transportStatus(): TransportStatus {
      return transport.status();
    },

    errorInsights(): ErrorInsight[] {
      return errorTracker.insights();
    },

    recentErrorCount(windowMs: number): number {
      return errorTracker.recentErrorCount(windowMs);
    },

    flush(): Promise<void> {
      return transport.flush();
    },

    dispose() {
      removeLogSink();
      transport.dispose();
    },
  };
}

/**
 * The app-wide telemetry client. Reads the build-time configuration once at
 * startup; see src/lib/telemetry/config.ts for what a deployment sets.
 */
export const telemetry: TelemetryFacade = createTelemetry();
