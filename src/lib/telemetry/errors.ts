import type { AlertInput, AlertSeverity } from './alerts';
import type { MetricsRegistry } from './metrics';

/**
 * Contextual error capture: breadcrumbs, fingerprints, and the aggregation
 * that turns captured errors into an insight.
 *
 * `capture` is what an error boundary or a failing provider call reports
 * through. A captured error is (1) fingerprinted by name plus normalized
 * stack shape, so the same defect thrown from 30 sessions is one row and not
 * 30; (2) recorded as a metric and as a critical envelope carrying only the
 * technical classification — error class, fingerprint, category, severity,
 * route, provider — never the raw message, stack, cause, or breadcrumbs,
 * which are arbitrary prose that must not leave the browser; and (3) raised
 * to the alert layer under its fingerprint.
 *
 * `insights()` is the other end of that pipeline: per-fingerprint counts,
 * first/last seen, messages, and severity, sorted by how often the defect
 * fired. Insights are local-only debugging state — they are read by the
 * health check and an engineer with the page open, and the transport
 * allowlist keeps their free-text fields out of anything queued.
 */

export interface Breadcrumb {
  at: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface ErrorCaptureOptions {
  severity?: AlertSeverity;
  /** Operational classification: 'render', 'provider', 'transport', ... */
  category?: string;
  /** Span context the error happened under, if any. */
  traceparent?: string;
}

export interface ErrorInsight {
  fingerprint: string;
  name: string;
  message: string;
  category: string;
  severity: AlertSeverity;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface ErrorRecord {
  fingerprint: string;
  /** Total captures of this fingerprint this session. */
  count: number;
}

export interface ErrorTrackerOptions {
  /** Reads current app context so each capture carries where it happened. */
  getContext: () => { route: string | null; providerId: string | null };
  metrics: MetricsRegistry;
  /** Handled by the facade: the error becomes a critical envelope. */
  onEnvelope: (data: Record<string, unknown>, traceparent?: string) => void;
  raiseAlert: (input: AlertInput) => void;
  now?: () => number;
  maxBreadcrumbs?: number;
  maxFingerprints?: number;
}

export interface ErrorTracker {
  capture(error: unknown, options?: ErrorCaptureOptions): ErrorRecord;
  addBreadcrumb(message: string, data?: Record<string, unknown>): void;
  breadcrumbs(): readonly Breadcrumb[];
  insights(): ErrorInsight[];
  /** Captures in the trailing window, for health and error-rate checks. */
  recentErrorCount(windowMs: number): number;
}

const DEFAULT_MAX_BREADCRUMBS = 30;
const DEFAULT_MAX_FINGERPRINTS = 50;

/**
 * One stack frame, position-free: function and file only. Line and column are
 * dropped because a minified bundle renumbers them per release, and a
 * fingerprint that changes every deploy cannot group anything.
 */
function normalizeStackLine(line: string): string | null {
  const match = /^(?:\s*at\s+)?(.*)$/.exec(line.trim());
  if (!match) return null;
  const frame = match[1] ?? '';
  // `getForecastSummary (http://host/assets/index-abc.js:1:2345)` →
  // `getForecastSummary (index-abc.js)`.
  const stripped = frame.replace(/:[0-9]+(?::[0-9]+)?\)?$/, ')');
  return stripped === '' ? null : stripped;
}

/**
 * A stable, short fingerprint for a defect: error name plus the normalized
 * first frames of its stack (or its message when there is no stack — a plain
 * `throw 'bad state'` still groups). FNV-1a keeps it cheap; it is a grouping
 * key, not a cryptographic claim.
 */
export function fingerprintError(name: string, message: string, stack?: string): string {
  const frames = (stack ?? '')
    .split('\n')
    .map(normalizeStackLine)
    .filter((line): line is string => line !== null)
    .slice(0, 5);
  const basis = frames.length > 0 ? [name, ...frames].join('|') : `${name}|${message}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < basis.length; index += 1) {
    hash ^= basis.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function normalizeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack ? { stack: error.stack } : {}),
    };
  }
  if (typeof error === 'string') {
    return { name: 'Error', message: error };
  }
  return { name: typeof error, message: String(error) };
}

export function createErrorTracker(options: ErrorTrackerOptions): ErrorTracker {
  const {
    getContext,
    metrics,
    onEnvelope,
    raiseAlert,
    now = Date.now,
    maxBreadcrumbs = DEFAULT_MAX_BREADCRUMBS,
    maxFingerprints = DEFAULT_MAX_FINGERPRINTS,
  } = options;

  const breadcrumbRing: Breadcrumb[] = [];
  const insightsByFingerprint = new Map<string, ErrorInsight>();
  // Raw capture timestamps, newest last, for windowed counting.
  const captureTimes: number[] = [];

  const pushInsight = (insight: ErrorInsight) => {
    insightsByFingerprint.set(insight.fingerprint, insight);
    if (insightsByFingerprint.size > maxFingerprints) {
      // Drop the least recently seen fingerprint, not the loudest one: the
      // set is bounded for memory, and old defects are the ones to forget.
      let oldest: string | null = null;
      let oldestAt = Number.POSITIVE_INFINITY;
      for (const [fingerprint, record] of insightsByFingerprint) {
        if (record.lastSeenAt < oldestAt) {
          oldest = fingerprint;
          oldestAt = record.lastSeenAt;
        }
      }
      if (oldest !== null) insightsByFingerprint.delete(oldest);
    }
  };

  return {
    capture(error: unknown, captureOptions: ErrorCaptureOptions = {}): ErrorRecord {
      const at = now();
      const normalized = normalizeError(error);
      const fingerprint = fingerprintError(normalized.name, normalized.message, normalized.stack);
      const category = captureOptions.category ?? 'unhandled';
      const severity = captureOptions.severity ?? 'warning';
      const { route, providerId } = getContext();

      const existing = insightsByFingerprint.get(fingerprint);
      const insight: ErrorInsight = existing
        ? {
            ...existing,
            message: normalized.message,
            count: existing.count + 1,
            lastSeenAt: at,
            severity:
              severityRank(severity) > severityRank(existing.severity)
                ? severity
                : existing.severity,
          }
        : {
            fingerprint,
            name: normalized.name,
            message: normalized.message,
            category,
            severity,
            count: 1,
            firstSeenAt: at,
            lastSeenAt: at,
          };
      pushInsight(insight);
      captureTimes.push(at);

      metrics.increment('telemetry.error', {
        category,
        fingerprint,
        severity,
      });

      // The envelope is a stable classification, not the thrown prose: class
      // name, fingerprint, category, severity, and where the session was. The
      // message, stack, and breadcrumbs stay in the local insight/breadcrumb
      // state; the transport allowlist enforces the same shape at the
      // boundary, so this object and the allowlist must agree.
      onEnvelope(
        {
          name: normalized.name,
          fingerprint,
          category,
          severity,
          route,
          providerId,
        },
        captureOptions.traceparent,
      );

      raiseAlert({
        key: `error:${fingerprint}`,
        severity,
        title: `${normalized.name} in ${category}`,
        summary: `Error fingerprint ${fingerprint}; session count ${insight.count}.`,
        detail: {
          fingerprint,
          category,
          route,
          providerId,
          sessionCount: insight.count,
        },
      });

      // No local log record here on purpose: every capture site (the error
      // boundary, the provider wrapper) already writes its own structured
      // record about the failure, and a second one would double the console
      // for one event. The envelope, the metric, and the alert are this
      // layer's outputs.
      return { fingerprint, count: insight.count };
    },

    addBreadcrumb(message: string, data?: Record<string, unknown>) {
      breadcrumbRing.push({ at: now(), message, ...(data ? { data } : {}) });
      if (breadcrumbRing.length > maxBreadcrumbs) {
        breadcrumbRing.shift();
      }
    },

    breadcrumbs() {
      return [...breadcrumbRing];
    },

    insights(): ErrorInsight[] {
      return [...insightsByFingerprint.values()].sort(
        (left, right) => right.count - left.count || right.lastSeenAt - left.lastSeenAt,
      );
    },

    recentErrorCount(windowMs: number): number {
      const since = now() - windowMs;
      let count = 0;
      for (let index = captureTimes.length - 1; index >= 0; index -= 1) {
        if (captureTimes[index] < since) break;
        count += 1;
      }
      return count;
    },
  };
}

function severityRank(severity: AlertSeverity): number {
  switch (severity) {
    case 'critical':
      return 3;
    case 'warning':
      return 2;
    default:
      return 1;
  }
}
