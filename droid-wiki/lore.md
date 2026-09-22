# Lore

The recorded history of this repository begins on 2026-09-18. The dashboard was initialized, built, merged, and extended within two days, and there is no pre-Sep-18 history to report: every era below is dated between 2026-09-18 and 2026-09-19.

## Initialization: 2026-09-18

The first commit, `0f9728f` (`chore: initialize repository`), landed on 2026-09-18 and contained only `README.md` and `.gitignore`, two files and 22 lines. It established the repository name (`gtm-partner-dashboard`) and the Node/Vite project scaffolding before any application code existed.

## First construction: 2026-09-18

Later the same day, `90cab73` (`feat: partner revenue pipeline dashboard mockup`) created nearly the entire application in one change: 38 files, 6,842 insertions, 4 deletions. That commit introduced the two views over one data model, the `DataProvider` interface as the CRM integration seam, the deterministic seeded mock data (`src/data/mock/generate.ts`), the Factory-inspired visual system in `tailwind.config.js`, and the two GitHub Actions workflows (CI and the original automatic Pages deploy). This single commit is the largest change in repository history and remains the structural core of the app today.

## First merge: 2026-09-19

On 2026-09-19, pull request #1 merged the feature branch into `main` as merge commit `28ed80c`, authored by Smash4920. The default branch reached 3 commits and 39 tracked files. The merge itself introduced no changes of its own; it brought the construction commit into the default branch unchanged.

## Follow-up era: 2026-09-19

Two branch-only commits followed the merge on 2026-09-19, both on `feat/partner-revenue-pipeline-mockup`:

- `35ff45b` (`feat: add slice toggles and fix funnel unit mixing`) added motion slices to `src/views/PartnerView.tsx`, a shared `src/components/FilterChips.tsx`, and fixed the leadership registration funnel, which had mixed registration counts with registered dollars.
- `506f8be` (`build: make base path host-aware, retire automatic Pages deploy`) made `vite.config.ts` pick its asset base from the environment (`/` on Vercel, `/GTM-Partner-Dashboard/` otherwise, `BASE_PATH` to override), made the Pages deploy manual-only, added `public/favicon.svg`, and documented the Vercel path in `README.md`. This is the current `HEAD`.

## Longest-standing features

Because the repository is two days old, "longest-standing" means present since the first commits:

- `README.md` and `.gitignore` exist since the initialization commit on 2026-09-18.
- The data model in `src/data/types.ts`, the `DataProvider` contract in `src/data/DataProvider.ts`, the fixed snapshot date in `src/data/constants.ts`, and both views (`src/views/LeadershipView.tsx`, `src/views/PartnerView.tsx`) all exist since the construction commit on 2026-09-18.
- The deterministic seed and snapshot date, which make the mock identical on every load, have been fixed since the construction commit and have not changed since.

## Deprecated features

None found. There are no `@deprecated` markers, no TODO/FIXME/HACK references anywhere in the tracked tree, and no feature has been removed from `origin/main`. The closest thing to a retirement is the GitHub Pages deploy automation: it began as fully automatic in the construction commit, and `506f8be` on 2026-09-19 turned it into a manual `workflow_dispatch` job so it stops failing on every push while remaining one click away. The workflow file itself still exists at `.github/workflows/deploy-pages.yml`.

## Major rewrites

None. The repository is still in its initial construction phase. The largest change is the first construction commit itself, and the two September 19 follow-ups extended that foundation (adding a component, fixing unit handling, adjusting the build base) rather than replacing any subsystem. There has been no rewrite of the data layer, the views, or the component library.

## Growth trajectory

The repository grew from 2 tracked files on 2026-09-18 to 39 by the merge on 2026-09-19, and to 41 at `HEAD` after the follow-up commits (the additions being `src/components/FilterChips.tsx`, `public/favicon.svg`, and `index.html` edits from `506f8be`). Line volume went from 22 insertions at initialization to 6,864 total insertions on the default branch by the merge. Current `HEAD` is `506f8be` on the feature branch, which is ahead of `main` by the two follow-up commits.

For the architecture that this history produced, see [Architecture](overview/architecture.md); for how the app is built and where it is deployed, see [Deployment](deployment.md). The quantitative version of this story is in [By the numbers](by-the-numbers.md).
