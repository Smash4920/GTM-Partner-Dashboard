import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MetricType } from 'web-vitals';
import {
  initializePerformanceTelemetry,
  parseSampleRate,
  type PerformanceTelemetryConfig,
} from './performanceTelemetry';
import { clearFlagOverrides, setFlagOverride } from './telemetry/flags';

const CONFIG: PerformanceTelemetryConfig = {
  endpoint: 'https://metrics.example.test/v1/browser',
  environment: 'test',
  release: 'abc123',
  sampleRate: 1,
};

const METRIC: MetricType = {
  name: 'LCP',
  value: 1834.5,
  delta: 1834.5,
  rating: 'good',
  id: 'v5-telemetry-id',
  entries: [],
  navigationType: 'navigate',
};

describe('parseSampleRate', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts the inclusive zero-to-one range', () => {
    expect(parseSampleRate('0')).toBe(0);
    expect(parseSampleRate('0.25')).toBe(0.25);
    expect(parseSampleRate('1')).toBe(1);
  });

  it('defaults absent and invalid values to full collection', () => {
    expect(parseSampleRate(undefined)).toBe(1);
    expect(parseSampleRate('')).toBe(1);
    expect(parseSampleRate('-0.1')).toBe(1);
    expect(parseSampleRate('1.1')).toBe(1);
    expect(parseSampleRate('not-a-number')).toBe(1);
  });
});

describe('initializePerformanceTelemetry', () => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearFlagOverrides();
  });

  it('does not register observers while the master telemetry switch is off (VAL-SEC-001)', () => {
    setFlagOverride('telemetry.enabled', false);
    const subscribe = vi.fn();

    const initialized = initializePerformanceTelemetry(CONFIG, {
      metricSubscribers: [subscribe],
      random: () => 0,
    });

    expect(initialized).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('stops sending mid-session when the master switch turns off', () => {
    let report: ((metric: MetricType) => void) | undefined;
    const sendBeacon = vi.fn(() => true);

    initializePerformanceTelemetry(CONFIG, {
      location: { pathname: '/' },
      metricSubscribers: [(callback) => (report = callback)],
      random: () => 0,
      sendBeacon,
    });
    setFlagOverride('telemetry.enabled', false);
    report?.(METRIC);

    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('does not register observers without an endpoint', () => {
    const subscribe = vi.fn();

    const initialized = initializePerformanceTelemetry(
      { ...CONFIG, endpoint: '' },
      { metricSubscribers: [subscribe] },
    );

    expect(initialized).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('samples whole page loads before registering observers', () => {
    const subscribe = vi.fn();

    const initialized = initializePerformanceTelemetry(
      { ...CONFIG, sampleRate: 0.2 },
      { metricSubscribers: [subscribe], random: () => 0.8 },
    );

    expect(initialized).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it('reports a privacy-safe web vital through sendBeacon', async () => {
    let report: ((metric: MetricType) => void) | undefined;
    const sendBeacon = vi.fn<(url: string, data: BodyInit) => boolean>(() => true);
    const fetch = vi.fn();

    const initialized = initializePerformanceTelemetry(CONFIG, {
      fetch,
      location: { pathname: '/GTM-Partner-Dashboard/forecasting' },
      metricSubscribers: [(callback) => (report = callback)],
      now: () => '2026-09-28T20:00:00.000Z',
      random: () => 0,
      sendBeacon,
    });
    report?.(METRIC);

    expect(initialized).toBe(true);
    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    const [endpoint, beaconBody] = sendBeacon.mock.calls[0];
    expect(endpoint).toBe(CONFIG.endpoint);
    expect(beaconBody).toBeInstanceOf(Blob);
    const body = await (beaconBody as Blob).text();
    expect(JSON.parse(body)).toEqual({
      schemaVersion: 1,
      type: 'web-vital',
      application: 'gtm-partner-dashboard',
      environment: 'test',
      release: 'abc123',
      route: '/GTM-Partner-Dashboard/forecasting',
      timestamp: '2026-09-28T20:00:00.000Z',
      metric: {
        name: 'LCP',
        value: 1834.5,
        delta: 1834.5,
        rating: 'good',
        id: 'v5-telemetry-id',
        navigationType: 'navigate',
      },
    });
  });

  it('falls back to keepalive fetch when sendBeacon declines the payload', () => {
    let report: ((metric: MetricType) => void) | undefined;
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));

    initializePerformanceTelemetry(CONFIG, {
      fetch,
      location: { pathname: '/' },
      metricSubscribers: [(callback) => (report = callback)],
      now: () => '2026-09-28T20:00:00.000Z',
      random: () => 0,
      sendBeacon: () => false,
    });
    report?.(METRIC);

    expect(fetch).toHaveBeenCalledWith(
      CONFIG.endpoint,
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        keepalive: true,
      }),
    );
  });

  it('contains collector failures instead of creating an unhandled rejection', async () => {
    let report: ((metric: MetricType) => void) | undefined;
    const fetch = vi.fn(() => Promise.reject(new Error('collector unavailable')));

    initializePerformanceTelemetry(CONFIG, {
      fetch,
      location: { pathname: '/' },
      metricSubscribers: [(callback) => (report = callback)],
      now: () => '2026-09-28T20:00:00.000Z',
      random: () => 0,
      sendBeacon: () => false,
    });

    expect(() => report?.(METRIC)).not.toThrow();
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled());
  });
});
