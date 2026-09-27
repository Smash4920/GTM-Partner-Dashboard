# Patterns and conventions

The dashboard favors small typed modules, one canonical data model, and presentation components that receive already-shaped values. These conventions keep a future CRM integration from leaking into the views.

## Data boundaries

Use the types in `src/data/types.ts` as the shared contract. Add a field there before using it in a view. New sources should implement `src/data/DataProvider.ts`; do not import CRM or warehouse clients into `src/views/` or `src/components/`.

`src/data/useDashboardData.ts` loads the four provider collections together and exposes `data`, `loading`, and `error`. Providers should return promises even when their current implementation is in memory, so the hook does not need a different code path for an asynchronous source.

## Derive metrics outside JSX

Put reusable calculations in `src/lib/metrics.ts`. The view modules use `useMemo` for derived arrays that depend on the selected filter or partner. Components such as `src/components/MetricBars.tsx` and `src/components/RevenueTrend.tsx` should receive display-ready rows rather than know the business rules for creating them.

Keep units explicit. A registration `amount` is a partner estimate at submission; an opportunity `amount` is a sales-sized value. `registrationFunnel` exposes both count and submitted-value fields, and `src/views/LeadershipView.tsx` lets the user choose one measure rather than mixing them.

## React and TypeScript style

- Use functional components and hooks.
- Keep component props typed at the declaration site.
- Use discriminated string unions for finite states such as `OpportunityType`, `RegistrationStatus`, and view filters.
- Prefer `const` data and pure functions for metadata and calculations.
- Use `useMemo` when a view derives a filtered or aggregated collection from a larger dataset.
- Keep side effects in hooks. The provider load and cancellation guard live in `src/data/useDashboardData.ts`.

The repository uses strict TypeScript settings in `tsconfig.app.json` and `tsconfig.node.json`, plus ESLint 9 in `eslint.config.js`. Run both lint and build before opening a pull request.

## UI conventions

The visual tokens in `tailwind.config.js` follow the Factory-inspired palette: near-black canvas, bone text, muted neutral borders, signal orange for pending/live status, and metric green for positive revenue. `src/index.css` contains only global typography and selection rules; prefer Tailwind classes for component styling.

Use `src/components/Card.tsx` for dark content panels and `src/components/LightCard.tsx` for the light queue card. Use `src/components/Badge.tsx` for statuses and partner tiers. Keep chart colors in `src/data/constants.ts` or pass them as explicit inline values when a chart library needs a color.

## Empty and error states

Reusable visual components should handle empty arrays with a short readable state. `src/components/MetricBars.tsx` displays “No data”, while `src/components/RegistrationsTable.tsx` displays a clear queue state. The app-level load error is rendered by `src/App.tsx`.

When adding an asynchronous provider, preserve the existing `loading` and `error` behavior. Do not silently replace a failed source with mock data.

## Source references

When documenting code, use paths from the repository root, such as `src/lib/metrics.ts` or `.github/workflows/ci.yml`. Keep comments focused on domain rules and non-obvious choices. The mock generator already documents why its seed, snapshot, stage distribution, and target calibration are fixed.

See [Development workflow](development-workflow.md) for the branch and pull-request cycle, and [Tooling](tooling.md) for the build configuration.
