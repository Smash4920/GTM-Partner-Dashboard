# AGENTS.md

This file applies to the entire repository. It gives autonomous contributors
the project-specific context needed to make safe, reviewable changes.

## Project overview

GTM Partner Dashboard is a client-only React and TypeScript dashboard built
with Vite and Tailwind CSS. It currently uses deterministic mock data. There is
no backend, database, authentication layer, or required local environment file.
Read `README.md` for the product behavior and data contract before changing
business logic, and `docs/migration-plan.md` for how the data layer is being
moved to production volume.

## Setup

- Use Node.js 22.13 through 24. CI runs Node.js 22 and `package.json`
  (`engines.node`) enforces the supported range.
- Use npm and keep `package-lock.json` in sync with `package.json`.
- Install exactly the locked dependencies with:

  ```bash
  npm ci
  ```

- Do not commit `node_modules/`, `dist/`, `*.tsbuildinfo`, `.factory/`, or
  generated wiki video files. These are ignored intentionally.

## Commands

Run commands from the repository root.

```bash
npm run dev       # start the Vite development server
npm run format    # format source, configuration, and documentation
npm run format:check # verify formatting without changing files
npm run lint      # lint TypeScript/TSX and enforce module boundaries
npm run debt:check # require source debt markers to link to GitHub issues
npm run lint      # lint all TypeScript and TSX files
npm run lint:duplicates # detect source duplication with jscpd
npm test          # run the Vitest suite once
npm run test:debt # test the technical-debt policy scanner
npm run test:coverage # run Vitest with coverage, enforcing the thresholds in vite.config.ts
npm run test:e2e  # run the Playwright browser suite
npm run test:list # collect and list tests without running them
npm run build     # run TypeScript project checks, then create dist/
npm run preview   # serve the production build locally
```

To run one test file while iterating:

```bash
npm test -- src/lib/metrics.test.ts
```

Before handing off a change, run the same checks as CI, in this order:

```bash
npm run format:check
npm run test:debt
npm run debt:check
npm run lint
npm run lint:duplicates
npm run test:coverage
npm run test:e2e
npm run build
```

The coverage thresholds are a ratchet: raise them as coverage lands, never
lower them to make a red build green. The view layer sat at 0% before Phase 0
of `docs/migration-plan.md`, which is how a 5,700-line refactor came to look
survivable.

## Repository map

- `src/App.tsx`: application shell, route selection, provider wiring, and
  session-only edits that are layered over provider data.
- `src/views/`: page-level dashboard views. Keep cross-view business rules out
  of these files when they can be expressed as reusable helpers.
- `src/components/`: reusable UI and domain components.
- `src/lib/`: pure formatting, fiscal-calendar, structured logging,
  notification, and metric helpers. Unit tests are colocated as `*.test.ts`.
- `src/data/types.ts`: shared domain types, the `DashboardData` shape the client
  receives, and `ProviderBook`, which extends it with the provider-only history.
- `src/data/constants.ts`: fiscal dates, service levels, labels, and other
  shared domain constants.
- `src/data/DataProvider.ts`: the read-side integration boundary used by the UI.
  It is mid-migration between two interfaces; see below.
- `src/data/useDashboardData.ts`: loads and combines every provider collection
  the seven un-migrated views still need.
- `src/data/useForecastQueries.ts`: loads the scoped contract for Forecasting,
  with per-widget loading and error state.
- `src/data/providers.ts`: selects between the three providers the header's
  provider dropdown exposes.
- `src/data/mock/`: seeded data generation and the provider implementations —
  `MockDataProvider`, `SimulatedRemoteProvider`, and `ScaleDataProvider`. Its
  tests pin referential integrity and documented volumes.
- `src/data/connections.ts`: catalog behind the Data Connections view.
- `src/index.css` and `tailwind.config.js`: global styles and design tokens.
- `.github/workflows/ci.yml`: required pull-request checks.

## Architecture and data rules

- ESLint enforces the dependency direction declared in `eslint.config.js`:
  app shell → views → components → data/domain helpers. Providers are isolated
  under `src/data/mock/`, and production views and components cannot import
  them directly. Tests may cross these boundaries to build fixtures.
- Views consume the merged `DashboardData` passed down from `App.tsx`; they
  must not import mock records directly. The one exception is Forecasting,
  which reads the scoped contract through `useForecastQueries.ts` and passes
  the session's edits _into_ its queries rather than receiving the folded book.
- **`DataProvider` is two interfaces, deliberately.** `ScopedQueryProvider` is
  the target shape — a scope in, an aggregate whose size does not depend on the
  book or one page of rows out. `LegacyBookProvider` is the eight
  list-everything calls still being retired. Forecasting reads only the scoped
  side. When a view moves across, add the queries it needs to the scoped
  interface, implement them in `MockDataProvider` by delegating to
  `src/lib/metrics.ts`, and migrate the view onto a hook.
- When adding a method to `DataProvider`, list it in `DATA_PROVIDER_METHODS`
  (a compile error until you do, because the record is keyed by
  `keyof DataProvider`) and give it a wire or a box in `connections.ts`;
  `connections.test.ts` fails until both are done, by design.
- **Weekly pipeline history never crosses the seam whole.** It is ~87% of the
  payload at production volume, so `listPipelineSnapshots()` is gone from the
  client contract and history leaves only through `getWeeklyForecastSeries()` as
  a handful of buckets. `ProviderBook` holds the snapshot rows; `DashboardData`
  does not.
- `src/lib/metrics.ts` is the _specification_ a server implementation has to
  match, not just the current implementation. Its suite plus
  `MockDataProvider.test.ts` are the conformance check.
- User edits currently live in React state in `App.tsx`. Do not imply that an
  edit persists or add browser storage unless persistence is part of the task.
- Mock data is reproducible with a fixed seed and `SNAPSHOT_DATE`. Use the
  snapshot for business reporting calculations instead of the wall clock.
  Runtime action timestamps, such as a notification sent by the user, may use
  the real current time.
- Preserve the February-start fiscal calendar and the distinction between
  open-pipeline dates, close dates, and append-only weekly snapshots. A quarter
  label bridges to the phase-scoped windows through `phaseForQuarter()`, which
  throws rather than falling back — a plausible wrong number is worse than a
  crash.
- Treat five-day registration SLAs as business days and the 60-day exclusivity
  period as calendar days.
- Keep partner-facing data boundaries intact. Partner View must not expose
  Sell To opportunities, conflicting registrations, or another partner's data.
- Seeded generator changes can shift many fixtures. Prefer stable,
  identifier-derived variation for targeted scenarios. If an intentional
  generator change alters pinned volumes or product claims, update the tests
  and `README.md` in the same change.

## Code conventions

- TypeScript is strict. Do not use `any`, suppress compiler errors, or weaken
  the settings in `tsconfig.app.json`.
- Use ESM imports, function components, React hooks, and explicit `import type`
  declarations, matching surrounding code.
- Use `camelCase` for variables, functions, parameters, and object members;
  `PascalCase` for React components and TypeScript types; and
  `UPPER_SNAKE_CASE` for module-level constants that represent fixed values.
  Fixed configuration or environment keys may also use `UPPER_SNAKE_CASE`,
  while quoted object keys may follow an external or domain-defined format.
  ESLint enforces these identifier conventions through `npm run lint`.
- Keep derived calculations pure and centralized in `src/lib/metrics.ts` or a
  focused helper rather than duplicating formulas across views.
- Reuse types, labels, thresholds, and metadata from `src/data/types.ts` and
  `src/data/constants.ts`. Avoid parallel string literals for domain values.
- Preserve the existing formatting style: single quotes, semicolons, trailing
  commas in multiline structures, and two-space indentation. Prettier owns the
  line wrapping — run `npm run format` rather than hand-wrapping to taste.
- Add comments for business invariants and non-obvious time or data semantics,
  not for self-evident JSX.
- Link intentional debt markers to an issue in this repository and explain the
  removal condition, for example `TODO(#123): remove after the provider cutover`.
  `npm run debt:check` enforces this in CI.
- Log through `src/lib/logging.ts`, not raw `console` calls: one structured
  record per event — `log.info('msg', { fields })` — with
  `logger.child({ component: '...' })` for shared context. Log identifiers
  and counts, not user prose.
- A data-fetching hook's effect must depend on the _values_ a query needs
  (a quarter, a manager, each edit map), never on a scope object rebuilt every
  render, which would refetch in a loop.
- Preserve accessible labels and native controls when changing interactions.

## Visual conventions

- Use the Tailwind tokens in `tailwind.config.js`, not near-match hard-coded
  colors. The UI uses a near-black canvas, bone text, graphite neutrals, signal
  orange for attention, and metric green for positive states.
- Reserve color for data state. Keep surfaces flat, use one-pixel borders, and
  do not introduce shadows or a new accent palette.
- Use Geist Sans for interface text and Geist Mono for compact labels and
  numeric instrumentation.
- Check responsive behavior when changing layouts. The sidebar and dense
  tables must remain usable at narrow widths.

## Tests and pull requests

- Add or update Vitest coverage for changed business logic, data contracts,
  fiscal calculations, and deterministic mock-data invariants.
- Keep tests deterministic. Do not depend on the local timezone, current date,
  network access, or test execution order.
- Do not edit `dist/` by hand. A successful build regenerates it for local
  inspection, but build output is not source.
- Keep pull requests focused. Summarize user-visible behavior, call out data
  contract changes, and report the exact lint, test, and build commands run.
- Vercel creates pull-request previews. GitHub Pages deployment is manual; do
  not trigger or modify deployment workflows unless the task requires it.
