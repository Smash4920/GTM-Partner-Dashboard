import type { ReactNode } from 'react';

interface CardProps {
  title?: string;
  subtitle?: string;
  /** Right-aligned control in the header, e.g. a slice toggle. */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Dark surface: transparent on the canvas, implied by a 1px carbon border. */
export default function Card({ title, subtitle, action, children, className = '' }: CardProps) {
  return (
    <section className={`rounded-card border border-carbon ${className}`}>
      {(title || subtitle || action) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-carbon px-5 py-4">
          <div>
            {title && (
              <h2 className="font-mono text-xs uppercase tracking-[0.08em] text-stone">{title}</h2>
            )}
            {subtitle && <p className="mt-1 text-xs text-granite">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
