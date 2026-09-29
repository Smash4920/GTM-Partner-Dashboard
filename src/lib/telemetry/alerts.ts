import { logger, type Logger } from '../logging';
import { redactRecord } from '../redact';
import { randomHex } from './config';

/**
 * Alert delivery: rules decide *when* to raise, this layer decides *how* it
 * reaches someone.
 *
 * An alert is raised by key (`error:<fingerprint>`, `telemetry.transport_failed`,
 * `health.degraded`), deduplicated with a per-key cooldown, and then delivered
 * exactly two ways: to every registered in-app handler (what a support
 * surface or test subscribes to) and, through the facade's `onAlert` hook, to
 * the telemetry collector as a critical envelope. Suppressed repeats are
 * counted, so the next alert that does fire says how long the condition has
 * been going on rather than pretending it just started.
 *
 * There is deliberately no direct browser delivery to an external endpoint:
 * a webhook URL baked into a public static bundle is an unprotected,
 * unauthenticated destination anyone can read and spam. Operational alerting
 * leaves through the trusted collector/server path instead, which remains
 * production-only work.
 */

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface AlertInput {
  /** Dedupe key: one condition, one key, one cooldown window. */
  key: string;
  severity: AlertSeverity;
  title: string;
  summary: string;
  detail?: Record<string, unknown>;
}

export interface Alert extends AlertInput {
  id: string;
  timestamp: string;
  release: string;
  environment: string;
  sessionId: string;
  /** Times this key was suppressed by cooldown since the previous alert. */
  suppressed: number;
}

export type AlertHandler = (alert: Alert) => void;

export interface AlertDispatcherOptions {
  release: string;
  environment: string;
  sessionId: string;
  /** Where the dispatcher hands every raised alert: the facade logs and enqueues here. */
  onAlert?: (alert: Alert) => void;
  now?: () => number;
  /** Default cooldown per key. */
  cooldownMs?: number;
  severityCooldowns?: Partial<Record<AlertSeverity, number>>;
}

export interface AlertDispatcher {
  raise(input: AlertInput): Alert | null;
  /** Registers a handler; the returned function unsubscribes it. */
  registerHandler(handler: AlertHandler): () => void;
}

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

interface CooldownState {
  lastRaisedAt: number;
  suppressed: number;
}

export function createAlertDispatcher(options: AlertDispatcherOptions): AlertDispatcher {
  const {
    release,
    environment,
    sessionId,
    onAlert,
    now = Date.now,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    severityCooldowns = {},
  } = options;
  const log: Logger = logger.child({ component: 'AlertDispatcher' });
  const handlers = new Set<AlertHandler>();
  const cooldowns = new Map<string, CooldownState>();

  const cooldownFor = (severity: AlertSeverity): number =>
    severityCooldowns[severity] ?? cooldownMs;

  return {
    raise(input: AlertInput): Alert | null {
      const at = now();
      const state = cooldowns.get(input.key);
      if (state && at - state.lastRaisedAt < cooldownFor(input.severity)) {
        state.suppressed += 1;
        return null;
      }
      const alert: Alert = {
        ...input,
        ...(input.detail !== undefined ? { detail: redactRecord(input.detail) } : {}),
        id: randomHex(8),
        timestamp: new Date(at).toISOString(),
        release,
        environment,
        sessionId,
        suppressed: state ? state.suppressed : 0,
      };
      cooldowns.set(input.key, { lastRaisedAt: at, suppressed: 0 });

      for (const handler of handlers) {
        try {
          handler(alert);
        } catch {
          // A handler that throws must not take the others down with it. The
          // raw error stays off the record on purpose: handler failures are a
          // code bug, and exception prose never belongs in a log record.
          log.warn('Alert handler failed', { alertKey: alert.key });
        }
      }
      onAlert?.(alert);
      return alert;
    },

    registerHandler(handler: AlertHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };
}
