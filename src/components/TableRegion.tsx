import type { ReactNode } from 'react';

/** One keyboard/touch scroll boundary; the table keeps its native semantics. */
export default function TableRegion({
  label,
  children,
  className = '',
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="region"
      aria-label={`${label}, scrollable`}
      tabIndex={0}
      className={`w-full min-w-0 max-w-full overflow-auto rounded-card focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ash ${className}`}
    >
      {children}
    </div>
  );
}
