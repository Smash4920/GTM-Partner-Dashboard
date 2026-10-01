/**
 * Minimal evaluator inputs. Governance registries compose these same defaults
 * and keys with their complete lifecycle prose, without shipping that prose
 * on the runtime evaluation path.
 */
export const PRODUCT_FLAG_RUNTIME = {
  productionRequirements: {
    safeDefault: true,
    overrideEnvironmentKey: 'VITE_FEATURE_PRODUCTION_REQUIREMENTS',
    rolloutEnvironmentKey: 'VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT',
  },
} as const;

export const OPERATIONAL_FLAG_DEFAULTS = {
  'telemetry.enabled': true,
  'telemetry.logShipping': false,
  'analytics.enabled': false,
};

/** Boolean syntax shared by product and operational local configuration. */
export function parseFlagValue(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'off') return false;
  return null;
}
