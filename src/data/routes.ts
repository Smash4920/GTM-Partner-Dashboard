/** Closed route inventory shared by the shell and browser validation. */
export const ROUTES = [
  { id: 'home', label: 'Home' },
  { id: 'partners', label: 'Partner Performance' },
  { id: 'forecasting', label: 'Forecasting' },
  { id: 'action-center', label: 'Action Center' },
  { id: 'registration-ops', label: 'Deal Reg Ops' },
  { id: 'activity', label: 'Activity Tracking' },
  { id: 'partner-view', label: 'Partner View' },
  { id: 'production-requirements', label: 'Production Requirements' },
  { id: 'data-connections', label: 'Data Connections' },
] as const;

export type Route = (typeof ROUTES)[number]['id'];

export function routeLabel(route: Route): string {
  return ROUTES.find(({ id }) => id === route)!.label;
}
