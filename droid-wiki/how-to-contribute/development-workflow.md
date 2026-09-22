# Development workflow

The contribution loop for the dashboard is branch, implement, check, review in a browser, then open a pull request and let CI verify it. This page describes each step as it actually runs in this repository.

## Current branch state

The default branch is `main`, which holds the merge of pull request #1 and the initial commits. Active development currently continues on the feature branch `feat/partner-revenue-pipeline-mockup`: it carries the two most recent commits (`35ff45b` slice toggles and funnel-unit fix, `506f8be` host-aware base path and retiring the automatic Pages deploy) and is 2 commits behind and 2 commits ahead of `origin/main` — it does not include the pull-request merge yet. New work can continue on that feature branch while the mockup is in flight, or start a fresh branch off `main` for an independent change. Both branches exist locally and on `origin`.

## Branch and commit

Create a branch from the current base, commit in small units, and push. The existing history uses conventional-style prefixes: `feat:` for user-facing additions, `build:` for build and deployment changes, `chore:` for maintenance. There is no documented review policy beyond the CI checks described below; anything that compiles, lints, and reads cleanly is approvable.

## Implement

Where a change goes depends on what it touches. The conventions in [Patterns and conventions](patterns-and-conventions.md) and the flow in [Architecture](../overview/architecture.md) mark the boundaries:

- New fields belong in `src/data/types.ts` first, then the generator and consumers.
- Reusable display math goes in `src/lib/metrics.ts`; formatting in `src/lib/format.ts`.
- A view lives in `src/views/`, a shared presentation component in `src/components/`.
- The mock dataset is shaped by constants at the top of `src/data/mock/generate.ts`.
- The source swap happens in `src/App.tsx` where the provider is instantiated.

Keep the units rule in mind: a registration `amount` is a partner estimate at submission, an opportunity `amount` is sales-sized, and `src/lib/metrics.ts` never sums the two streams.

## Check with lint and build

From the repository root:

```bash
npm run lint
npm run build
```

`npm run lint` runs ESLint 9 with the flat config in `eslint.config.js`, applying the typescript-eslint recommended rule set over `src/`. `npm run build` runs `tsc -b`, the TypeScript project build, and then `vite build` into `dist/`. The strict options in `tsconfig.app.json` — `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch` — turn unused code and some control-flow mistakes into build failures.

## Visual and manual review

The repository has no automated tests, so browser verification is part of the change. Run `npm run dev`, then:

- Switch between GTM Leadership and Partner Portal and confirm the view tabs render.
- Exercise the filters: the type filter and funnel measure on `src/views/LeadershipView.tsx`, the partner picker and slice chips on `src/views/PartnerView.tsx`.
- Spot-check money, percentage, and date formatting in both views.
- When the change affects layout, the screenshots under `docs/screenshots/` may need regenerating; that is a manual step and CI does not check them.

Because the mock data is deterministic, numbers only move when the generator, constants, or metrics change — unexpected movement is a signal that the change leaked into data logic.

## Pull request and CI

Push the branch and open a pull request against `main`. `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, and `npm run build` on Node 20 for every pull request, and can also be triggered manually from the Actions tab. A green CI run is the machine-checked part of done; the manual review above is the rest. With Vercel connected, each pull request gets its own preview URL automatically, which is the fastest way to share a change for review. There is no deploy-on-merge step: the Pages workflow in `.github/workflows/deploy-pages.yml` is manual-only and Vercel deploys are controlled from the Vercel side, as documented in [Getting started](../overview/getting-started.md).

## Related pages

- [How to contribute](index.md) — how to pick up work and the definition of done.
- [Patterns and conventions](patterns-and-conventions.md) — the code conventions applied while implementing.
- [Testing](testing.md) — what lint and build do and do not cover, and the manual checks.
- [Tooling](tooling.md) — what each tool in the loop does.
- [Getting started](../overview/getting-started.md) — local setup and build base paths.
