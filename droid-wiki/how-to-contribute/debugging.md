# Debugging

The app is a small static frontend: `index.html` loads `src/main.tsx`, which mounts `src/App.tsx` inside React StrictMode inside an error boundary. There is no server and no API, so instrumentation is the structured logger in `src/lib/logging.ts` — one record per event, written to the browser console — and debugging means those records plus DevTools. This page covers the logging surface, the loading and error paths, the common base-path failure, provider and data issues, chart rendering, and the commands that exist.

## Loading and error paths

All data loads through `src/data/useDashboardData.ts`, which calls the four `DataProvider` methods with `Promise.all` and exposes `{ data, loading, error }`. `src/App.tsx` renders an error banner when `error` is set, a "Loading dashboard data" pulse while `loading` is true, and the selected view only when `data` is present.

The mock provider never rejects, so to see the error path you would temporarily `throw` inside a provider method. A real CRM-backed provider would surface its failures here: the catch branch sets `error` to the rejection message (or `Failed to load dashboard data` for non-`Error` rejections) and flips `loading` to false while leaving `data` null. The `alive` flag prevents state updates after unmount, which also makes the React 18 StrictMode double-invocation of effects in dev mode harmless. If a load unexpectedly re-runs, the cause is a new provider instance: the effect in `src/data/useDashboardData.ts` only re-runs when the provider reference changes, and `src/App.tsx` stabilizes it with `useMemo(() => new MockDataProvider(), [])`.

The load is also the main thing that is logged: `Loading dashboard data` at debug when the fetch starts, `Dashboard data loaded` at info with a count per collection and the elapsed milliseconds when it lands, and `Failed to load dashboard data` at error with the rejection serialized under `error` when it does not. If a result arrives after unmount, the hook discards it with a debug record saying so — that is the React 18 StrictMode double-invoke in development working as intended, not a bug to chase.

## Structured logging

`src/lib/logging.ts` is the instrumentation surface. Every event is one flat record — `time`, `level`, `msg`, plus context fields — instead of a string with values interpolated into it, so the console sidebar filters by level and any future sink can read fields without parsing prose.

- Levels are `debug`, `info`, `warn`, `error`. The minimum comes from `VITE_LOG_LEVEL` when it is one of those, else `debug` in development and `warn` in production builds; Vite inlines it at build time, so a preview server does not re-read the environment.
- `logger` is the app-wide instance; `logger.child({ component: '...' })` carries those fields on every record. The data hook logs with `component: useDashboardData`, session actions in `App.tsx` with `component: App`, render crashes with `component: ErrorBoundary`.
- `Error` values are serialized to `name`, `message`, and `stack` (a raw `Error` does not survive `JSON.stringify`); dates become ISO strings; undefined fields are dropped; circular or arbitrarily deep values are cut off rather than thrown on.
- The default sink writes each record to the console method matching its level. `createLogger({ sink })` accepts any `(record) => void` function — the unit tests in `src/lib/logging.test.ts` capture records that way, and a collector endpoint would attach the same way.
- `src/components/ErrorBoundary.tsx` wraps the app and logs render crashes at error level with the component stack, so a blank page leaves a record behind.

When instrumenting, log identifiers and counts — ids, categories, amounts, collection sizes — not user prose. Opportunity notes and next steps are deliberately not logged.

## Provider and data issues

- The source swap point is `src/App.tsx`; `MockDataProvider` is instantiated there and passed to the hook.
- The generator's tunables are the constants at the top of `src/data/mock/generate.ts`: `TIER_ACTIVITY`, `TIER_TARGET_BASE`, `REGISTRATION_COUNT`, `QUARTER_WEIGHTS`, `OPEN_STAGE_WEIGHTS`, `LOST_STAGE_WEIGHTS`, `AMOUNT_RANGES`, and `EXTRA_COUNTS`.
- The snapshot date exists in two places that must agree: `SNAPSHOT_DATE` in `src/data/constants.ts` and the local `SNAPSHOT` constant in `src/data/mock/generate.ts`. Moving the snapshot means updating both; [Data provider](../systems/data-provider.md) calls this out.
- Referential integrity: collections link through `partnerId`, `registration.convertedTo`, and `opportunity.registrationId`. A key typo shows up as orphaned rows or missing conversions.
- `MockDataProvider` returns the same array references on every call, and the views treat records as read-only. Mutating a record inside a view or component would corrupt every panel that reads the same array.

## Base-path issues (blank page or missing assets)

`vite.config.ts` picks the asset base from the environment: `/` when `VERCEL` is set, `/GTM-Partner-Dashboard/` otherwise, with `BASE_PATH` overriding both. A build made for one host breaks on another:

- The current `dist/` (built without `VERCEL`) references `/GTM-Partner-Dashboard/assets/...` in `dist/index.html`. Served at a domain root, those asset requests 404 and the app is blank.
- `npm run preview` respects the configured base: for a default build it redirects `/` to `/GTM-Partner-Dashboard/`, which is the URL to open when verifying a Pages-style build locally.
- To build for another host: `VERCEL=1 npm run build` or `BASE_PATH=/preview/ npm run build`. Getting started covers the base path table.

The indicator to check first when the page renders HTML but no app is the asset URLs in `dist/index.html` and the browser network panel.

## Chart rendering

`src/components/RevenueTrend.tsx` renders a Recharts `ComposedChart` (bar plus line) inside a `ResponsiveContainer`, which needs a parent with a defined height — the wrapper div carries the fixed `h-72 w-full` class. If the chart is missing, collapsed, or zero-height, check that the wrapper still has a height. `isAnimationActive={false}` on the bar and line makes the chart render fully on first paint, which keeps static captures stable; if you see a blank chart area with correct data, the animation flag or parent sizing is the first thing to inspect.

## Useful commands

```bash
npm run dev        # Vite dev server, normally http://localhost:5173
npm run lint       # ESLint flat config
npm test           # Vitest unit suite, run once
npm run test:e2e   # Playwright browser suite
npm run build      # tsc -b && vite build
npm run preview    # serve dist/; respects the configured base path
```

There is no watch-mode type-checking script; `tsc -b` runs as part of `npm run build`.

## What does not exist

There is no error-tracking integration, no analytics, and no server-side log collection: the structured logger writes to the browser console and nothing ships records anywhere. DevTools — console (with its level filter), network, React DevTools if installed — is where those records are read.

## Related pages

- [How to contribute](index.md) — where debugging fits in the contribution loop.
- [Data provider](../systems/data-provider.md) — the provider, generator, and snapshot details.
- [Getting started](../overview/getting-started.md) — running the app and building with different base paths.
- [Tooling](tooling.md) — what each tool in the stack does.
