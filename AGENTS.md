# GTM Partner Dashboard — agent notes

Mockup of a partner revenue pipeline dashboard. React 18 + TypeScript + Vite +
Tailwind + Recharts. Deterministic mock data, no backend.

## Commands

```bash
npm run dev             # http://localhost:5173
npm run lint            # eslint
npm test                # vitest run
npm run test:watch      # vitest, watch mode
npm run test:coverage   # vitest run --coverage, enforces the thresholds in vite.config.ts
npm run build           # tsc -b && vite build
```

CI (`.github/workflows/ci.yml`) runs lint + `test:coverage` + build on every PR
and on pushes to `main`. All three must pass. The coverage thresholds are a
ratchet: raise them as coverage lands, never lower them to make a red build
green.

## Architecture

- **`src/data/DataProvider.ts` is the integration seam.** The UI only ever talks
  to this interface. Do not reach around it.
  - It is mid-migration and reads that way: `ScopedQueryProvider` is the target
    shape (a scope in, an aggregate or one page of rows out), `LegacyBookProvider`
    is the eight list-everything calls still being retired. Forecasting reads
    only the scoped side.
  - `DATA_PROVIDER_METHODS` is keyed by `keyof DataProvider`, so **adding a
    method to the contract is a compile error until it is listed there**, and
    `connections.test.ts` then fails until the method has a wire or a box on the
    Data Connections map. Update both in the same change.
- **`src/lib/metrics.ts`** holds every business rule and aggregation, and is now
  the *specification* a server implementation has to match; its test suite plus
  `MockDataProvider.test.ts` are the conformance check. **`src/lib/fiscal.ts`**
  holds the fiscal calendar and business-day math, shared by the metrics layer
  and the mock generator so the two cannot drift.
- **`src/data/types.ts`**: `DashboardData` is what the client receives;
  `ProviderBook` extends it with `snapshots`, which never crosses the seam whole
  and leaves only through `getWeeklyForecastSeries()`.
- **`src/data/mock/`** holds the providers: `MockDataProvider` (deterministic
  book, scoped answers computed behind the seam), `SimulatedRemoteProvider`
  (delegating wrapper adding latency and injected failures), `ScaleDataProvider`
  (100× the book). **`src/data/providers.ts`** selects between them — the
  header's provider dropdown is that selector, and it is the demo of the seam.
- **`src/data/useForecastQueries.ts`** fetches the scoped contract for the
  Forecasting view. Effects depend on the *values* a query needs (quarter,
  manager, each edit map), never on the scope object, which is rebuilt every
  render and would loop.
- **`src/App.tsx`** layers session-only edits (revenue overrides, forecast
  calls, notes, next steps, meeting classifications, roster changes,
  notifications) on top of the provider's book and hands one merged
  `DashboardData` to the views still on the old contract. Forecasting instead
  passes the edits *into* its queries, so the provider aggregates the corrected
  book. Both paths exist only until the remaining views migrate.
- **`src/data/connections.ts`** is the catalog behind the Data Connections wire
  diagram.

## Conventions

- Fiscal year starts in February. FY27 = Feb 2026 – Jan 2027.
- **All date math is UTC.** `fiscal.ts` uses only `Date.UTC` / `getUTC*`, and
  `format.ts` renders with `timeZone: 'UTC'`. Never introduce local-time `Date`
  methods; no current test would catch it.
- Mock data is deterministic: mulberry32, seed `20260918`, fixed
  `SNAPSHOT_DATE` of 2026-09-18. `generateDashboardData()` reseeds on every
  call. Do not introduce `Date.now()` or `Math.random()` into `src/data`.
- Business days are weekdays; holidays are not modeled yet. `isBusinessDay` in
  `fiscal.ts` is deliberately the single place to teach them.
- Brand system: near-black canvas (#101010), bone type (#EEEEEE), Geist /
  Geist Mono, 1px hairline borders, no shadows. Two accents only: signal orange
  for live status, metric green for positive data.
- Guard every division before it reaches `formatPct`. `Intl.NumberFormat`
  happily renders `Infinity` as "∞%".

## Known state

Reviewed 2026-09-26, Phases 0 and 1 landed 2026-09-27. Full findings and the
staged plan live in [`docs/migration-plan.md`](docs/migration-plan.md). Key
facts:

- Test coverage was **27.88%** at review time, with **0% across all eight views,
  all components, `App.tsx`, and `useDashboardData`**. It is now **91.72%
  statements / 86.74% branches over 202 tests in 17 files**, gated in CI.
- The design still loads most of the ecosystem into the browser. Weekly pipeline
  snapshots were ~87% of the payload at production volume; that collection is
  **off the client contract entirely** and leaves as a 13-bucket series.
- **Forecasting is the only view on the scoped contract.** The other seven still
  take the whole book through `useDashboardData`. Migrating each is now a
  template exercise: add the queries the view needs to `ScopedQueryProvider`,
  implement them in `MockDataProvider` by delegating to `metrics.ts`, wire the
  map, then move the view onto a hook.
- Provider switching is a demo affordance, not a product feature: `Scaled 100×`
  builds 191,000 snapshot rows (~83 ms, ~45 MB) on selection, and the legacy
  views aggregate all of it in the tab. That is the point being demonstrated,
  but it is why the default is `Local mock`.

## Writing style

Documentation and code comments in this repo explain *why*, not *what*. Comments
justify a non-obvious constraint, invariant, or rule; they do not narrate the
code. Match that density rather than adding or stripping comments wholesale.
# AGENTS.md

This file applies to the entire repository. It gives autonomous contributors
the project-specific context needed to make safe, reviewable changes.

## Project overview

GTM Partner Dashboard is a client-only React and TypeScript dashboard built
with Vite and Tailwind CSS. It currently uses deterministic mock data. There is
no backend, database, authentication layer, or required local environment file.
Read `README.md` for the product behavior and data contract before changing
business logic.

## Setup

- Use Node.js 22.13 or newer. CI runs Node.js 22 and `package.json` enforces the
  minimum supported version.
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
npm run lint      # lint all TypeScript and TSX files
npm test          # run the Vitest suite once
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
npm run lint
npm test
npm run test:e2e
npm run build
```

## Repository map

- `src/App.tsx`: application shell, route selection, provider wiring, and
  session-only edits that are layered over provider data.
- `src/views/`: page-level dashboard views. Keep cross-view business rules out
  of these files when they can be expressed as reusable helpers.
- `src/components/`: reusable UI and domain components.
- `src/lib/`: pure formatting, fiscal-calendar, structured logging,
  notification, and metric helpers. Unit tests are colocated as `*.test.ts`.
- `src/data/types.ts`: shared domain types and the `DashboardData` shape.
- `src/data/constants.ts`: fiscal dates, service levels, labels, and other
  shared domain constants.
- `src/data/DataProvider.ts`: the read-side integration boundary used by the UI.
- `src/data/useDashboardData.ts`: loads and combines every provider collection.
- `src/data/mock/`: seeded data generation and the current provider
  implementation. Its tests pin referential integrity and documented volumes.
- `src/data/connections.ts`: catalog behind the Data Connections view.
- `src/index.css` and `tailwind.config.js`: global styles and design tokens.
- `.github/workflows/ci.yml`: required pull-request checks.

## Architecture and data rules

- Views consume the merged `DashboardData` passed down from `App.tsx`; they
  must not import mock records directly.
- Keep source-system reads behind `DataProvider`. When adding a provider method,
  update the interface, `DashboardData`, `useDashboardData`, the mock provider,
  the connection catalog, and the connection coverage test together.
- User edits currently live in React state in `App.tsx`. Do not imply that an
  edit persists or add browser storage unless persistence is part of the task.
- Mock data is reproducible with a fixed seed and `SNAPSHOT_DATE`. Use the
  snapshot for business reporting calculations instead of the wall clock.
  Runtime action timestamps, such as a notification sent by the user, may use
  the real current time.
- Preserve the February-start fiscal calendar and the distinction between
  open-pipeline dates, close dates, and append-only weekly snapshots.
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
  commas in multiline structures, and two-space indentation.
- Add comments for business invariants and non-obvious time or data semantics,
  not for self-evident JSX.
- Log through `src/lib/logging.ts`, not raw `console` calls: one structured
  record per event — `log.info('msg', { fields })` — with
  `logger.child({ component: '...' })` for shared context. Log identifiers
  and counts, not user prose.
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
