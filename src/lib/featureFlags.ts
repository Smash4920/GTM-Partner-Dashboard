import type { FlagLifecycle } from './flagGovernance';

/**
 * Product feature flags: local, deterministic, and non-authoritative.
 *
 * Every input is local to this build — a `VITE_*` environment value inlined
 * at build time. There is no remote flag service and no privileged control
 * plane; nothing here makes a network request. A flag can hide a feature
 * route, but it never grants a role, expands or mutates demo access scope,
 * selects another partner, adds a row, or bypasses provider filtering. That
 * separation is architectural: this module and `flagGovernance.ts` cannot
 * import access-scope or provider logic (enforced by eslint boundaries), and
 * the authorization-invariance test in `featureFlags.test.ts` pins identical
 * scope and row IDs across every evaluator state.
 *
 * Evaluation is fail-safe (see the "Feature flags" section of README.md):
 *
 * 1. A fresh, valid configured value is used and recorded as last known good.
 * 2. On a timeout, an unavailable source, or a malformed value, the recorded
 *    value is used only while it is younger than `maxCacheAgeMs`.
 * 3. Cold start, an absent cache, or a stale cache falls back to the
 *    registry's safe default, so an outage can never turn a feature on or
 *    hold an outdated value past its bound.
 * 4. A later valid value replaces the cache, so recovery is immediate.
 */

interface FeatureFlagDefinition {
  lifecycle: FlagLifecycle;
  overrideEnvironmentKey: string;
  rolloutEnvironmentKey: string;
}

export const FEATURE_FLAG_DEFINITIONS = {
  productionRequirements: {
    lifecycle: {
      owner: 'GTM platform',
      purpose: 'Show the production requirements migration workspace.',
      environments: ['development', 'preview', 'production'],
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
} as const satisfies Record<string, FeatureFlagDefinition>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFINITIONS;

type FeatureFlagEnvironment = Partial<
  Record<
    | (typeof FEATURE_FLAG_DEFINITIONS)[FeatureFlagKey]['overrideEnvironmentKey']
    | (typeof FEATURE_FLAG_DEFINITIONS)[FeatureFlagKey]['rolloutEnvironmentKey'],
    string
  >
>;

interface FeatureFlagContext {
  /** Stable, opaque identifier used only to assign a rollout cohort. */
  subjectKey?: string;
}

/** What the local configuration source concluded about a flag, before fail-safe handling. */
export type FlagSourceOutcome =
  | {
      kind: 'value';
      enabled: boolean;
      via: 'environment-override' | 'percentage-rollout';
      rolloutPercentage?: number;
    }
  | { kind: 'timeout'; rolloutPercentage?: number }
  | { kind: 'unavailable'; rolloutPercentage?: number }
  | { kind: 'malformed'; rolloutPercentage?: number }
  | { kind: 'missing-subject'; rolloutPercentage?: number };

type FlagEvaluationCause =
  | 'environment-override'
  | 'percentage-rollout'
  | 'timeout'
  | 'unavailable'
  | 'malformed'
  | 'missing-subject';

export interface FeatureFlagEvaluation {
  enabled: boolean;
  /** Where the returned value came from. */
  source: 'fresh' | 'last-known-good' | 'safe-default';
  /** Why that source supplied the value. */
  cause: FlagEvaluationCause;
  /** What happened to the bounded last-known-good cache during this evaluation. */
  cache: 'recorded' | 'used' | 'stale' | 'absent';
  /** Age of the cached value when the cache informed the decision. */
  cacheAgeMs?: number;
  rolloutPercentage?: number;
}

export interface FeatureFlagClient {
  evaluate: (key: FeatureFlagKey, context?: FeatureFlagContext) => FeatureFlagEvaluation;
  isEnabled: (key: FeatureFlagKey, context?: FeatureFlagContext) => boolean;
}

/** Reads one flag from the local configuration source. Never throws and never performs I/O. */
export type FlagSource = (key: FeatureFlagKey, context: FeatureFlagContext) => FlagSourceOutcome;

interface FlagCacheEntry {
  enabled: boolean;
  recordedAt: number;
}

/** How long a last-known-good value may serve while the source keeps failing. */
export const FLAG_CACHE_MAX_AGE_MS = 300_000; // 5 minutes

const ENABLED_VALUES = new Set(['1', 'true', 'on']);
const DISABLED_VALUES = new Set(['0', 'false', 'off']);

function parseOverride(value: string | undefined): boolean | undefined | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (ENABLED_VALUES.has(normalized)) return true;
  if (DISABLED_VALUES.has(normalized)) return false;
  return null;
}

function parseRollout(value: string | undefined): number | undefined | null {
  if (!value?.trim()) return undefined;
  const percentage = Number(value);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) return null;
  return percentage;
}

/** FNV-1a gives the same 0-99 bucket in every browser without network state. */
export function featureFlagBucket(key: FeatureFlagKey, subjectKey: string): number {
  let hash = 2_166_136_261;
  for (const character of `${key}:${subjectKey}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % 100;
}

function createEnvironmentSource(environment: FeatureFlagEnvironment): FlagSource {
  return (key, context) => {
    const definition = FEATURE_FLAG_DEFINITIONS[key];
    const override = parseOverride(environment[definition.overrideEnvironmentKey]);
    if (override === null) return { kind: 'malformed' };
    if (override !== undefined) {
      return { kind: 'value', enabled: override, via: 'environment-override' };
    }

    const rollout = parseRollout(environment[definition.rolloutEnvironmentKey]);
    if (rollout === null) return { kind: 'malformed' };
    if (rollout === undefined) return { kind: 'unavailable' };
    if (!context.subjectKey) {
      return { kind: 'missing-subject', rolloutPercentage: rollout };
    }

    return {
      kind: 'value',
      enabled: featureFlagBucket(key, context.subjectKey) < rollout,
      via: 'percentage-rollout',
      rolloutPercentage: rollout,
    };
  };
}

export interface FailSafeEvaluatorOptions {
  /** Injected clock; the wall clock only at the composition root. */
  now?: () => number;
  maxCacheAgeMs?: number;
}

/**
 * Wraps a flag source with the bounded last-known-good cache: a fresh value
 * wins and is recorded; a failing source serves the cached value inside its
 * age bound; anything else falls back to the registry safe default. The cache
 * is in-memory only: nothing is persisted, so a reload is always a cold start
 * and a cold start always yields the safe default.
 */
export function createFailSafeEvaluator(
  source: FlagSource,
  options: FailSafeEvaluatorOptions = {},
): FeatureFlagClient {
  const now = options.now ?? Date.now;
  const maxCacheAgeMs = options.maxCacheAgeMs ?? FLAG_CACHE_MAX_AGE_MS;
  const cache = new Map<FeatureFlagKey, FlagCacheEntry>();

  const evaluate = (
    key: FeatureFlagKey,
    context: FeatureFlagContext = {},
  ): FeatureFlagEvaluation => {
    const safeDefault = FEATURE_FLAG_DEFINITIONS[key].lifecycle.safeDefault;
    const outcome = source(key, context);
    const evaluatedAt = now();

    if (outcome.kind === 'value') {
      cache.set(key, { enabled: outcome.enabled, recordedAt: evaluatedAt });
      return {
        enabled: outcome.enabled,
        source: 'fresh',
        cause: outcome.via,
        cache: 'recorded',
        rolloutPercentage: outcome.rolloutPercentage,
      };
    }

    const cached = cache.get(key);
    const cacheAgeMs = cached === undefined ? 0 : evaluatedAt - cached.recordedAt;
    const usable = cached !== undefined && cacheAgeMs <= maxCacheAgeMs;
    return {
      enabled: usable ? cached.enabled : safeDefault,
      source: usable ? 'last-known-good' : 'safe-default',
      cause: outcome.kind,
      cache: cached === undefined ? 'absent' : usable ? 'used' : 'stale',
      cacheAgeMs: cached === undefined ? undefined : cacheAgeMs,
      rolloutPercentage: outcome.rolloutPercentage,
    };
  };

  return {
    evaluate,
    isEnabled: (key, context) => evaluate(key, context).enabled,
  };
}

export function createFeatureFlagClient(
  environment: FeatureFlagEnvironment = import.meta.env,
  options: FailSafeEvaluatorOptions = {},
): FeatureFlagClient {
  return createFailSafeEvaluator(createEnvironmentSource(environment), options);
}

const ANONYMOUS_SUBJECT_KEY = 'gtm.feature-flags.subject.v1';

/**
 * Persists only an opaque cohort id. If storage is blocked, the same id is
 * retained in memory so flag values do not change during the current session.
 */
export function createFeatureFlagSubjectProvider(
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.localStorage,
  createSubject: () => string = () => crypto.randomUUID(),
): () => string {
  let inMemorySubject: string | undefined;
  return () => {
    try {
      const existing = storage.getItem(ANONYMOUS_SUBJECT_KEY);
      if (existing) return existing;
    } catch {
      // Continue with the page-scoped fallback when browser storage is blocked.
    }

    inMemorySubject ??= createSubject();
    try {
      storage.setItem(ANONYMOUS_SUBJECT_KEY, inMemorySubject);
    } catch {
      // The in-memory value still keeps evaluation stable for this page.
    }
    return inMemorySubject;
  };
}

export const featureFlags = createFeatureFlagClient();
export const getFeatureFlagSubject = createFeatureFlagSubjectProvider();
