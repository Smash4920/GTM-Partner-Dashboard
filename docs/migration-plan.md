# Production migration plan

How this dashboard gets from a deterministic, client-only mock to a system
serving real partner data at production volume. The _what_ is already
enumerated in the
[Production Requirements](../src/views/ProductionRequirementsView.tsx)
architecture roadmap — in particular "serve aggregated, paginated API responses
rather than loading the entire ecosystem into the browser". This document is
the _how_: where the current design breaks, the one contract change everything
else follows from, and the order the work has to happen in.

Every item on that board — the architecture roadmap, the migration path, and
the utility backlog — carries a Demo status stamped against verified client
behavior (Complete, WIP, or Pending) and, wherever a production dependency is
intentionally paused, a separate Production: Prod Only status naming the exact
blocker, together with the date the statuses were last reviewed. Demo
completion never completes a production dependency. This document is the
reasoning underneath those statuses, not a duplicate of them.

The production continuation runs in a fixed order: trusted identity first,
then the warehouse and scoped API with row-level authorization, then source
ingestion, then persisted writes and audit, then production operations. The
phases below follow that order, and no phase may be pulled ahead of identity
and server-side row enforcement.

## Where the current design breaks

Every view today reads a single in-memory `DashboardData` containing the entire
ecosystem. `useDashboardData` fetches nine collections in one `Promise.all` and
`src/lib/metrics.ts` aggregates them in the browser on every render. That is the
right shape for a deterministic demo and it does not survive contact with real
volume.

Extrapolating from measured object sizes (~600 B per `Opportunity`, ~250 B per
`PipelineSnapshot`), retaining three years of history:

| Tier         | Partners | Open book | Opps (3 yr) | Snapshot rows (3 yr) | Parsed in browser | Verdict                |
| ------------ | -------- | --------- | ----------- | -------------------- | ----------------- | ---------------------- |
| Today (mock) | 25       | ~58       | 213         | 1.9 k                | ~1 MB             | Fine                   |
| Small team   | 100      | 400       | 3 k         | 62 k                 | ~20 MB            | Works, slow first load |
| Mid-market   | 500      | 3,000     | 25 k        | 470 k                | ~150 MB           | Degraded to unusable   |
| Enterprise   | 2,000    | 15,000    | 150 k       | 2.3 M                | ~800 MB           | Tab dies               |

Order-of-magnitude figures, but the shape is the point: **weekly pipeline
snapshots are 87–89% of the payload at every tier above the mock.**
`listPipelineSnapshots()` is the one collection that can never ship whole, and
it is also the one that makes week-over-week movement and forecast accuracy
measurable at all. It cannot be dropped, so it has to be aggregated server-side.

Three independent walls, in the order they are reached:

1. **~100 partners.** One `Promise.all` delivers ~20 MB in a single burst.
   Annoying, survivable.
2. **~500 partners.** Parse peak roughly doubles the ~150 MB resident set. At
   the same time `partnerLeaderboard` (`src/lib/metrics.ts`) runs
   `opps.filter(...)` inside `partners.map(...)`, so a filter toggle costs
   500 × 25,000 = 12.5 M operations on the main thread. Limping.
3. **~2,000 partners.** Out of memory. Not a tuning problem.

Walls 1 and 2 are independent — fixing the O(n·m) scans does nothing about
memory, and vice versa. Both need the same underlying change.

## The change everything else follows from

**The server ships answers, not books.**

Today `metrics.ts` is the implementation: ~1,100 lines of aggregation running in
the browser over the full dataset. In production it becomes the _specification_
a server implementation must match.

That reframing is more tractable than it sounds, because the aggregate return
types already exist as exported interfaces: `RegistrationFunnel`, `StageRow`,
`TypeRow`, `WeightedForecast`, `WeeklyForecastRow`, `LeaderboardRow`,
`RegistrationConversionTimes`, `QuarterRevenueRow`. The DTOs are designed. The
work is moving the function bodies behind the seam and keeping the return types.

The contract becomes two families — aggregates that return kilobytes, and row
lists that paginate. As shipped in Phase 1:

```ts
interface ForecastScope {
  quarter: string; // 'FY27-Q3'
  partnerManagerId?: string; // everything except the weekly series
  edits?: SessionEdits; // this session's uncommitted corrections
}
interface PageRequest {
  cursor?: string;
  limit: number;
}
interface Page<T> {
  rows: T[];
  nextCursor?: string;
  totalCount: number;
}

interface ScopedQueryProvider {
  // Aggregates: computed behind the seam, returned small.
  getForecastSummary(scope: ForecastScope): Promise<ForecastSummary>;
  getWeightedForecast(scope: ForecastScope): Promise<WeightedForecastSummary>;
  getForecastQuality(scope: ForecastScope, sampleSize: number): Promise<ForecastQualitySummary>;
  getManagerForecastGroups(scope: ForecastScope): Promise<ManagerForecastGroup[]>;
  getWeeklyForecastSeries(scope: ForecastScope): Promise<WeeklySeriesRow[]>;

  // Rows: cursor-paginated, server-sorted, server-filtered.
  listQuarterOpportunities(scope: ForecastScope, page: PageRequest): Promise<Page<Opportunity>>;
  getPartnerDirectory(): Promise<PartnerRef[]>;
}
```

The scope is a quarter rather than a fiscal phase, because a quarter is the unit
a caller thinks in and `phaseForQuarter()` in `metrics.ts` bridges to the
phase-scoped windows. The aggregate DTOs are deliberately declared in
`DataProvider.ts` rather than imported from `metrics.ts`: the seam stays
self-contained and liftable, and `MockDataProvider`'s delegations are what
check the two shapes against each other at compile time.

Two design points worth naming, because both were discovered by writing the
tests rather than by thinking about it:

- **`partnerManagerId` narrows everything except the weekly series.** A snapshot
  row records an amount, a call, and an expected close, but not whose book the
  deal was in. Filtering the live weeks by manager while the recorded weeks kept
  everyone's deals would draw a cliff into the chart that never happened, so the
  series stays quarter-level and the contract says so.
- **Aggregates are scoped, and the Forecasting view asks unscoped.** Its tiles
  are statements about the quarter, so it passes a quarter-only scope to the
  aggregate hook and a manager scope to the row list. The filtering is the
  caller's decision, not a hidden property of the method.

`listPipelineSnapshots()` is already gone from the client contract, replaced by
`getWeeklyForecastSeries()` returning ~13 rows instead of millions — the one
line in this plan that pays for itself immediately, since the client no longer
receives the collection that is 87% of the payload. `ProviderBook` in
`types.ts` is the provider-side shape that still holds it.

**Known blast radius.** `src/data/connections.ts` records the DataProvider
methods each integration node fills, and `connections.test.ts` asserts every
method on the contract appears somewhere on the map. That list is now _derived_
from `DATA_PROVIDER_METHODS`, which is keyed by `keyof DataProvider`, so a new
method on the seam is a compile error until it is listed and a test failure
until it has a wire. That test was built to catch exactly this, and it did.

## What has to be built

### Warehouse and dimensional model

Facts: `fct_opportunity`, `fct_registration`, `fct_pipeline_snapshot`,
`fct_activity`. Dimensions: `dim_partner`, `dim_partner_manager`, `dim_date`.

Snapshots partitioned by week and **write-once**, with no UPDATE grant on the
table. `src/data/types.ts` already states the invariant — "a snapshot already
written must never change" — because reading the past off current state
backdates every later change. In production that invariant is a database
permission, not a comment.

### The fiscal calendar is the highest-risk duplication

If the server computes fiscal quarters, business days, or the snapshot
truncation rule even slightly differently from `src/lib/fiscal.ts`, the
dashboard and the warehouse disagree and nobody can tell which is right.

Generate `dim_date` as a build artifact **from `fiscal.ts`**. One definition,
two consumers. This is also the natural moment to model holidays, which
`fiscal.ts` already flags as a single point of change (`isBusinessDay` is
deliberately the only predicate that would need to learn them).

### Pre-aggregation, not query-on-demand

A sub-second dashboard needs rollup tables refreshed on a schedule, not live
`GROUP BY` over millions of snapshot rows. Filter cardinality is small and
enumerable: fiscal phase (5) × revenue motion (4) × the scopes a given user can
see. Precompute the common combinations and cache the rest.

### Server-enforced row-level authorization

Partner View currently excludes Sell To and conflicting registrations in the
browser. Under a partner SSO boundary the partner's token must scope the query
itself, so their browser never receives another partner's data at all. The
picker that chooses which partner the portal renders is an untrusted demo
presentation selector, and client-side filtering is not authorization: any
visitor can select any partner today. Serving external partners requires
trusted sign-in and server-enforced row access first, which is why the
architecture roadmap keeps the picker-removal item Pending — the same
requirement seen from the UI side.

### Feature-flag methodology and maintainer control plane

The registries now carry the full flag lifecycle — owner, purpose,
environment scope, safe default, rollout and rollback triggers, review date,
expiry, and removal condition — for both product flags
(`src/lib/featureFlags.ts`) and operational telemetry flags
(`src/lib/telemetry/flags.ts`), with a deterministic policy check
(`src/lib/flagGovernance.ts`) that fails on missing metadata, missing
ownership, or an expired flag. Evaluation is fail-safe and tested with an
injected clock: a fresh valid value wins, a failing source serves a bounded
last-known-good cache, and cold start or a stale cache falls back to the
registry safe default. Flags are local and non-authoritative — they never
grant a role or a row, and flag modules cannot import access-scope logic.

What remains production-only is the maintainer experience: changing a flag
still requires someone to edit deployment configuration and rebuild the app.
That is not an appropriate long-term workflow for a nontechnical maintainer.

Before production rollout, select or build an authenticated control plane that
provides a straightforward web interface and:

- separates development, staging, and production values;
- limits changes to approved roles, supports approval rules for high-impact
  flags, and records who changed what and when;
- applies on/off changes, percentage rollouts, and emergency kill switches
  without a code change or redeployment;
- shows current value, owner, purpose, rollout audience, last review date, and
  expected removal date for every flag;
- exposes evaluation and rollout health so a release can be compared with
  errors and business outcomes;
- caches the last known configuration and falls back to the declared safe
  default when the service is unavailable.

The checked-in registry already defines naming, ownership, safe defaults,
environment scope, rollout and rollback triggers, review cadence, expiration,
and removal conditions; the control plane must surface and enforce the same
lifecycle for nontechnical maintainers, plus the targeting rules. A flag is
temporary release machinery, not permanent configuration. Authorization and
partner-data boundaries remain server-enforced even when a related feature is
hidden; a flag must never grant access.

### A real write path

Every in-app edit today is a `Record<string, T>` in React state, lost on reload.
Production needs an override table carrying author, timestamp, reason, and the
source version the override was made against, plus an explicit answer to: what
happens when Salesforce changes a figure underneath a manager's override? Keep
it, drop it, or flag it. The choice has to be made and surfaced to the user.
That record is also what makes forecast accuracy scoreable later — a call can
only be scored against an outcome if the call as made was kept.

### Deferred: per-manager and per-partner Forecast Quality history

The second forecast-quality utility item — close-date slippage, stage aging,
and category-confidence history per manager and partner — stays Pending.
Weekly snapshots record every call as made, but they do not preserve immutable
historical partner-manager ownership, and they carry no authoritative
stage-entry events. Applying today's ownership retroactively would rewrite
history, so an honest trend waits on Phase 2 and Phase 3 data: immutable
ownership records and stage-transition timestamps in the warehouse. Weekly
snapshots, partner-health alerts, and forecast-change reviews are inputs to
that history, not substitutes for it.

### Incremental ingestion

Salesforce via `SystemModstamp` watermark polling plus Bulk API 2.0 for
backfill, inside API quota. Google Calendar via per-user OAuth with incremental
sync tokens. Reconciliation, retries, and dead-letter handling as the roadmap
already specifies.

The weekly snapshot job must be **idempotent**: a unique key on
`(takenAt, opportunityId)` so a re-run cannot double-write.

## What changes in the client

- Replace the single `Promise.all` in `useDashboardData` with a server-state
  library (TanStack Query) and **per-widget** loading and error states, so one
  slow endpoint no longer blanks the whole page. _Partly done:_ the migrated
  view has hand-rolled per-widget states (`useForecastQueries.ts`) and a global
  spinner still covers the other seven. The library is worth adopting when there
  are several migrated views to share it, not before.
- Virtualize `OpportunityTable` and `ForecastTable`; give `Leaderboard` a real
  limit instead of `limit={uniquePartners}`. _Not started_ — the scoped contract
  now bounds what reaches the client, so this is comfort rather than survival.
- Route-level `React.lazy` so the ~485 KB Recharts chunk stops loading for users
  who only open Data Connections. _Not started._ Measured after Phase 1: 193 KB
  app + 484 KB Recharts + 63 KB charts vendor, raw.
- **Keep edits feeling instant.** _Partly done:_ rows render the session's
  override immediately and the aggregates hold their previous figures during the
  refetch, so an edit never flashes the page. The full optimistic delta is Phase
  5, because it needs the write path to reconcile against.

## What is kept

This is the payoff of the existing seam. Effectively unchanged: all eight views,
all components, the design system, `types.ts`, `fiscal.ts`, and the business
rules encoded in `metrics.ts`. The `DataProvider` abstraction was the right
decision; it has the wrong method signatures.

The existing tests become a **conformance suite**: run them against the
TypeScript implementation and against fixtures served by the server
implementation and assert identical output. That is what prevents the dashboard
and the warehouse from quietly diverging, which is the failure mode that kills
these projects.

## Staged path

Phases 0 and 1 require no production data and no infrastructure. They are done
in demo mode, against `MockDataProvider`, and they are what make everything
after them safe.

### Phase 0 — Test infrastructure

Add jsdom, Testing Library, and a coverage provider; gate coverage in CI.

Measured starting point: **27.88% statement coverage overall, 0% across all
eight views, all components, `App.tsx`, and `useDashboardData`** — roughly 5,700
unverified lines. Phase 1 is a refactor of exactly those lines, so this is not
bureaucracy; it is the thing that makes Phase 1 safe.

Also fix the correctness bugs found in review, each with a regression test:
next step cannot be cleared, no error boundary, unguarded division into
`formatPct`, and the meeting modal discarding uncommitted work.

**Outcome, as built:** 27.88% → 91.72% statements, 86.74% branches, 202 tests
across 17 files, with the four thresholds in `vite.config.ts` as a ratchet and
CI running `test:coverage` rather than a bare test run. All four bugs fixed with
regression tests. The next-step one is worth noting for what it says about the
test suite: the first version of its test passed against the buggy code, because
the assertion was matching the em dash in a neighbouring column. It only became
a test after mutation-testing the fix — reverting the `||` to `??` and watching
it fail.

### Phase 1 — Contract rewrite against the mock

Reshape `DataProvider` to the scope/page/aggregate contract and implement it in
`MockDataProvider` by calling the existing `metrics.ts` functions internally.
That moves `metrics.ts` behind the seam — exactly where it lives on a server —
while the data stays local.

Zero infrastructure risk, and it answers the only question that really matters:
do the views survive pagination and server-side aggregation? If a view turns out
to need the whole book to render, that is learned in a week against mock data
rather than six months into a warehouse build.

Migrate **Forecasting first**. It is the hard case: the hottest edit path, and
the only view driven by the snapshot collection that can never ship whole. If
the week-over-week series can be served as a ~14-row aggregate, the central
thesis is proven and the remaining seven views are a template exercise.

Ship two additional providers behind the same contract:

- a **simulated remote provider** wrapping the mock with latency, pagination,
  and injected failures, so the per-widget loading and error states are
  exercised rather than theoretical;
- a **scale provider** generating ~100× data, so the claim that the contract
  holds at volume is demonstrable rather than asserted.

**Outcome, as built.** Forecast migrated end to end, the other seven views
untouched and still on the list-everything contract. Measured on the built demo,
which is honest about what the mock can and cannot show. Medians over five runs
at 100× — 2,500 partners, 21,300 opportunities, 191,000 snapshot rows, ~45 MB of
JSON:

| Call                                            | Payload                | Median          |
| ----------------------------------------------- | ---------------------- | --------------- |
| `getForecastSummary`                            | 217 B                  | 15 ms           |
| `getManagerForecastGroups`                      | 578 B                  | 13 ms           |
| `getForecastQuality`                            | < 1 KB                 | 14 ms           |
| `listQuarterOpportunities`                      | 7.8 KB, one page of 25 | 15 ms           |
| `getWeeklyForecastSeries`                       | 4.2 KB, 13 buckets     | 106 ms          |
| the five aggregates, as one view load           | ~13 KB                 | ~165 ms         |
| `listOpportunities` (still on the old contract) | **7.5 MB**             | 0 ms in-process |

The week-over-week series is the whole argument in one line: 191,100 rows,
35.9 MB, and the client now receives 13 buckets. What is left is in-process
work, because `MockDataProvider` stands in for the server and does the
aggregation the browser used to do; that is the 100 ms and it is exactly the
work a rollup table removes in Phase 3. What changed is the _shape_ of what
crosses the seam, which is the part that cannot be fixed later by throwing
hardware at it.

Three things came out of building it that the plan did not predict:

- Pagination forced a real decision about where a manager's book lives. It is a
  component per expanded group, so collapsing and reopening restarts from page
  one, and one manager's failed page cannot take the others down.
- `ForecastTable` was taking the entire `Partner[]` collection to render one
  column. It now takes a `Record<id, name>` from `getPartnerDirectory()` — a
  dimension, not a fact.
- The edit path needed a rule, not a mechanism: the aggregates keep the previous
  answer on screen while a refetch is in flight, so an edit never flashes the
  page it just changed. A true optimistic delta (apply the revenue and weight
  change to the affected tiles immediately) is still Phase 5 work, because it
  needs the write path to reconcile against.

### Phase 2 — Warehouse and `dim_date`

Fact and dimension model, week-partitioned immutable snapshots, idempotent
weekly snapshot job, `dim_date` generated from `fiscal.ts`.

### Phase 3 — API with row-level authorization

Serve the Phase 1 contract for real. The `metrics.ts` tests become the
conformance suite against the server implementation.

### Phase 4 — Incremental ingestion

Salesforce watermark sync, Calendar OAuth, enablement records, reconciliation
and dead-letter handling.

### Phase 5 — Write path and audit

Persist overrides with provenance, resolve conflicts against the source system,
wire optimistic client updates.

## Rough sizing

Bands rather than estimates, assuming CRM access is already granted:

| Workstream                                   | Rough effort |
| -------------------------------------------- | ------------ |
| Test infrastructure + conformance harness    | 2–3 weeks    |
| Contract rewrite against mock (Phase 1)      | 3–4 weeks    |
| Flag methodology + managed control plane     | 1–2 weeks    |
| Warehouse, models, snapshot job              | 4–6 weeks    |
| API + row-level authorization                | 6–8 weeks    |
| Ingestion (Salesforce, Calendar, enablement) | 6–10 weeks   |
| Write path + audit trail                     | 3–4 weeks    |

Roughly two engineers for four to six months for the foundation. The long pole
is usually not engineering: the privacy, legal, and security review for calendar
data and external partner access is calendar time that cannot be compressed, and
it should start in parallel with Phase 0 rather than after Phase 5.
