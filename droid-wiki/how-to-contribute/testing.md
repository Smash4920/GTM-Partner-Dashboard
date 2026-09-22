# Testing

The repository has no automated test suite. There is no `test` script in `package.json`, no test directory, and CI runs no tests. What exists is a set of static and build-time checks plus manual browser verification. This page states that accurately and notes where automated tests could attach if one is added later.

## Current checks

- `npm run lint` — ESLint 9 using the flat config in `eslint.config.js`, applying the typescript-eslint recommended rule set. It catches unused imports, some type-unsafe patterns, and syntax-level problems, but nothing about runtime behavior.
- `npm run build` — `tsc -b` type-checks all of `src/` under the strict settings in `tsconfig.app.json`, then `vite build` bundles to `dist/`. The strict flags `noUnusedLocals`, `noUnusedParameters`, and `noFallthroughCasesInSwitch` are build errors, so the TypeScript type system is the main automated regression net today.

CI in `.github/workflows/ci.yml` runs exactly these two commands (`npm run lint`, `npm run build`) after `npm ci`.

## Manual browser checks

Because there is no test runner, verifying a change means running `npm run dev` and covering the behavior the app actually has:

- Both views load and switch cleanly, and the error and loading states render as wired in `src/App.tsx`.
- The filters hold their invariants: on `src/views/LeadershipView.tsx` the type filter drives KPIs, stages, revenue, and the leaderboard while registrations stay unfiltered, and the funnel measure switches between value and count; on `src/views/PartnerView.tsx` the Sell To exclusion holds across every slice.
- Numbers are consistent with the deterministic mock: 25 partners, 180 registrations, roughly 185 opportunities, and 200 targets (25 partners × 8 quarters), with the documented ~85% approval rate, ~70% registration-to-opportunity conversion, and ~55% win rate. These baselines come from `src/data/mock/generate.ts` and are catalogued in [Data provider](../systems/data-provider.md).

## Why deterministic data helps

The mock is a fixed-story fixture: `src/data/mock/rng.ts` provides a seeded mulberry32 PRNG, and `src/data/mock/generate.ts` consumes it in a fixed order, so the output is identical on every load and every build. Manual expected-value checks are repeatable, and a future automated test can assert exact totals rather than ranges.

## Suggested future test seams

None of the following exist today; they are the natural places a test runner would attach:

- Unit tests for `src/lib/metrics.ts` and `src/lib/format.ts`. These modules are pure TypeScript with no React or browser dependency, so they run in any framework with no test doubles. Vitest would fit the Vite setup.
- Golden-master checks against `generateDashboardData()` in `src/data/mock/generate.ts`: it is pure and deterministic, so record counts and aggregate totals can be asserted exactly.
- Provider contract tests: a fake implementation of the `DataProvider` interface in `src/data/DataProvider.ts` can exercise `src/data/useDashboardData.ts` loading, error, and the `alive` unmount guard.
- Component tests for `src/components/` with React Testing Library and Vitest if the chips and picker interactions need coverage.

Adding a runner means touching `package.json` (a new script and dev dependency), committing the lockfile update, and extending `.github/workflows/ci.yml`; none of that exists yet, and [Tooling](tooling.md) documents the current setup that would change.

## Related pages

- [How to contribute](index.md) — the definition of done this page supports.
- [Development workflow](development-workflow.md) — the loop that includes manual verification.
- [By the numbers](../by-the-numbers.md) — the repository baseline, including the zero-test count.
- [Patterns and conventions](patterns-and-conventions.md) — where pure functions live so they stay testable.
