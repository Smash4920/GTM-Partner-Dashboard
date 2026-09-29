import type { FlagLifecycle } from '../flagGovernance';
import type { TelemetryEnv } from './config';

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

export interface FlagDefinition {
  readonly lifecycle: FlagLifecycle;
}

/** Shared environment scope; lifecycle strings stay terse — the bundle ships them. */
const ALL_ENVIRONMENTS = ['development', 'preview', 'production'] as const;

export const FLAG_DEFINITIONS = {
  // Master switch for spans, metrics, error capture, and envelope shipping.
  // When off, provider calls delegate straight through and nothing is recorded.
  'telemetry.enabled': {
    lifecycle: {
      owner: 'GTM platform',
      purpose: 'Master switch for telemetry capture.',
      environments: ALL_ENVIRONMENTS,
      safeDefault: true,
      rolloutTrigger: 'Keep on while envelopes stay allowlisted.',
      rollbackTrigger: 'Off if a payload carries unlisted fields.',
      reviewDate: '2026-12-29',
      expiresAt: '2027-03-29',
      removalCondition: 'Remove when the switch moves server-side.',
    },
  },
  // Off by default: logs are chatty, and shipping them is a deliberate choice.
  'telemetry.logShipping': {
    lifecycle: {
      owner: 'GTM platform',
      purpose: 'Ship structured logs at the configured level.',
      environments: ALL_ENVIRONMENTS,
      safeDefault: false,
      rolloutTrigger: 'Enable after volume and redaction review.',
      rollbackTrigger: 'Off on redaction gaps or cost spikes.',
      reviewDate: '2026-12-29',
      expiresAt: '2027-03-29',
      removalCondition: 'Remove when configured at the collector.',
    },
  },
  // Route views, provider swaps, and manager edits; counts and identifiers
  // only, never user prose. Off by default pending privacy approval, and
  // emits only while the telemetry master switch is also on.
  'analytics.enabled': {
    lifecycle: {
      owner: 'GTM platform',
      purpose: 'Emit allowlisted product analytics events.',
      environments: ALL_ENVIRONMENTS,
      safeDefault: false,
      rolloutTrigger: 'On only after privacy approval, with telemetry on.',
      rollbackTrigger: 'Off on a privacy finding or new event field.',
      reviewDate: '2026-12-29',
      expiresAt: '2027-03-29',
      removalCondition: 'Remove when analytics moves server-side.',
    },
  },
} satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAG_DEFINITIONS;

export const FLAG_KEYS = Object.keys(FLAG_DEFINITIONS) as FlagKey[];

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

function parseFlagValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  return null;
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

  return { key, enabled: FLAG_DEFINITIONS[key].lifecycle.safeDefault, source: 'default' };
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
