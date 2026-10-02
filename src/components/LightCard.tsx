import type { ReactNode } from 'react';

interface LightCardProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Factory's signature figure/ground move: the single bright (#EEEEEE) card on
 * the near-black canvas. Reserved for the one thing that needs attention.
 */
export default function LightCard({ title, subtitle, children, className = '' }: LightCardProps) {
  return (
    <section
      className={`rounded-card bg-bone p-5 [&_.text-granite]:text-graphite [&_.text-signal]:text-carbon [&_.text-metric]:text-carbon ${className}`}
    >
      <h2 className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.08em] text-canvas">
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-xs text-granite">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
