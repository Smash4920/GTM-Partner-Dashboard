# Deployment

The GTM Partner Dashboard is a single static Vite build: there is no server, API, or database to operate, so deployment is a question of running `npm run build` and serving the resulting `dist/` directory. Today the current path is Vercel, which hosts the app and gives every pull request its own preview. A GitHub Pages workflow is kept as a retained fallback, but it is manual only because the repository is private on a GitHub Free plan. Nothing in the repository automates a "live" production deployment, and no deployment URL is claimed here.

## Current path: Vercel

Vercel is the intended host because the repository is private. Vercel imports the repo, builds it, and serves the static output without exposing the source, and a private repo is not an issue the way it is for GitHub Pages.

One-time setup, as documented in `README.md`:

1. Import the repository at vercel.com.
2. Set the framework to **Vite**, the build command to `npm run build`, and the output directory to `dist`.
3. Enable **Settings → Deployment Protection → Vercel Authentication** so only authorized users can open the URLs.

After import, every pull request gets its own preview URL automatically, and pushes to the default branch deploy the latest `main`. The Vercel build environment sets `VERCEL=1`, which `vite.config.ts` uses to pick the asset base path (see the base-path section below).

## GitHub Pages fallback (manual only)

`.github/workflows/deploy-pages.yml` remains in the repository but runs only from the Actions tab via `workflow_dispatch`. It cannot run automatically, and Pages cannot publish from a private repository on a GitHub Free plan at all: the deploy step fails with `Failed to create deployment (status: 404)`.

The workflow becomes viable in either of two situations:

- The repository is made public.
- The GitHub account moves to a plan that supports Pages on private repositories.

In either case, enable **Settings → Pages → Source: GitHub Actions**, then run the `Deploy to GitHub Pages` workflow manually. Pages serves this repository as a project site under the repo name, so the site would live at the `https://smash4920.github.io/GTM-Partner-Dashboard/` project-site path.

The workflow was originally automatic and was retired to `workflow_dispatch` in commit `506f8be` so it stops failing on every push while staying one click away; see [Lore](lore.md) for the history.

## Base path

Assets resolve differently per host, so `vite.config.ts` derives the build base from the environment at build time:

base = `process.env.BASE_PATH ?? (process.env.VERCEL ? '/' : '/GTM-Partner-Dashboard/')`

| Host | `VERCEL` | `BASE_PATH` | Base |
| --- | --- | --- | --- |
| Vercel | set | unset | `/` |
| GitHub Pages project site | unset | unset | `/GTM-Partner-Dashboard/` |
| Any other host | any | set, for example `/preview/` | the `BASE_PATH` value |

`VERCEL` is a build-time flag set by Vercel; `BASE_PATH` is an explicit override that wins over both defaults. There is no runtime path logic — the base is baked into the built assets.

## Relationship with CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, and `npm run build` on every pull request (and on demand via `workflow_dispatch`). It is the quality gate in front of deployment: a branch that fails lint or type-check/build cannot be merged, so the code that reaches Vercel or Pages has already been built once in CI against the same Node 20 toolchain. CI itself does not deploy anywhere; it only verifies that the build succeeds.

## Limitations and what is absent

This is a frontend mockup, and the deployment story reflects that:

- No production URL is configured or claimed in this repository; Vercel assigns URLs when the project is imported, and those URLs are not recorded here.
- There is no monitoring, error tracking, uptime alerting, or analytics integration.
- There is no rollback automation. Vercel previews and the manual Pages workflow publish on demand; reverting means redeploying a previous commit or using Vercel's own deployment controls.
- There is no runtime authentication in the app itself. Vercel Authentication protects access to the hosting layer, and the partner portal's picker only simulates the partner identity that partner SSO would provide in production.
- There is no server runtime, API, or database to deploy, configure, or scale.

For how the app is built and run locally, see [Getting started](overview/getting-started.md); for the build configuration details, see [Configuration](reference/configuration.md); for the dependency list, see [Dependencies](reference/dependencies.md).

## Related pages

- [Getting started](overview/getting-started.md) — local build commands and base-path examples.
- [Architecture](overview/architecture.md) — the runtime boundary and how `dist/` is produced.
- [Configuration](reference/configuration.md) — `vite.config.ts`, env and build variables, and CI workflows.
- [Dependencies](reference/dependencies.md) — the packages the build needs.
- [Lore](lore.md) — why the Pages workflow is manual-only.
