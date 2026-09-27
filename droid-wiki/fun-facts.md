# Fun facts

Short facts about the GTM Partner Dashboard that can be verified directly in the repository as of 2026-09-19. No origin stories here — each claim names the file it comes from.

## The mock data is a fixed snapshot that never drifts

The entire mock book of business is deterministic. `src/data/mock/rng.ts` implements a mulberry32 PRNG, and `src/data/mock/generate.ts` seeds it with `20260918` — literally the snapshot date `2026-09-18` written as an integer. Combined with the fixed `SNAPSHOT_DATE` in `src/data/constants.ts`, the generated dataset (25 partners, 180 registrations, eight quarters of opportunities) is byte-for-byte identical on every load. The app can never produce "today-dependent" numbers, because today is always 2026-09-18.

## The longest file is the data generator, not a view

`src/data/mock/generate.ts` is the longest source file in the repository at 397 lines, longer than either user-facing view (`src/views/LeadershipView.tsx` at 322 and `src/views/PartnerView.tsx` at 235). The next-longest is the metrics layer, `src/lib/metrics.ts` at 337. The two views stay compact precisely because data creation and calculation are pushed into those two modules.

## There are zero test files, and CI is fine with it

A search of the entire tracked tree at `HEAD` finds no TODO, FIXME, HACK, or `@deprecated` markers. There are also no test files: `package.json` has no `test` script, and `.github/workflows/ci.yml` runs only `npm run lint` and `npm run build`. The verification story for this repository is type-checking, linting, and building — nothing more.

## The build base path is host-aware

`vite.config.ts` does not hard-code an asset base. It uses `BASE_PATH` if set, otherwise `/` when the build runs on Vercel (`VERCEL=1`) and `/GTM-Partner-Dashboard/` otherwise, matching how GitHub Pages serves a project site under the repository name. The same source tree therefore builds correctly for both hosts without edits.

## The app has no backend, by design

Every runtime dependency is frontend-only: `react`, `react-dom`, `recharts`, and two `@fontsource` packages for the Geist typefaces. There is no server runtime, no database, and no API client in `package.json`. The `DataProvider` interface in `src/data/DataProvider.ts` exists specifically so a real CRM or warehouse source can later be swapped in for the mock without touching the views.

## Sell To is the hidden revenue motion

`src/views/PartnerView.tsx` filters out Sell To opportunities entirely: the partner portal shows only Sell With and Allocate. The internal `src/views/LeadershipView.tsx` is the only place where the full three-motion picture appears. See the [Glossary](overview/glossary.md) for how the revenue motions are defined, and [Data models](reference/data-models.md) for the record shapes behind these facts.
