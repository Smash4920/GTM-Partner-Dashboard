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
