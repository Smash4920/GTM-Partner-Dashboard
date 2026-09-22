# How to contribute

This lens covers the contribution path for the GTM Partner Dashboard: how to pick up work, the branch and pull-request cycle, the checks that exist today, where to debug, and the tooling behind the build. It is the counterpart to the [Overview](../overview/index.md), which explains what the application does, and to [Patterns and conventions](patterns-and-conventions.md), which explains how the code is written.

## Picking up work

Start with the [Overview](../overview/index.md) to understand the two views and the data model, then run the app locally as described in [Getting started](../overview/getting-started.md). Most changes land in one of a few places:

- Display math: `src/lib/metrics.ts` and `src/lib/format.ts`.
- A view: `src/views/LeadershipView.tsx` or `src/views/PartnerView.tsx`.
- A shared UI piece: `src/components/`.
- The data layer: `src/data/` — see [Data provider](../systems/data-provider.md) and [Architecture](../overview/architecture.md).

The project is small (23 source files, roughly 2,200 lines; see [By the numbers](../by-the-numbers.md)), so a change is usually one or two files. Read [Patterns and conventions](patterns-and-conventions.md) before editing: it records the data boundaries, the unit rules (registration dollars are never summed with opportunity dollars), and the async provider conventions that reviewers will expect.

## Branches and pull requests

The default branch is `main`. All work arrives through pull requests that CI checks. The de-facto workflow in the repository history is: branch off the current base, commit in small units with conventional-style prefixes such as `feat:`, `build:`, and `chore:`, push, and open a pull request against `main`.

Every pull request runs the CI workflow in `.github/workflows/ci.yml` on Node 20: `npm ci`, `npm run lint`, and `npm run build`. The workflow also has a manual `workflow_dispatch` trigger. There is no documented review policy beyond the CI checks passing; the Codeowners and approval rules that exist in many projects are not present here. Deployment is not automatic: `.github/workflows/deploy-pages.yml` runs only on manual dispatch, and [Getting started](../overview/getting-started.md) notes that Vercel is the intended host and provides per-pull-request preview URLs.

## Definition of done

There is no `test` script and no test file in the repository — [Testing](testing.md) says what actually exists. The practical bar for a contribution is:

- `npm run lint` passes.
- `npm run build` passes. That command runs `tsc -b`, the strict TypeScript project build, before `vite build`, so type errors and strict-mode violations fail it.
- The change was seen and exercised in a browser on the views it touches, including filters and the partner picker ([Development workflow](development-workflow.md) lists the manual checks).
- Any new dependency is reflected in `package-lock.json`, because CI installs with `npm ci`.
- The deterministic mock story stays coherent: counts, the fixed 2026-09-18 snapshot, and documented conversion rates are described in [Data provider](../systems/data-provider.md); changing them is a deliberate data-story change, not a side effect.

## Pages in this lens

- [Development workflow](development-workflow.md) — branch, implement, check, review, and PR.
- [Testing](testing.md) — what lint and build cover, manual checks, and future test seams.
- [Debugging](debugging.md) — loading/error paths, base-path issues, and chart rendering.
- [Tooling](tooling.md) — Vite, TypeScript, ESLint, Tailwind, Recharts, and CI configuration.
- [Patterns and conventions](patterns-and-conventions.md) — code conventions for the repository.

## Related pages

- [Overview](../overview/index.md) — what the project is and who uses each view.
- [Getting started](../overview/getting-started.md) — local setup and build base paths.
- [Architecture](../overview/architecture.md) — data flow from provider to views.
- [By the numbers](../by-the-numbers.md) — the quantitative baseline of the repository.
