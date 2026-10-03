import type { ActionItem } from './types';

const DESTINATIONS = {
  opportunity: { route: 'forecasting', label: 'Open Forecasting context' },
  registration: { route: 'registration-ops', label: 'Open Deal Reg Ops context' },
  partner: { route: 'partners', label: 'Open partner context' },
} as const;

export function actionDestination(item: ActionItem) {
  const destination = DESTINATIONS[item.entityKind];
  return {
    ...destination,
    href: `#${destination.route}/${encodeURIComponent(item.entityId)}`,
  };
}
