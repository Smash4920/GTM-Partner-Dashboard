import { useId, useState, type ReactNode } from 'react';
import { ChevronIcon } from './icons';

interface CollapsibleCardProps {
  title: string;
  subtitle?: string;
  /** Right-aligned control in the header, beside the collapse toggle. */
  action?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * A Card whose body can be folded away. The body stays mounted while
 * collapsed, so loaded pages, cursors, and in-flight queries survive a
 * collapse and reappear unchanged on expand.
 */
export default function CollapsibleCard({
  title,
  subtitle,
  action,
  children,
  defaultOpen = true,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();

  return (
    <section className="rounded-card border border-carbon">
      <div
        className={`flex flex-wrap items-start justify-between gap-3 px-5 py-4 ${
          open ? 'border-b border-carbon' : ''
        }`}
      >
        <div>
          <h2 className="font-mono text-xs uppercase tracking-[0.08em] text-stone">{title}</h2>
          {subtitle && <p className="mt-1 text-xs text-granite">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-3">
          {open && action}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
            className="flex min-h-6 items-center gap-1.5 rounded border border-ash px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/30 hover:text-bone"
          >
            <ChevronIcon
              className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
            />
            {open ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      <div id={bodyId} hidden={!open} className="p-5">
        {children}
      </div>
    </section>
  );
}
