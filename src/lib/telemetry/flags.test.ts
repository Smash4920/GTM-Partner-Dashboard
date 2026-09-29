import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditFlagLifecycle, FLAG_GOVERNANCE_AS_OF } from '../flagGovernance';
import {
  clearFlagOverrides,
  FLAG_DEFINITIONS,
  FLAG_KEYS,
  flagEnvKey,
  flagIssues,
  flagSnapshot,
  isFlagEnabled,
  resolveFlag,
  setFlagOverride,
  type FlagKey,
} from './flags';
import type { TelemetryEnv } from './config';

const envWith = (flags: Partial<Record<string, string | boolean>> = {}): TelemetryEnv => ({
  ...flags,
});

beforeEach(() => {
  clearFlagOverrides();
});

afterEach(() => {
  clearFlagOverrides();
});

describe('the flag registry', () => {
  it('declares every operational flag with complete lifecycle metadata', () => {
    expect(FLAG_KEYS).toEqual(['telemetry.enabled', 'telemetry.logShipping', 'analytics.enabled']);

    const violations = auditFlagLifecycle(
      FLAG_KEYS.map((key) => ({ key, lifecycle: FLAG_DEFINITIONS[key].lifecycle })),
      new Date(FLAG_GOVERNANCE_AS_OF),
    );

    expect(violations).toEqual([]);
  });

  it('fails deterministically on missing ownership and expired operational flags', () => {
    const asOf = new Date(FLAG_GOVERNANCE_AS_OF);
    const lifecycle = FLAG_DEFINITIONS['telemetry.enabled'].lifecycle;

    expect(
      auditFlagLifecycle(
        [{ key: 'telemetry.enabled', lifecycle: { ...lifecycle, owner: '' } }],
        asOf,
      ),
    ).toEqual([expect.objectContaining({ flagKey: 'telemetry.enabled', field: 'owner' })]);
    expect(
      auditFlagLifecycle(
        [
          {
            key: 'analytics.enabled',
            lifecycle: { ...lifecycle, reviewDate: '2025-06-01', expiresAt: '2026-01-01' },
          },
        ],
        asOf,
      ),
    ).toEqual([expect.objectContaining({ flagKey: 'analytics.enabled', field: 'expiresAt' })]);
  });

  it('derives each flag environment key from its name', () => {
    expect(flagEnvKey('telemetry.enabled')).toBe('VITE_FLAG_TELEMETRY_ENABLED');
    expect(flagEnvKey('analytics.enabled')).toBe('VITE_FLAG_ANALYTICS_ENABLED');
  });
});

describe('flag resolution order', () => {
  it('uses the documented defaults when nothing overrides them', () => {
    expect(isFlagEnabled('telemetry.enabled', envWith())).toBe(true);
    expect(isFlagEnabled('telemetry.logShipping', envWith())).toBe(false);
    // Analytics is independently opt-in and defaults off pending privacy
    // approval (VAL-SEC-002): telemetry being on never turns analytics on.
    expect(isFlagEnabled('analytics.enabled', envWith())).toBe(false);
  });

  it('lets the build environment flip a default', () => {
    const env = envWith({
      VITE_FLAG_TELEMETRY_ENABLED: 'false',
      VITE_FLAG_TELEMETRY_LOG_SHIPPING: 'on',
    });

    expect(resolveFlag('telemetry.enabled', env)).toEqual({
      key: 'telemetry.enabled',
      enabled: false,
      source: 'env',
    });
    expect(isFlagEnabled('telemetry.logShipping', env)).toBe(true);
  });

  it('recognizes the usual boolean spellings and trims whitespace', () => {
    const key: FlagKey = 'analytics.enabled';
    expect(isFlagEnabled(key, envWith({ VITE_FLAG_ANALYTICS_ENABLED: '1' }))).toBe(true);
    expect(isFlagEnabled(key, envWith({ VITE_FLAG_ANALYTICS_ENABLED: ' 0 ' }))).toBe(false);
    expect(isFlagEnabled(key, envWith({ VITE_FLAG_ANALYTICS_ENABLED: 'OFF' }))).toBe(false);
  });

  it('accepts a genuine boolean env value, since env types are not guaranteed', () => {
    const env = envWith({ VITE_FLAG_TELEMETRY_LOG_SHIPPING: true });

    expect(resolveFlag('telemetry.logShipping', env)).toEqual({
      key: 'telemetry.logShipping',
      enabled: true,
      source: 'env',
    });
    expect(flagIssues(env)).toEqual([]);
  });

  it('wins with the session override over both env and default', () => {
    const env = envWith({ VITE_FLAG_TELEMETRY_ENABLED: 'true' });
    const restore = setFlagOverride('telemetry.enabled', false);

    expect(resolveFlag('telemetry.enabled', env).source).toBe('override');
    expect(isFlagEnabled('telemetry.enabled', env)).toBe(false);

    restore();
    expect(isFlagEnabled('telemetry.enabled', env)).toBe(true);
  });
});

describe('invalid configuration', () => {
  it('falls back to the default and reports the problem for the health check', () => {
    const env = envWith({ VITE_FLAG_TELEMETRY_ENABLED: 'maybe' });

    expect(isFlagEnabled('telemetry.enabled', env)).toBe(true);
    expect(flagIssues(env)).toEqual([
      'VITE_FLAG_TELEMETRY_ENABLED is not true/false/on/off: using the default for telemetry.enabled',
    ]);
  });

  it('reports every malformed flag value, not just the first', () => {
    const env = envWith({
      VITE_FLAG_TELEMETRY_ENABLED: 'perhaps',
      VITE_FLAG_ANALYTICS_ENABLED: 'sometimes',
    });

    expect(flagIssues(env)).toHaveLength(2);
  });
});

describe('flagSnapshot', () => {
  it('reports every flag with its resolution source', () => {
    setFlagOverride('analytics.enabled', true);

    const snapshot = flagSnapshot(envWith({ VITE_FLAG_TELEMETRY_LOG_SHIPPING: 'true' }));

    expect(snapshot).toEqual([
      { key: 'telemetry.enabled', enabled: true, source: 'default' },
      { key: 'telemetry.logShipping', enabled: true, source: 'env' },
      { key: 'analytics.enabled', enabled: true, source: 'override' },
    ]);
  });

  it('clears every override at once', () => {
    setFlagOverride('analytics.enabled', true);
    setFlagOverride('telemetry.enabled', false);
    clearFlagOverrides();

    expect(flagSnapshot().every((flag) => flag.source === 'default')).toBe(true);
  });
});
