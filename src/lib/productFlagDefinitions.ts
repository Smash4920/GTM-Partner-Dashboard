import type { FlagLifecycle } from './flagGovernance';
import { PRODUCT_FLAG_RUNTIME } from './flagRuntime';

interface FeatureFlagDefinition {
  lifecycle: FlagLifecycle;
  overrideEnvironmentKey: string;
  rolloutEnvironmentKey: string;
}

const { safeDefault, overrideEnvironmentKey, rolloutEnvironmentKey } =
  PRODUCT_FLAG_RUNTIME.productionRequirements;

/** Complete governance registry, also exported from the original evaluator module. */
export const FEATURE_FLAG_DEFINITIONS = {
  productionRequirements: {
    lifecycle: {
      owner: 'GTM platform',
      purpose: 'Show the production requirements migration workspace.',
      environments: ['development', 'preview', 'production'],
      safeDefault,
      rolloutTrigger: 'Raise once workspace content matches the verified build.',
      rollbackTrigger: 'Safe default if the workspace shows unverified claims.',
      reviewDate: '2026-12-29',
      expiresAt: '2027-03-29',
      removalCondition: 'Remove once the workspace is a permanent route.',
    },
    overrideEnvironmentKey,
    rolloutEnvironmentKey,
  },
} as const satisfies Record<keyof typeof PRODUCT_FLAG_RUNTIME, FeatureFlagDefinition>;
