import type { FlagLifecycle } from '../flagGovernance';
import { OPERATIONAL_FLAG_DEFAULTS } from '../flagRuntime';

export interface FlagDefinition {
  readonly lifecycle: FlagLifecycle;
}

const ALL_ENVIRONMENTS = ['development', 'preview', 'production'] as const;

/** Complete operational lifecycle metadata; evaluator defaults have one source. */
export const FLAG_DEFINITIONS = {
  'telemetry.enabled': {
    lifecycle: {
      owner: 'GTM platform',
      purpose: 'Master switch for telemetry capture.',
      environments: ALL_ENVIRONMENTS,
      safeDefault: OPERATIONAL_FLAG_DEFAULTS['telemetry.enabled'],
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
      environments: ALL_ENVIRONMENTS,
      safeDefault: OPERATIONAL_FLAG_DEFAULTS['telemetry.logShipping'],
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
      environments: ALL_ENVIRONMENTS,
      safeDefault: OPERATIONAL_FLAG_DEFAULTS['analytics.enabled'],
      rolloutTrigger: 'On only after privacy approval, with telemetry on.',
      rollbackTrigger: 'Off on a privacy finding or new event field.',
      reviewDate: '2026-12-29',
      expiresAt: '2027-03-29',
      removalCondition: 'Remove when analytics moves server-side.',
    },
  },
} satisfies Record<keyof typeof OPERATIONAL_FLAG_DEFAULTS, FlagDefinition>;
