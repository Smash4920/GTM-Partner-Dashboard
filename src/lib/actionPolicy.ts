import type { ActionPolicy } from '../data/types';

export const DEFAULT_ACTION_POLICY: Readonly<ActionPolicy> = Object.freeze({
  highValueAmount: 400_000,
  staleCalendarDays: 14,
  missingNextStepHorizonDays: 60,
  closeSlipCalendarDays: 7,
  healthWindowDays: 28,
  minimumDeterioratingDrivers: 2,
});

export const ACTION_POLICY_FIELDS: readonly { key: keyof ActionPolicy; label: string }[] = [
  { key: 'highValueAmount', label: 'High value (USD)' },
  { key: 'staleCalendarDays', label: 'Stale days (calendar)' },
  { key: 'missingNextStepHorizonDays', label: 'Missing-step horizon (days)' },
  { key: 'closeSlipCalendarDays', label: 'Close-slip days (calendar)' },
  { key: 'healthWindowDays', label: 'Health-window days' },
  { key: 'minimumDeterioratingDrivers', label: 'Minimum deteriorating drivers' },
];

export type ActionPolicyErrors = Partial<Record<keyof ActionPolicy, string>>;

/** Invalid drafts never yield an applied policy, so callers cannot query with them. */
export function validateActionPolicy(draft: Record<keyof ActionPolicy, string | number>): {
  policy?: ActionPolicy;
  errors: ActionPolicyErrors;
} {
  const errors: ActionPolicyErrors = {};
  const policy = { ...DEFAULT_ACTION_POLICY };
  for (const { key } of ACTION_POLICY_FIELDS) {
    const raw = draft[key];
    const value = typeof raw === 'string' && raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
      errors[key] = 'Enter a finite positive integer.';
    } else if (key === 'minimumDeterioratingDrivers' && value > 4) {
      errors[key] = 'Enter an integer from 1 to 4.';
    } else {
      policy[key] = value;
    }
  }
  return Object.keys(errors).length === 0 ? { policy, errors } : { errors };
}
