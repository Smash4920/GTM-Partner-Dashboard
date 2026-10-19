/**
 * The Settings route's tabs.
 *
 * These live in the data layer rather than in `SettingsView` because the
 * shell and the view both need them: the shell owns which tab is selected,
 * and it renders the Action Center panel itself so that panel can outlive
 * the route (see `RouteContent` in `src/App.tsx`). Importing a value from the
 * lazily loaded view would pull the whole view into the entry chunk, so the
 * shared names sit here instead.
 */

/** The Settings route's tabs, in tab order. */
export const SETTINGS_TABS = [
  { id: 'general', label: 'General Settings' },
  { id: 'action-center', label: 'Action Center' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

/**
 * The tab/panel id pairs, so the tablist and the panel agree on the wiring
 * even though different components render them.
 */
export const SETTINGS_TAB_IDS: Record<SettingsTab, { tab: string; panel: string }> = {
  general: { tab: 'settings-tab-general', panel: 'settings-panel-general' },
  'action-center': { tab: 'settings-tab-action-center', panel: 'settings-panel-action-center' },
};
