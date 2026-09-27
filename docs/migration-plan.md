# Production migration plan

How this dashboard gets from a deterministic mock to a system serving real
partner data at production volume. The *what* is already enumerated in the
[Production Requirements](../src/views/ProductionRequirementsView.tsx)
architecture roadmap — in particular "serve aggregated, paginated API responses
rather than loading the entire ecosystem into the browser". This document is
the *how*: where the current design breaks, the one contract change everything
else follows from, and the order the work has to happen in.

## Where the current design breaks

Every view today reads a single in-memory `DashboardData` containing the entire
ecosystem. `useDashboardData` fetches nine collections in one `Promise.all` and
`src/lib/metrics.ts` aggregates them in the browser on every render. That is the
right shape for a deterministic demo and it does not survive contact with real
volume.

Extrapolating from measured object sizes (~600 B per `Opportunity`, ~250 B per
`PipelineSnapshot`), retaining three years of history:

| Tier          | Partners | Open book | Opps (3 yr) | Snapshot rows (3 yr) | Parsed in browser | Verdict                    |
| ------------- | -------- | --------- | ----------- | -------------------- | ----------------- | -------------------------- |
| Today (mock)  | 25       | ~58       | 213         | 1.9 k                | ~1 MB             | Fine                       |
| Small team    | 100      | 400       | 3 k         | 62 k                 | ~20 MB            | Works, slow first load     |
| Mid-market    | 500      | 3,000     | 25 k        | 470 k                | ~150 MB           | Degraded to unusable       |
| Enterprise    | 2,000    | 15,000    | 150 k       | 2.3 M                | ~800 MB           | Tab dies                   |

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
the browser over the full dataset. In production it becomes the *specification*
a server implementation must match.

That reframing is more tractable than it sounds, because the aggregate return
types already exist as exported interfaces: `RegistrationFunnel`, `StageRow`,
`TypeRow`, `WeightedForecast`, `WeeklyForecastRow`, `LeaderboardRow`,
`RegistrationConversionTimes`, `QuarterRevenueRow`. The DTOs are designed. The
work is moving the function bodies behind the seam and keeping the return types.

The contract becomes two families — aggregates that return kilobytes, and row
lists that paginate:

```ts
interface Scope {
  fiscalPhase: FiscalPhase;
  partnerManagerId?: string;
  partnerIds?: string[];
  oppType?: OpportunityType | 'all';
}

interface DataProvider {
  // Aggregates: computed behind the seam, returned small.
  getKpiSummary(scope: Scope): Promise<KpiSummary>;
  getRegistrationFunnel(scope: Scope): Promise<RegistrationFunnel>;
  getWeightedForecast(scope: Scope): Promise<WeightedForecast>;
  getWeeklyForecastSeries(scope: Scope, quarter: string): Promise<WeeklyForecastRow[]>;
  getPartnerLeaderboard(scope: Scope, limit: number): Promise<LeaderboardRow[]>;

  // Rows: cursor-paginated, server-sorted, server-filtered.
  listOpportunities(scope: Scope, page: PageRequest): Promise<Page<Opportunity>>;
  listPendingRegistrations(scope: Scope, page: PageRequest): Promise<Page<DealRegistration>>;
}
```

`listPipelineSnapshots()` disappears from the client contract entirely, replaced
by `getWeeklyForecastSeries()` returning ~14 rows instead of millions.

**Known blast radius.** `src/data/connections.ts` records the DataProvider
methods each integration node fills, and `connections.test.ts` asserts every
method on the contract appears somewhere on the map. Reshaping the contract
forces updating both. That test was built to catch exactly this, and it will.

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
architecture roadmap already calls for removing the partner picker outside an
internal demo mode; that is the same requirement seen from the UI side.

### A real write path

Every in-app edit today is a `Record<string, T>` in React state, lost on reload.
Production needs an override table carrying author, timestamp, reason, and the
source version the override was made against, plus an explicit answer to: what
happens when Salesforce changes a figure underneath a manager's override? Keep
it, drop it, or flag it. The choice has to be made and surfaced to the user.
That record is also what makes forecast accuracy scoreable later — a call can
only be scored against an outcome if the call as made was kept.

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
  slow endpoint no longer blanks the whole page.
- Virtualize `OpportunityTable` and `ForecastTable`; give `Leaderboard` a real
  limit instead of `limit={uniquePartners}`.
- Route-level `React.lazy` so the ~485 KB Recharts chunk stops loading for users
  who only open Data Connections.
- **Keep edits feeling instant.** An edited forecast currently updates every
  metric in the app immediately. Under server aggregation that survives only
  with an optimistic local delta: for the edited deal, apply
  `new_revenue × new_weight − old_revenue × old_weight` to the affected tiles at
  once, then reconcile against the authoritative refetch. Without it every
  pencil save becomes a visible round trip and the forecasting workflow gets
  worse, not better.

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

| Workstream                                  | Rough effort |
| ------------------------------------------- | ------------ |
| Test infrastructure + conformance harness    | 2–3 weeks    |
| Contract rewrite against mock (Phase 1)      | 3–4 weeks    |
| Warehouse, models, snapshot job              | 4–6 weeks    |
| API + row-level authorization                | 6–8 weeks    |
| Ingestion (Salesforce, Calendar, enablement) | 6–10 weeks   |
| Write path + audit trail                     | 3–4 weeks    |

Roughly two engineers for four to six months for the foundation. The long pole
is usually not engineering: the privacy, legal, and security review for calendar
data and external partner access is calendar time that cannot be compressed, and
it should start in parallel with Phase 0 rather than after Phase 5.
