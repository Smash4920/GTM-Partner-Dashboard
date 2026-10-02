import { cloneElement, useId, type ReactElement } from 'react';

interface FieldControlProps {
  id?: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

/** Called with the validated error map, before React renders the linked text. */
export function focusInvalid(form: HTMLElement, errors: Partial<Record<string, string>>) {
  const first = Object.keys(errors).find((field) => errors[field]);
  if (!first) return false;
  form.querySelector<HTMLElement>(`[name="${first}"]:not(:disabled)`)?.focus();
  return true;
}

/** Keep the visible label and error separate so an error never renames a field. */
export default function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactElement<FieldControlProps>;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-stone">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? `${id}-error` : undefined,
      })}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-signal">
          {error}
        </p>
      )}
    </div>
  );
}
