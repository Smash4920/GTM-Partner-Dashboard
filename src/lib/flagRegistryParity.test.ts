import { describe, expect, it } from 'vitest';
import { FEATURE_FLAG_DEFINITIONS, createFeatureFlagClient } from './featureFlags';
import {
  FLAG_DEFINITIONS,
  FLAG_KEYS,
  flagSnapshot,
  resolveFlag,
  flagIssues,
  type FlagDefinition,
  type FlagKey,
} from './telemetry/flags';
import { auditFlagLifecycle, FLAG_GOVERNANCE_AS_OF } from './flagGovernance';

const environments = ['development', 'preview', 'production'];
const operationalRegistry: Record<FlagKey, FlagDefinition> = FLAG_DEFINITIONS;

describe('complete exported flag registry parity', () => {
  it.each([
    ['1', true],
    ['true', true],
    [' ON ', true],
    ['0', false],
    ['false', false],
    [' OFF ', false],
  ])('preserves shared boolean syntax for %s in both evaluators', (value, enabled) => {
    expect(
      createFeatureFlagClient({ VITE_FEATURE_PRODUCTION_REQUIREMENTS: value as string }).evaluate(
        'productionRequirements',
      ),
    ).toMatchObject({ enabled, source: 'fresh', cause: 'environment-override' });
    expect(resolveFlag('telemetry.enabled', { VITE_FLAG_TELEMETRY_ENABLED: value })).toEqual({
      key: 'telemetry.enabled',
      enabled,
      source: 'env',
    });
  });

  it.each(['', '  ', 'maybe'])(
    'preserves distinct absent and malformed handling for %j',
    (value) => {
      expect(
        createFeatureFlagClient({ VITE_FEATURE_PRODUCTION_REQUIREMENTS: value }).evaluate(
          'productionRequirements',
        ),
      ).toMatchObject({
        enabled: true,
        source: 'safe-default',
        cause: value.trim() ? 'malformed' : 'unavailable',
      });
      const env = { VITE_FLAG_TELEMETRY_ENABLED: value };
      expect(resolveFlag('telemetry.enabled', env)).toMatchObject({
        enabled: true,
        source: 'default',
      });
      expect(flagIssues(env)).toHaveLength(1);
    },
  );

  it('preserves every product lifecycle field and environment key', () => {
    expect(FEATURE_FLAG_DEFINITIONS).toStrictEqual({
      productionRequirements: {
        lifecycle: {
          owner: 'GTM platform',
          purpose: 'Show the production requirements migration workspace.',
          environments,
          safeDefault: true,
          rolloutTrigger: 'Raise once workspace content matches the verified build.',
          rollbackTrigger: 'Safe default if the workspace shows unverified claims.',
          reviewDate: '2026-12-29',
          expiresAt: '2027-03-29',
          removalCondition: 'Remove once the workspace is a permanent route.',
        },
        overrideEnvironmentKey: 'VITE_FEATURE_PRODUCTION_REQUIREMENTS',
        rolloutEnvironmentKey: 'VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT',
      },
    });
  });

  it('preserves every operational lifecycle field and registry order', () => {
    expect(FLAG_DEFINITIONS).toStrictEqual({
      'telemetry.enabled': {
        lifecycle: {
          owner: 'GTM platform',
          purpose: 'Master switch for telemetry capture.',
          environments,
          safeDefault: true,
          rolloutTrigger: 'Keep on while envelopes stay allowlisted.',
          rollbackTrigger: 'Off if a payload carries unlisted fields.',
          reviewDate: '2026-12-29',
          expiresAt: '2027-03-29',
          removalCondition: 'Remove when the switch moves server-side.',
        },
      },
      'telemetry.logShipping': {
        lifecycle: {
          owner: 'GTM platform',
          purpose: 'Ship structured logs at the configured level.',
          environments,
          safeDefault: false,
          rolloutTrigger: 'Enable after volume and redaction review.',
          rollbackTrigger: 'Off on redaction gaps or cost spikes.',
          reviewDate: '2026-12-29',
          expiresAt: '2027-03-29',
          removalCondition: 'Remove when configured at the collector.',
        },
      },
      'analytics.enabled': {
        lifecycle: {
          owner: 'GTM platform',
          purpose: 'Emit allowlisted product analytics events.',
          environments,
          safeDefault: false,
          rolloutTrigger: 'On only after privacy approval, with telemetry on.',
          rollbackTrigger: 'Off on a privacy finding or new event field.',
          reviewDate: '2026-12-29',
          expiresAt: '2027-03-29',
          removalCondition: 'Remove when analytics moves server-side.',
        },
      },
    });
    expect(Object.keys(operationalRegistry)).toEqual(FLAG_KEYS);
  });

  it('evaluates cold-start defaults from the complete governed registries', () => {
    const client = createFeatureFlagClient({});
    for (const key of Object.keys(FEATURE_FLAG_DEFINITIONS) as Array<
      keyof typeof FEATURE_FLAG_DEFINITIONS
    >) {
      expect(client.evaluate(key).enabled).toBe(
        FEATURE_FLAG_DEFINITIONS[key].lifecycle.safeDefault,
      );
    }
    expect(flagSnapshot({})).toStrictEqual(
      FLAG_KEYS.map((key) => ({
        key,
        enabled: FLAG_DEFINITIONS[key].lifecycle.safeDefault,
        source: 'default',
      })),
    );
    expect(
      auditFlagLifecycle(
        [
          ...Object.entries(FEATURE_FLAG_DEFINITIONS).map(([key, { lifecycle }]) => ({
            key,
            lifecycle,
          })),
          ...Object.entries(FLAG_DEFINITIONS).map(([key, { lifecycle }]) => ({
            key,
            lifecycle,
          })),
        ],
        new Date(FLAG_GOVERNANCE_AS_OF),
      ),
    ).toEqual([]);
  });
});
