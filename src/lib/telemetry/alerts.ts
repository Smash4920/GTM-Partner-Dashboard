import { logger, type Logger } from '../logging';
import { redactRecord } from '../redact';
import { randomHex } from './config';

/**
 * Alert delivery: rules decide *when* to raise, this layer decides *how* it
 * reaches someone.
 *
 * An alert is raised by key (`error:<fingerprint>`, `telemetry.transport_failed`,
 * `health.degraded`), deduplicated with a per-key cooldown, and then delivered
 * three ways: to every registered in-app handler (what a support surface or
 * test subscribes to), to the configured webhook endpoint when one exists
 * (`VITE_ALERT_ENDPOINT` — the pager side of a static deploy), and to the
 * telemetry collector as a critical envelope. Suppressed repeats are counted,
 * so the next alert that does fire says how long the condition has been going
 * on rather than pretending it just started.
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
  alertEndpoint?: string | null;
  /** Where the dispatcher hands every raised alert: the facade logs and enqueues here. */
  onAlert?: (alert: Alert) => void;
  fetchImpl?: typeof fetch;
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
    alertEndpoint = null,
    onAlert,
    now = Date.now,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    severityCooldowns = {},
  } = options;
  const log: Logger = logger.child({ component: 'AlertDispatcher' });
  const handlers = new Set<AlertHandler>();
  const cooldowns = new Map<string, CooldownState>();
  const postToWebhook: typeof fetch =
    options.fetchImpl ??
    (async (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));

  const cooldownFor = (severity: AlertSeverity): number =>
    severityCooldowns[severity] ?? cooldownMs;

  function deliverWebhook(alert: Alert): void {
    if (!alertEndpoint) return;
    // Fire-and-forget by design: alert delivery must never block the code that
    // raised the alert, and a webhook that is down gets one warn, not a loop.
    postToWebhook(alertEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify(redactRecord({ ...alert })),
    }).catch((error: unknown) => {
      log.warn('Alert webhook delivery failed', {
        alertKey: alert.key,
        reason: error instanceof Error ? error.message : String(error),
      });
    });
  }

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
        } catch (error) {
          // A handler that throws must not take the others down with it.
          log.warn('Alert handler failed', {
            alertKey: alert.key,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
      deliverWebhook(alert);
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
