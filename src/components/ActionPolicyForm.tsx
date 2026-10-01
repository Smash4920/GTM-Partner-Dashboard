import { useState } from 'react';
import type { ActionPolicy } from '../data/types';
import { ACTION_POLICY_FIELDS, validateActionPolicy } from '../lib/actionPolicy';
import type { ActionPolicyErrors } from '../lib/actionPolicy';

export default function ActionPolicyForm({
  policy,
  onApply,
}: {
  policy: Readonly<ActionPolicy>;
  onApply: (policy: ActionPolicy) => void;
}) {
  const [draft, setDraft] = useState<Record<keyof ActionPolicy, string | number>>(() => ({
    ...policy,
  }));
  const [errors, setErrors] = useState<ActionPolicyErrors>({});
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const result = validateActionPolicy(draft);
        setErrors(result.errors);
        if (result.policy !== undefined) onApply(result.policy);
        else {
          const first = ACTION_POLICY_FIELDS.find(({ key }) => result.errors[key] !== undefined);
          document.getElementById(`policy-${first?.key}`)?.focus();
        }
      }}
    >
      <h2 className="text-sm font-medium text-bone">Demo policy</h2>
      <p className="mb-4 mt-2 text-xs text-granite">
        Policy is session-only and affects Action Center only. Reload restores defaults. Nothing is
        saved to browser storage.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {ACTION_POLICY_FIELDS.map(({ key, label }) => (
          <div key={key}>
            <label htmlFor={`policy-${key}`} className="block text-xs text-stone">
              {label}
            </label>
            <input
              id={`policy-${key}`}
              type="text"
              inputMode="numeric"
              value={String(draft[key])}
              aria-invalid={errors[key] !== undefined ? true : undefined}
              aria-describedby={errors[key] !== undefined ? `policy-error-${key}` : undefined}
              className="mt-1 w-full rounded border border-ash bg-canvas px-3 py-2 font-mono text-sm text-bone"
              onChange={(event) => {
                setDraft((current) => ({ ...current, [key]: event.target.value }));
                setErrors((current) => ({ ...current, [key]: undefined }));
              }}
            />
            {errors[key] !== undefined && (
              <p id={`policy-error-${key}`} className="mt-1 text-xs text-signal">
                {errors[key]}
              </p>
            )}
          </div>
        ))}
      </div>
      <button
        type="submit"
        className="mt-4 rounded border border-ash px-3 py-2 text-xs text-bone hover:bg-ash/20"
      >
        Apply demo policy
      </button>
    </form>
  );
}
