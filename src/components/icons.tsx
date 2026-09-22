/**
 * Minimal 16px stroke icons for chrome only (navigation, edit affordances).
 * Stroke color inherits via currentColor so they fit the mono/hairline
 * aesthetic; color is never used for data meaning here.
 */
interface IconProps {
  className?: string;
}

const base = 'h-4 w-4';
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

export function MenuIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export function HomeIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
    </svg>
  );
}

export function PartnersIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.5 2.9-6 6.5-6s6.5 2.5 6.5 6" />
      <path d="M16 4.7a3.5 3.5 0 0 1 0 6.6" />
      <path d="M18.5 14.4c1.8 1 2.5 3 2.5 5.6" />
    </svg>
  );
}

export function ForecastIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="M3 3v18h18" />
      <path d="m7 15 3.5-4 3 2.5L18 8" />
      <circle cx="18" cy="8" r="1.4" />
    </svg>
  );
}

export function ActivityIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="1.5" />
      <path d="M3 9h18" />
      <path d="M8 3.5V6.5M16 3.5V6.5" />
      <path d="m8 13.5 2.5 2.5L14 12.5" />
    </svg>
  );
}

export function PortalIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M3 8h18M8 4v4M16 4v4" />
      <path d="M8 13h8M8 16h5" />
    </svg>
  );
}

export function RequirementsIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="m8 9 1.5 1.5L12 7.5M14 9h2M8 15l1.5 1.5L12 13.5M14 15h2" />
    </svg>
  );
}

export function PencilIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17l-1 4z" />
      <path d="m14 7 3 3" />
    </svg>
  );
}

export function CheckIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="m4.5 12.5 5 5L19.5 6.5" />
    </svg>
  );
}

export function XIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function PlusIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function ChevronIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

export function CommentIcon({ className = base }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} {...stroke} aria-hidden="true">
      <path d="M4 5h16v11H9l-5 4V5z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  );
}
