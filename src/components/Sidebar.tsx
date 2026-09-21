import type { ReactNode } from 'react';
import { ActivityIcon, ForecastIcon, HomeIcon, PartnersIcon } from './icons';

export type Route = 'home' | 'partners' | 'forecasting' | 'activity';

export const ROUTES: { id: Route; label: string; icon: (props: { className?: string }) => ReactNode }[] = [
  { id: 'home', label: 'Home', icon: HomeIcon },
  { id: 'partners', label: 'Partner Performance', icon: PartnersIcon },
  { id: 'forecasting', label: 'Forecasting', icon: ForecastIcon },
  { id: 'activity', label: 'Activity Tracking', icon: ActivityIcon },
];

interface SidebarProps {
  collapsed: boolean;
  route: Route;
  onNavigate: (route: Route) => void;
}

/** Left navigation rail; collapses to an icon strip when the header toggle is hit. */
export default function Sidebar({ collapsed, route, onNavigate }: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className={`sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col gap-1 overflow-y-auto border-r border-carbon bg-canvas px-2 py-4 transition-[width] duration-200 sm:flex ${
        collapsed ? 'w-14' : 'w-52'
      }`}
    >
      {ROUTES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onNavigate(id)}
          aria-current={route === id ? 'page' : undefined}
          title={collapsed ? label : undefined}
          className={`flex items-center gap-3 rounded px-2 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-150 ${
            collapsed ? 'justify-center' : ''
          } ${
            route === id
              ? 'bg-carbon text-bone'
              : 'text-granite hover:bg-ash/20 hover:text-stone'
          }`}
        >
          <Icon className={`h-4 w-4 ${route === id ? 'text-signal' : ''}`} />
          {!collapsed && <span className="truncate">{label}</span>}
        </button>
      ))}
    </nav>
  );
}
