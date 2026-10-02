import type { ReactNode } from 'react';
import { ROUTES, type Route } from '../data/routes';
export type { Route } from '../data/routes';
import {
  ActivityIcon,
  ConnectionsIcon,
  ForecastIcon,
  HomeIcon,
  PartnersIcon,
  PortalIcon,
  RegistrationIcon,
  RequirementsIcon,
} from './icons';

const ROUTE_ICONS: Record<Route, (props: { className?: string }) => ReactNode> = {
  home: HomeIcon,
  partners: PartnersIcon,
  forecasting: ForecastIcon,
  'action-center': RegistrationIcon,
  'registration-ops': RegistrationIcon,
  activity: ActivityIcon,
  'partner-view': PortalIcon,
  'production-requirements': RequirementsIcon,
  'data-connections': ConnectionsIcon,
};

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  route: Route;
  hiddenRoutes?: readonly Route[];
  onNavigate: (route: Route) => void;
}

/** Left navigation rail; collapses to an icon strip when the header toggle is hit. */
export default function Sidebar({
  collapsed,
  mobileOpen,
  route,
  hiddenRoutes = [],
  onNavigate,
}: SidebarProps) {
  const visibleRoutes = ROUTES.filter(({ id }) => !hiddenRoutes.includes(id));

  return (
    <nav
      id="primary-navigation"
      aria-label="Primary"
      className={`fixed inset-x-0 top-16 z-30 max-h-[calc(100vh-4rem)] flex-col gap-1 overflow-y-auto border-b border-carbon bg-canvas px-2 py-4 transition-[width] duration-200 sm:sticky sm:top-16 sm:z-auto sm:h-[calc(100vh-4rem)] sm:shrink-0 sm:border-b-0 sm:border-r ${
        mobileOpen ? 'flex' : 'hidden'
      } sm:flex ${collapsed ? 'sm:w-14' : 'sm:w-52'}`}
    >
      {visibleRoutes.map(({ id, label }) => {
        const Icon = ROUTE_ICONS[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onNavigate(id)}
            aria-current={route === id ? 'page' : undefined}
            aria-label={label}
            title={collapsed ? label : undefined}
            className={`flex items-center gap-3 rounded px-2 py-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-150 ${
              collapsed ? 'sm:justify-center' : ''
            } ${
              route === id ? 'bg-carbon text-bone' : 'text-granite hover:bg-ash/20 hover:text-stone'
            }`}
          >
            <Icon className={`h-4 w-4 ${route === id ? 'text-signal' : ''}`} />
            <span className={`truncate ${collapsed ? 'sm:hidden' : ''}`}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
