import { useLayoutEffect, useRef, useState } from 'react';
import { PlusIcon, XIcon } from './icons';

interface AddPartnerFormProps {
  /** Partner manager the new prospect should be assigned to. */
  partnerManagerName: string;
  onAdd: (name: string) => void;
  onCancel: () => void;
}

/**
 * Inline form for registering a prospective partner mid-call: a call is
 * happening with someone not yet in the PRM, so the manager types a name and
 * the partner joins the book immediately.
 */
export default function AddPartnerForm({
  partnerManagerName,
  onAdd,
  onCancel,
}: AddPartnerFormProps) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef(document.activeElement);
  useLayoutEffect(() => {
    input.current?.focus();
    return () => {
      // The invoking select remains mounted while this inline form is open.
      queueMicrotask(() => {
        const control = opener.current;
        if (
          control instanceof HTMLElement &&
          control.isConnected &&
          !control.closest('dialog:not([open]), [hidden]')
        )
          control.focus();
      });
    };
  }, []);

  return (
    <div
      className="rounded border border-ash bg-carbon p-3"
      role="group"
      aria-label="Add prospective partner"
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
        New prospective partner · {partnerManagerName}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input
          ref={input}
          aria-label="Partner name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              if (event.key === 'Escape') onCancel();
              else if (trimmed) onAdd(trimmed);
            }
          }}
          placeholder="Partner name"
          className="min-w-0 flex-1 rounded border border-ash bg-canvas px-3 py-1.5 text-sm text-bone placeholder:text-graphite focus:border-signal focus:outline-none"
        />
        <button
          type="button"
          onClick={() => trimmed && onAdd(trimmed)}
          disabled={!trimmed}
          className="flex items-center gap-1 rounded border border-ash px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone transition-colors hover:bg-ash/30 disabled:opacity-40"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          Add
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="rounded p-1.5 text-granite transition-colors hover:text-stone"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
