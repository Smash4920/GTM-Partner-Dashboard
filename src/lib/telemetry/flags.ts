import { OPERATIONAL_FLAG_DEFAULTS, parseFlagValue } from '../flagRuntime';
import type { TelemetryEnv } from './config';
export { FLAG_DEFINITIONS } from './flagDefinitions';
export type { FlagDefinition } from './flagDefinitions';

/**
 * Explicit operational flags for the dashboard's telemetry pipeline.
 *
 * These are the operational counterpart to the product flag registry in
 * `src/lib/featureFlags.ts`; both registries carry the same lifecycle
 * contract from `src/lib/flagGovernance.ts` (owner, purpose, environment
 * scope, safe default, rollout/rollback triggers, review date, expiry, and
 * removal condition), and the same deterministic policy audit rejects missing
 * metadata or an expired flag here.
 *
 * Resolution order is: runtime override, then the build-time environment
 * (`VITE_FLAG_<NAME>`), then the safe default. Overrides live in memory
 * for the session only; nothing is persisted to browser storage, so a reload
 * is always a clean slate and no flag state survives on a shared machine.
 * Every input is local and non-authoritative: a flag suppresses telemetry
 * execution paths but never grants a role, rows, or access.
 *
 * The set is deliberately small: a flag is a live experiment or an operational
 * switch with an owner, not a settings page.
 */

export type FlagKey = keyof typeof OPERATIONAL_FLAG_DEFAULTS;

export const FLAG_KEYS = Object.keys(OPERATIONAL_FLAG_DEFAULTS) as FlagKey[];

type FlagSource = 'default' | 'env' | 'override';

export interface FlagResolution {
  key: FlagKey;
  enabled: boolean;
  source: FlagSource;
}

/** Session-only overrides, applied on top of env and defaults. */
const overrides = new Map<FlagKey, boolean>();

/**
 * `telemetry.logShipping` → `VITE_FLAG_TELEMETRY_LOG_SHIPPING`: camelCase
 * becomes snake_case, dots become underscores, and the whole key upper-cases,
 * so a flag and its env knob are derivable from each other rather than
 * maintained twice.
 */
export function flagEnvKey(key: FlagKey): string {
  return `VITE_FLAG_${key
    .replace(/[A-Z]/g, (letter) => `_${letter}`)
    .replace(/\./g, '_')
    .toUpperCase()}`;
}

/**
 * Resolves one flag against the override, then the environment, then the
 * default. An env value that is not a recognized boolean is ignored and left
 * for `flagIssues` to report — a typo should disable nothing silently.
 */
export function isFlagEnabled(key: FlagKey, env: TelemetryEnv = import.meta.env): boolean {
  return resolveFlag(key, env).enabled;
}

export function resolveFlag(key: FlagKey, env: TelemetryEnv = import.meta.env): FlagResolution {
  const override = overrides.get(key);
  if (override !== undefined) return { key, enabled: override, source: 'override' };

  const envValue = env[flagEnvKey(key)];
  const parsed =
    envValue === undefined || typeof envValue === 'boolean'
      ? ((envValue as boolean | undefined) ?? null)
      : parseFlagValue(envValue);
  if (parsed !== null) return { key, enabled: parsed, source: 'env' };

  return { key, enabled: OPERATIONAL_FLAG_DEFAULTS[key], source: 'default' };
}

/** Every flag and how it resolved, for the health artifact and support conversations. */
export function flagSnapshot(env: TelemetryEnv = import.meta.env): FlagResolution[] {
  return FLAG_KEYS.map((key) => resolveFlag(key, env));
}

/** Build-time flag values that could not be parsed, so the health check can report them. */
export function flagIssues(env: TelemetryEnv = import.meta.env): string[] {
  const issues: string[] = [];
  for (const key of FLAG_KEYS) {
    const value = env[flagEnvKey(key)];
    if (value === undefined || typeof value === 'boolean') continue;
    if (parseFlagValue(value) === null) {
      issues.push(`${flagEnvKey(key)} is not true/false/on/off: using the default for ${key}`);
    }
  }
  return issues;
}

/** Overrides a flag for this session; the disposer restores the previous state. */
export function setFlagOverride(key: FlagKey, enabled: boolean): () => void {
  overrides.set(key, enabled);
  return () => {
    overrides.delete(key);
  };
}

/** Clears every session override — also the reset hook tests use between cases. */
export function clearFlagOverrides(): void {
  overrides.clear();
}
