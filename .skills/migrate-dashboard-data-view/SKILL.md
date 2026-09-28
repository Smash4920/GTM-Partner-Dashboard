---
name: migrate-dashboard-data-view
description: Migrate a GTM Partner Dashboard view from the legacy load-everything DashboardData flow to scoped aggregates and paginated DataProvider queries. Use for DataProvider contract changes, view data migrations, provider implementations, or removal of legacy list methods.
---

# Migrate a dashboard view to scoped data

Move one view at a time across the integration seam without changing its
business meaning. The result must keep payload size bounded as the provider
book grows, preserve partner data boundaries, and remain usable during slow or
failed requests.

## Establish the current behavior

1. Read `AGENTS.md`, the data contract in `README.md`, and the current status in
   `docs/migration-plan.md`.
2. Trace the target view from `src/App.tsx` through its props and components.
   Record:
   - every collection, aggregate, filter, and dimension lookup it consumes;
   - which values are scoped by quarter, manager, or partner;
   - which session edits affect each answer;
   - its loading, empty, error, retry, and pagination behavior;
   - business rules implemented in `src/lib/metrics.ts` or
     `src/data/constants.ts`.
3. Read the view's tests before editing it. Add characterization coverage first
   if a business rule or interaction is not already pinned.
4. Search for every consumer of the legacy fields and methods under change. Do
   not remove a field from `DashboardData` or a method from
   `LegacyBookProvider` while another view still uses it.

## Design a bounded contract

Add the smallest set of queries the view needs to `ScopedQueryProvider` in
`src/data/DataProvider.ts`.

- Make scope explicit. Use stable identifiers and fiscal-quarter labels rather
  than passing whole records.
- Return fixed-size aggregate DTOs for cards and charts.
- Return `Page<T>` for fact rows whose count grows with the book. Use opaque
  cursors and a caller-supplied bounded limit.
- Return small dimension dictionaries only when their size is independent of
  the fact table.
- Keep provider DTOs in `DataProvider.ts`; do not leak mock-only types through
  the seam.
- Pass relevant `SessionEdits` into the query so the provider owns the
  arithmetic. Do not fetch an aggregate and reapply edits in the view.
- Never reintroduce raw weekly pipeline snapshots. Weekly history may cross the
  seam only as bounded buckets such as `getWeeklyForecastSeries()`.
- Prefer rejecting an unsupported scope to returning a plausible but incorrect
  number.

For each new method:

1. Add it to `METHOD_INDEX`, which is keyed by `keyof DataProvider`.
2. Add its wire or box to `src/data/connections.ts`.
3. Keep `CONNECTION_METHOD_COVERAGE` complete so
   `src/data/connections.test.ts` continues to prove the diagram matches the
   contract.

## Implement providers behind the seam

1. Put reusable business calculations in `src/lib/metrics.ts` or a focused pure
   helper. Treat these calculations as the specification a future server must
   match.
2. Implement the query in `src/data/mock/MockDataProvider.ts` by delegating to
   those calculations. Filter before aggregating or paging.
3. Update every provider and wrapper affected by the contract, including
   simulated latency and failure dispatch.
4. Keep mock output deterministic:
   - use `SNAPSHOT_DATE` for reporting calculations;
   - prefer identifier-derived variation over sequence-dependent randomness;
   - preserve the February-start fiscal calendar;
   - keep registration SLAs in business days and exclusivity in calendar days.
5. Validate pages as a complete sequence, not only the first page. Assert stable
   ordering, no duplicate or missing rows, accurate `totalCount`, and no
   `nextCursor` on the final page.
6. Validate scoped and edit-aware results against the pure calculation,
   including zero-data and invalid-scope cases.

## Build the query hook

Create a focused hook under `src/data/` rather than fetching in the view.

- Give independently useful widgets independent data or failure state.
- Distinguish the initial load from a refresh and keep the previous valid answer
  visible while edits trigger a replacement request.
- Prevent stale responses from overwriting newer ones with a cleanup or a
  monotonically increasing request identifier.
- Make effect dependencies the primitive values and edit maps the request
  needs, never a scope object rebuilt during render.
- Reset paginated state when the scope changes and make load-more failures
  retryable without discarding rows already shown.

## Migrate the view

1. Replace only the target view's legacy `DashboardData` reads with the new
   hook state.
2. Keep session-only writes in `src/App.tsx`; do not imply persistence or add
   browser storage.
3. Preserve accessible labels, native controls, responsive behavior, and
   Tailwind design tokens.
4. For Partner View, test that Sell To opportunities, conflicting
   registrations, and other partners' records cannot appear.
5. Remove a legacy prop, field, method, or loader call only after a repository
   search proves it has no remaining consumer.

## Prove the migration

Run a focused test while iterating, then run the repository checks in CI order:

```bash
npm run agents:check
npm run check:file-limits
npm run format:check
npm run test:debt
npm run debt:check
npm run lint
npm run dead-code
npm run lint:duplicates
npm run docs:check
npm run test:coverage
npm run test:e2e
npm run bundle:check
```

In the final summary, name the legacy calls removed, the new bounded query
shapes, the scope and edit semantics preserved, and the exact checks run.
