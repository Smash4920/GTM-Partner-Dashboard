# GTM Partner Dashboard overview

The GTM Partner Dashboard is a React mockup for tracking partner-sourced revenue. It gives GTM leadership an aggregate view and gives an individual partner a scoped portal view, both backed by the same dashboard data model.

## What the project does

The app follows the path from deal registration through approval, conversion to a qualified opportunity, sales-stage progression, and closed revenue. The internal view includes all three revenue motions, while the partner view exposes only Sell With and Allocate opportunities.

The current implementation is a deterministic frontend prototype. `src/data/mock/generate.ts` creates 25 partners, 180 registrations, and roughly 185 opportunities across eight quarters from a fixed 2026-09-18 snapshot. `src/App.tsx` loads that data through `src/data/useDashboardData.ts` and renders either `src/views/LeadershipView.tsx` or `src/views/PartnerView.tsx`.

## Who uses each view

| View | Audience | Main questions |
| --- | --- | --- |
| GTM Leadership | Internal GTM leadership and operations | How much partner pipeline exists, where is it in the funnel, and how does it compare with target? |
| Partner Portal | One partner at a time | What registrations, opportunities, targets, and revenue motions belong to this partner? |

The partner picker is a prototype convenience. A production portal would scope the partner in the session or through partner SSO, as documented in `src/views/PartnerView.tsx`.

## Start here

- [Architecture](architecture.md) explains the data flow and integration seam.
- [Getting started](getting-started.md) covers local development and builds.
- [Glossary](glossary.md) defines revenue motions and pipeline terms.
- [Data provider](../systems/data-provider.md) explains how to replace the mock source.
- [Leadership dashboard](../features/leadership-dashboard.md) and [partner portal](../features/partner-portal.md) describe the user-facing views.
- [Deployment](../deployment.md) documents Vercel and the retained manual GitHub Pages workflow.

## Scope and current limits

This repository contains a frontend mockup, not a connected CRM product. There is no API server, database, authentication flow, telemetry stack, or automated test suite. The `DataProvider` interface in `src/data/DataProvider.ts` is the intended boundary for adding a real CRM or warehouse implementation later.
