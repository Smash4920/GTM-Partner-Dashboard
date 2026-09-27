# Systems

The Systems lens documents the data layer of the GTM Partner Dashboard: the `DataProvider` contract in `src/data/DataProvider.ts`, the deterministic mock that implements it in `src/data/mock/`, and how `src/data/useDashboardData.ts` turns the four provider methods into the `DashboardData` object the views render.

## Purpose of this lens

The dashboard has no backend, so its data subsystem is deliberately small: one interface, one mock implementation, one deterministic generator, and one loading hook. This lens:

- Explains the contract the UI depends on and the four methods a replacement source must implement.
- Records how the mock produces identical data on every load from a fixed seed and snapshot date.
- Shows the load, error, and integration behavior of `src/data/useDashboardData.ts` and `src/App.tsx`.
- Points at the exact files to change when the data source, the dataset shape, or the loading behavior must change.

The user-facing behavior built on top of this data layer is documented in the [Features lens](../features/index.md). The full flow from browser to views is covered by [Architecture](../overview/architecture.md), and the record shapes are detailed in [Data models](../reference/data-models.md).

## Directory layout

| Path | Purpose |
| --- | --- |
| `droid-wiki/systems/index.md` | This index |
| `droid-wiki/systems/data-provider.md` | The provider contract and the current mock implementation |

## System map

| System | Page | Primary source |
| --- | --- | --- |
| Provider contract: four methods for partners, registrations, opportunities, targets | [Data provider](data-provider.md) | `src/data/DataProvider.ts` |
| Mock implementation and deterministic generator | [Data provider](data-provider.md) | `src/data/mock/MockDataProvider.ts`, `src/data/mock/generate.ts` |
| Parallel loading hook with loading/error state | [Data provider](data-provider.md) | `src/data/useDashboardData.ts` |
| End-to-end data flow and view layers | [Architecture](../overview/architecture.md) | `src/App.tsx`, `src/views/` |
| Canonical record shapes and enums | [Data models](../reference/data-models.md) | `src/data/types.ts`, `src/data/constants.ts` |

## Related pages

- [Data provider](data-provider.md) — the contract, the mock, and how to replace it.
- [Architecture](../overview/architecture.md) — how the provider feeds the metric and view layers.
- [Data models](../reference/data-models.md) — the `Partner`, `DealRegistration`, `Opportunity`, `Target`, and `DashboardData` shapes.
- [Overview](../overview/index.md) — what the project is and who uses each view.
- [Features](../features/index.md) — what the views built on this data show.
