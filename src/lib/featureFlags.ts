const FEATURE_FLAG_DEFINITIONS = {
  productionRequirements: {
    description: 'Show the production migration requirements workspace.',
    owner: 'GTM platform',
    defaultValue: true,
    overrideEnvironmentKey: 'VITE_FEATURE_PRODUCTION_REQUIREMENTS',
    rolloutEnvironmentKey: 'VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT',
  },
} as const;

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

interface FeatureFlagEvaluation {
  enabled: boolean;
  reason:
    | 'default'
    | 'environment-override'
    | 'percentage-rollout'
    | 'invalid-configuration'
    | 'missing-subject';
  rolloutPercentage?: number;
}

export interface FeatureFlagClient {
  evaluate: (key: FeatureFlagKey, context?: FeatureFlagContext) => FeatureFlagEvaluation;
  isEnabled: (key: FeatureFlagKey, context?: FeatureFlagContext) => boolean;
}

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

export function createFeatureFlagClient(
  environment: FeatureFlagEnvironment = import.meta.env,
): FeatureFlagClient {
  const evaluate = (
    key: FeatureFlagKey,
    context: FeatureFlagContext = {},
  ): FeatureFlagEvaluation => {
    const definition = FEATURE_FLAG_DEFINITIONS[key];
    const override = parseOverride(environment[definition.overrideEnvironmentKey]);

    if (override !== undefined) {
      return override === null
        ? { enabled: definition.defaultValue, reason: 'invalid-configuration' }
        : { enabled: override, reason: 'environment-override' };
    }

    const rollout = parseRollout(environment[definition.rolloutEnvironmentKey]);
    if (rollout === null) {
      return { enabled: definition.defaultValue, reason: 'invalid-configuration' };
    }
    if (rollout === undefined) {
      return { enabled: definition.defaultValue, reason: 'default' };
    }
    if (!context.subjectKey) {
      return {
        enabled: definition.defaultValue,
        reason: 'missing-subject',
        rolloutPercentage: rollout,
      };
    }

    return {
      enabled: featureFlagBucket(key, context.subjectKey) < rollout,
      reason: 'percentage-rollout',
      rolloutPercentage: rollout,
    };
  };

  return {
    evaluate,
    isEnabled: (key, context) => evaluate(key, context).enabled,
  };
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
