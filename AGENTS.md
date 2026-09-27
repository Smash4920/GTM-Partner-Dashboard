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
npm run lint      # lint all TypeScript and TSX files
npm test          # run the Vitest suite once
npm run test:e2e  # run the Playwright browser suite
npm run build     # run TypeScript project checks, then create dist/
npm run preview   # serve the production build locally
```

To run one test file while iterating:

```bash
npm test -- src/lib/metrics.test.ts
```

Before handing off a change, run the same checks as CI, in this order:

```bash
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
- `src/lib/`: pure formatting, fiscal-calendar, notification, and metric
  helpers. Unit tests are colocated as `*.test.ts`.
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
- Keep derived calculations pure and centralized in `src/lib/metrics.ts` or a
  focused helper rather than duplicating formulas across views.
- Reuse types, labels, thresholds, and metadata from `src/data/types.ts` and
  `src/data/constants.ts`. Avoid parallel string literals for domain values.
- Preserve the existing formatting style: single quotes, semicolons, trailing
  commas in multiline structures, and two-space indentation.
- Add comments for business invariants and non-obvious time or data semantics,
  not for self-evident JSX.
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
