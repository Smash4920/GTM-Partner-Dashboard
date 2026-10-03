import type { ReactNode } from 'react';
import {
  REGISTRATION_STATUS_META,
  ROADMAP_SCOPE_LABELS,
  ROADMAP_STATUS_META,
} from '../data/constants';
import type { RegistrationStatus, RoadmapScope, RoadmapStatus } from '../data/types';

/** Small mono uppercase chip. Classes come fully written from constants. */
export default function Badge({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${className}`}
    >
      {children}
    </span>
  );
}

/** Status pulse: colored dot + label. Color carries state, text stays neutral on light surfaces. */
export function StatusBadge({
  status,
  tone = 'dark',
}: {
  status: RegistrationStatus;
  tone?: 'dark' | 'light';
}) {
  const meta = REGISTRATION_STATUS_META[status];
  const textClass = tone === 'light' ? 'text-canvas' : meta.textClass;
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em]">
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`} />
      <span className={textClass}>{meta.label}</span>
    </span>
  );
}

/**
 * A scope-labeled Production Requirements status. The scope prefix ("Demo" or
 * "Production") keeps the two axes visibly and accessibly distinct, so a demo
 * badge never reads as a production claim. Prod-only steps carry a dashed
 * border, the same not-real-yet mark as the dashed "planned" wires on the Data
 * Connections map.
 */
export function RoadmapStatusBadge({
  scope,
  status,
}: {
  scope: RoadmapScope;
  status: RoadmapStatus;
}) {
  const meta = ROADMAP_STATUS_META[status];
  return (
    <Badge className={meta.badgeClass}>{`${ROADMAP_SCOPE_LABELS[scope]}: ${meta.label}`}</Badge>
  );
}
