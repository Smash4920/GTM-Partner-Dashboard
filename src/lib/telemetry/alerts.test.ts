import { describe, expect, it, vi } from 'vitest';
import { createAlertDispatcher, type Alert, type AlertHandler } from './alerts';

const BASE = {
  release: '9f2c1ab',
  environment: 'production',
  sessionId: '0af7651916cd43dd8448eb211c80319c',
};

const transportFailure = {
  key: 'telemetry.transport_failed',
  severity: 'warning' as const,
  title: 'Telemetry delivery is failing',
  summary: 'Collector batches are failing: connection refused',
  detail: { reason: 'connection refused' },
};

function collect(): { alerts: Alert[]; handler: AlertHandler } {
  const alerts: Alert[] = [];
  return { alerts, handler: (alert) => alerts.push(alert) };
}

describe('createAlertDispatcher', () => {
  it('raises an alert stamped with the deployment, and delivers it to handlers and the observer', () => {
    const { alerts, handler } = collect();
    const onAlert = vi.fn();
    const dispatcher = createAlertDispatcher({
      ...BASE,
      onAlert,
      now: () => 1_758_000_000_000,
    });
    dispatcher.registerHandler(handler);

    const raised = dispatcher.raise(transportFailure);

    expect(raised).toMatchObject({
      key: 'telemetry.transport_failed',
      severity: 'warning',
      release: '9f2c1ab',
      environment: 'production',
      suppressed: 0,
      timestamp: new Date(1_758_000_000_000).toISOString(),
    });
    expect(alerts).toHaveLength(1);
    expect(onAlert).toHaveBeenCalledWith(raised);
  });

  it('suppresses repeats of the same key inside the cooldown, and counts them', () => {
    const dispatcher = createAlertDispatcher({
      ...BASE,
      now: (() => {
        let at = 1_000_000;
        return () => (at += 120_000);
      })(),
      cooldownMs: 300_000,
    });

    expect(dispatcher.raise(transportFailure)?.suppressed).toBe(0);
    expect(dispatcher.raise(transportFailure)).toBeNull();
    expect(dispatcher.raise(transportFailure)).toBeNull();
    // Past the cooldown the alert fires again and reports the backlog: it
    // fired once, was suppressed twice, and says so.
    expect(dispatcher.raise(transportFailure)?.suppressed).toBe(2);
  });

  it('applies a shorter cooldown to critical alerts so they re-page sooner', () => {
    const dispatcher = createAlertDispatcher({
      ...BASE,
      now: (() => {
        let at = 0;
        return () => (at += 120_000);
      })(),
      severityCooldowns: { critical: 60_000 },
    });
    const crash = {
      key: 'error:1c3a5e7f',
      severity: 'critical' as const,
      title: 'Render crashed',
      summary: 'Forecasting threw while rendering',
    };

    expect(dispatcher.raise(crash)).not.toBeNull();
    // 120s after the first raise: past the 60s critical cooldown, so it fires.
    expect(dispatcher.raise(crash)).not.toBeNull();
  });

  it('holds a critical alert back longer than the default window when told to', () => {
    const dispatcher = createAlertDispatcher({
      ...BASE,
      cooldownMs: 60_000,
      severityCooldowns: { critical: 600_000 },
      now: (() => {
        let at = 0;
        return () => (at += 300_000);
      })(),
    });
    const crash = {
      key: 'error:1c3a5e7f',
      severity: 'critical' as const,
      title: 'Render crashed',
      summary: 'Forecasting threw while rendering',
    };
    const noise = { ...crash, key: 'health.degraded', severity: 'info' as const };

    dispatcher.raise(crash);
    expect(dispatcher.raise(crash)).toBeNull();
    expect(dispatcher.raise(noise)).not.toBeNull();
  });

  it('isolates a throwing handler and still notifies the rest', () => {
    const { alerts, handler } = collect();
    const dispatcher = createAlertDispatcher({ ...BASE });
    dispatcher.registerHandler(() => {
      throw new Error('handler bug');
    });
    dispatcher.registerHandler(handler);

    const raised = dispatcher.raise(transportFailure);

    expect(raised).not.toBeNull();
    expect(alerts).toHaveLength(1);
  });

  it('unsubscribes handlers through the returned function', () => {
    const { alerts, handler } = collect();
    const dispatcher = createAlertDispatcher({ ...BASE });
    const unsubscribe = dispatcher.registerHandler(handler);
    unsubscribe();

    dispatcher.raise(transportFailure);

    expect(alerts).toHaveLength(0);
  });

  it('carries informational alerts at the default cooldown like any other', () => {
    const dispatcher = createAlertDispatcher({ ...BASE, cooldownMs: 60_000, now: () => 0 });

    const raised = dispatcher.raise({
      key: 'notice.data-refreshed',
      severity: 'info',
      title: 'Provider book refreshed',
      summary: 'The scaled book reloaded overnight',
    });
    const repeat = dispatcher.raise({
      key: 'notice.data-refreshed',
      severity: 'info',
      title: 'Provider book refreshed',
      summary: 'The scaled book reloaded overnight',
    });

    expect(raised?.severity).toBe('info');
    expect(repeat).toBeNull();
  });

  it('POSTs the alert to the webhook, redacted, and survives a webhook failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('hook down'));
    const dispatcher = createAlertDispatcher({
      ...BASE,
      alertEndpoint: 'https://hooks.test/alert',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(() =>
      dispatcher.raise({
        key: 'error:1c3a5e7f',
        severity: 'critical',
        title: 'Render crashed',
        summary: 'Invite for dana@corp.example bounced',
        detail: { apiKey: 'sk-live', route: 'data-connections' },
      }),
    ).not.toThrow();

    // The webhook is fire-and-forget: wait for the rejected call to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit & { body: string },
    ];
    expect(url).toBe('https://hooks.test/alert');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toMatchObject({
      key: 'error:1c3a5e7f',
      severity: 'critical',
      detail: { apiKey: '[redacted]', route: 'data-connections' },
    });
  });

  it('skips the webhook entirely when no endpoint is configured', async () => {
    const fetchImpl = vi.fn();
    const dispatcher = createAlertDispatcher({
      ...BASE,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    dispatcher.raise(transportFailure);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
