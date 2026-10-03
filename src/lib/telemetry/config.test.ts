import { describe, expect, it } from 'vitest';
import { createSessionId, randomHex, readTelemetryConfig, type TelemetryEnv } from './config';

/**
 * Configuration is read from plain objects rather than import.meta.env so the
 * parsing logic is exercised without stubbing the real environment.
 */
const withEnv = (fields: Partial<TelemetryEnv>): TelemetryEnv => ({
  MODE: 'production',
  PROD: true,
  DEV: false,
  ...fields,
});

describe('readTelemetryConfig', () => {
  it('stays entirely in-process when nothing is configured', () => {
    const config = readTelemetryConfig(withEnv({ PROD: false }));

    expect(config.endpoint).toBeNull();
    expect(config.dashboardUrl).toBeNull();
    expect(config.analyticsMeasurementId).toBeNull();
    expect(config.sampleRate).toBe(1);
    expect(config.issues).toEqual([]);
  });

  it('accepts release ids and sampling configuration', () => {
    const config = readTelemetryConfig(
      withEnv({
        VITE_TELEMETRY_DASHBOARD_URL: 'https://observe.internal/dashboard',
        VITE_RELEASE: '  9f2c1ab  ',
        VITE_TELEMETRY_LOG_LEVEL: 'error',
        VITE_TELEMETRY_SAMPLE_RATE: '0.25',
        VITE_GA_MEASUREMENT_ID: ' G-TEST123 ',
      }),
    );

    expect(config.dashboardUrl).toBe('https://observe.internal/dashboard');
    expect(config.release).toBe('9f2c1ab');
    expect(config.logShipLevel).toBe('error');
    expect(config.sampleRate).toBe(0.25);
    expect(config.analyticsMeasurementId).toBe('G-TEST123');
  });

  it('falls back to the Vercel commit SHA, then to an honest unlabeled release', () => {
    const fromVercel = readTelemetryConfig(withEnv({ VITE_VERCEL_GIT_COMMIT_SHA: 'abc123' }));
    const unlabeled = readTelemetryConfig(withEnv({}));
    const development = readTelemetryConfig(
      withEnv({ PROD: false, DEV: true, MODE: 'development' }),
    );

    expect(fromVercel.release).toBe('abc123');
    expect(unlabeled.release).toBe('unlabeled-release');
    expect(development.release).toBe('dev');
  });

  it('keeps the defaults for values that do not parse, and says so', () => {
    const config = readTelemetryConfig(
      withEnv({
        VITE_TELEMETRY_SAMPLE_RATE: 'most of them',
        VITE_TELEMETRY_LOG_LEVEL: 'yell',
      }),
    );

    expect(config.sampleRate).toBe(1);
    expect(config.logShipLevel).toBe('warn');
    expect(config.issues).toEqual([
      'VITE_TELEMETRY_LOG_LEVEL is not one of debug/info/warn/error: defaulting to warn',
      'VITE_TELEMETRY_SAMPLE_RATE is not a number; using full sampling',
    ]);
  });

  it('clamps out-of-range sample rates into the valid interval', () => {
    expect(readTelemetryConfig(withEnv({ VITE_TELEMETRY_SAMPLE_RATE: '4' })).sampleRate).toBe(1);
    expect(readTelemetryConfig(withEnv({ VITE_TELEMETRY_SAMPLE_RATE: '-2' })).sampleRate).toBe(0);
  });

  it('carries the build mode as the environment', () => {
    expect(readTelemetryConfig(withEnv({ MODE: 'production' })).environment).toBe('production');
  });
});

describe('endpoint policy (VAL-SEC-005)', () => {
  const prodEnv = (value: string | undefined): TelemetryEnv =>
    withEnv({ VITE_TELEMETRY_ENDPOINT: value });
  const devEnv = (value: string | undefined): TelemetryEnv =>
    withEnv({ PROD: false, DEV: true, MODE: 'development', VITE_TELEMETRY_ENDPOINT: value });

  it('rejects every production destination until a host is approved, fail-closed', () => {
    // The approved host list is intentionally empty: no external collector is
    // approved, so even a well-formed HTTPS URL resolves to local-only.
    const config = readTelemetryConfig(prodEnv('https://collector.internal/ingest'));

    expect(config.endpoint).toBeNull();
    expect(config.issues).toEqual([
      'VITE_TELEMETRY_ENDPOINT rejected: host is not on the approved telemetry host list; telemetry stays in-process',
    ]);
  });

  it('rejects the rejected-URL matrix in production: http, protocol-relative, credentials, ports, queries, malformed', () => {
    const cases: Array<[string, string]> = [
      ['http://collector.internal/ingest', 'must be an HTTPS URL'],
      ['//collector.internal/ingest', 'not a valid URL'],
      ['https://user:pw@collector.internal/ingest', 'must not embed credentials'],
      ['https://collector.internal:8443/ingest', 'must use the default HTTPS port'],
      ['https://collector.internal/ingest?token=abc', 'must not carry a query string or fragment'],
      ['not a url', 'not a valid URL'],
      ['file:///etc/passwd', 'must be an HTTPS URL'],
    ];

    for (const [value, cause] of cases) {
      const config = readTelemetryConfig(prodEnv(value));
      expect(config.endpoint).toBeNull();
      expect(config.issues).toContain(
        `VITE_TELEMETRY_ENDPOINT rejected: ${cause}; telemetry stays in-process`,
      );
    }
  });

  it('allows loopback HTTP only outside production builds', () => {
    const dev = readTelemetryConfig(devEnv('http://127.0.0.1:9000/ingest'));

    expect(dev.endpoint).toBe('http://127.0.0.1:9000/ingest');
    expect(dev.issues).toEqual([]);

    // The same loopback URL in a production build fails closed.
    const prod = readTelemetryConfig(prodEnv('http://127.0.0.1:9000/ingest'));
    expect(prod.endpoint).toBeNull();
    expect(prod.issues).toContain(
      'VITE_TELEMETRY_ENDPOINT rejected: must be an HTTPS URL; telemetry stays in-process',
    );
  });

  it('rejects non-loopback HTTP even in development', () => {
    const config = readTelemetryConfig(devEnv('http://collector.internal/ingest'));

    expect(config.endpoint).toBeNull();
    expect(config.issues).toContain(
      'VITE_TELEMETRY_ENDPOINT rejected: must be an HTTPS URL; telemetry stays in-process',
    );
  });

  it('validates the dashboard URL as metadata without the approved-host rule', () => {
    const accepted = readTelemetryConfig(
      withEnv({ VITE_TELEMETRY_DASHBOARD_URL: 'https://observe.internal/board' }),
    );
    expect(accepted.dashboardUrl).toBe('https://observe.internal/board');

    const withQuery = readTelemetryConfig(
      withEnv({ VITE_TELEMETRY_DASHBOARD_URL: 'https://observe.internal/board?apiKey=x' }),
    );
    expect(withQuery.dashboardUrl).toBeNull();
    expect(withQuery.issues).toContain(
      'VITE_TELEMETRY_DASHBOARD_URL rejected: must not carry a query string or fragment; telemetry stays in-process',
    );
  });
});

describe('identifier generation', () => {
  it('makes unique hex identifiers of the requested byte width', () => {
    const first = createSessionId();
    const second = createSessionId();

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
    expect(randomHex(0)).toBe('');
  });

  it('falls back to ordinary randomness when no CSPRNG is present', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });

    try {
      expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    }
  });
});
