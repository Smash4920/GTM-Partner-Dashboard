# Getting started

This page covers the local setup for the Vite dashboard. It assumes Node.js and npm are available on the development machine.

## Prerequisites

- Node.js 20 or newer. CI uses Node 20 in `.github/workflows/ci.yml`.
- npm with lockfile support.
- A browser for the Vite development server.

## Install and run

From the repository root:

```bash
npm install
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`.

The app starts with the GTM Leadership view. Use the header tabs to switch to Partner Portal. The portal's partner picker simulates the partner identity that production SSO would provide.

## Quality checks

```bash
npm run lint
npm run build
npm run preview
```

`npm run build` runs `tsc -b` before `vite build`, so it catches TypeScript errors and then writes the static bundle to `dist/`. There is no `test` script or test directory in the current repository. CI runs lint and build for pull requests through `.github/workflows/ci.yml`.

## Changing the data source

Start with `src/data/DataProvider.ts`. Implement all four methods for the new source, return the canonical types from `src/data/types.ts`, and replace `new MockDataProvider()` in `src/App.tsx`. Keep the view modules independent of CRM or warehouse SDKs.

For changes limited to display logic, start in the relevant view or `src/lib/metrics.ts`. For new reusable UI, follow the existing components in `src/components/` and the conventions in [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md).

## Build base paths

The Vite base path is host-aware:

| Host | Default base |
| --- | --- |
| Vercel | `/` when `VERCEL` is set |
| GitHub Pages | `/GTM-Partner-Dashboard/` when `VERCEL` is not set |
| Other host | Set `BASE_PATH` explicitly |

Examples:

```bash
VERCEL=1 npm run build
BASE_PATH=/preview/ npm run build
```

See [Deployment](../deployment.md) for hosting setup and the private-repository constraint on GitHub Pages.
