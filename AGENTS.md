# GTM Partner Dashboard — agent notes

Mockup of a partner revenue pipeline dashboard. React 18 + TypeScript + Vite +
Tailwind + Recharts. Deterministic mock data, no backend.

## Commands

```bash
npm run dev      # http://localhost:5173
npm run lint     # eslint
npm test         # vitest
npm run build    # tsc -b && vite build
```

CI (`.github/workflows/ci.yml`) runs lint + test + build on every PR and on
pushes to `main`. All three must pass.

## Architecture

- **`src/data/DataProvider.ts` is the integration seam.** The UI only ever talks
  to this interface. `MockDataProvider` fills it today; a CRM-backed provider
  fills it tomorrow with no view changes. Do not reach around it.
- **`src/lib/metrics.ts`** holds every business rule and aggregation.
  **`src/lib/fiscal.ts`** holds the fiscal calendar and business-day math,
  shared by the metrics layer and the mock generator so the two cannot drift.
- **`src/App.tsx`** layers session-only edits (revenue overrides, forecast
  calls, notes, next steps, meeting classifications, roster changes,
  notifications) on top of the provider's book and hands one merged
  `DashboardData` to every view. The provider interface is read-only; writes are
  the gap a live provider still has to close.
- **`src/data/connections.ts`** is the catalog behind the Data Connections wire
  diagram. `connections.test.ts` asserts every `DataProvider` method appears
  somewhere on the map, so **changing the contract requires updating both.**

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

Reviewed 2026-09-26. Full findings and the staged production plan live in
[`docs/migration-plan.md`](docs/migration-plan.md). Key facts:

- Test coverage was **27.88%** overall at review time, with **0% across all
  eight views, all components, `App.tsx`, and `useDashboardData`**.
- The current design loads the entire ecosystem into the browser. Weekly
  pipeline snapshots are ~87% of the payload at production volume, so
  `listPipelineSnapshots()` is the collection that can never ship whole.
- Phases 0 (test infrastructure) and 1 (reshape `DataProvider` to a
  scope/page/aggregate contract) are done **in demo mode against the mock** and
  require no infrastructure. Everything after them depends on them.

## Writing style

Documentation and code comments in this repo explain *why*, not *what*. Comments
justify a non-obvious constraint, invariant, or rule; they do not narrate the
code. Match that density rather than adding or stripping comments wholesale.
