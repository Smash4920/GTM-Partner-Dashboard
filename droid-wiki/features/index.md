# Features

The Features lens describes the two user-facing views of the GTM Partner Dashboard: the internal GTM Leadership dashboard and the partner-facing portal. Both views receive the same `DashboardData` object from `src/App.tsx` and derive every number from `src/lib/metrics.ts`, so the pages here focus on what each view shows, which logic backs each panel, and which files to touch when a view needs to change.

## Purpose of this lens

Everything a user can click or read in the app lives in `src/views/` and is rendered by the shared components in `src/components/`. This lens:

- Explains the two views and the panels inside them, including filters and unit choices.
- Records which metric functions and components each panel uses.
- Points at the files to modify when behavior must change.

The data underneath both views is documented in the [overview index](../overview/index.md), the shapes in the [glossary](../overview/glossary.md), and the data flow in [architecture](../overview/architecture.md).

## Directory layout

| Path | Purpose |
| --- | --- |
| `droid-wiki/features/index.md` | This index |
| `droid-wiki/features/leadership-dashboard.md` | The internal aggregate view in `src/views/LeadershipView.tsx` |
| `droid-wiki/features/partner-portal.md` | The single-partner view in `src/views/PartnerView.tsx` |

## Feature map

| User-visible feature | Page | Primary source |
| --- | --- | --- |
| View tabs, data loading, and view switching | Both | `src/App.tsx`, `src/data/useDashboardData.ts` |
| KPI row, registration funnel, sales-stage and outcome panel, type breakdown, pending queue, leaderboard | [Leadership dashboard](leadership-dashboard.md) | `src/views/LeadershipView.tsx`, `src/lib/metrics.ts` |
| Partner selection, Sell To exclusion, motion slices, partner KPIs, target trend, registration history | [Partner portal](partner-portal.md) | `src/views/PartnerView.tsx`, `src/lib/metrics.ts` |
| Quarterly revenue vs. target chart | Both | `src/components/RevenueTrend.tsx` |
| Horizontal measure bars (funnel, stage, type, motion panels) | Both | `src/components/MetricBars.tsx` |

## Related pages

- [Leadership dashboard](leadership-dashboard.md) — the internal aggregate view.
- [Partner portal](partner-portal.md) — the partner-scoped portal.
- [Overview](../overview/index.md) — what the project is and who uses each view.
- [Architecture](../overview/architecture.md) — data flow from provider to views.
- [Glossary](../overview/glossary.md) — revenue motions, funnel, and coverage terms.
- [Getting started](../overview/getting-started.md) — running and building the app.
- [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md) — how views and metrics are written and documented.
