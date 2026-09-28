---
name: release-and-deploy
description: Cut and deploy a GTM Partner Dashboard release. Use when merging to main, preparing release notes, deploying to Vercel, publishing GitHub Pages, or rolling back a bad deploy.
---

# Release and deploy the dashboard

The dashboard is a client-only Vite app. There is no server to migrate and no
database to back up, so a release is a build artifact swap plus a preview
check. Follow the order below and stop at the first failing gate.

## Before merging to main

1. Confirm the pull request is green: `.github/workflows/ci.yml` runs the
   validation job and the Playwright job.
2. Confirm the local checks match CI by running the order in `AGENTS.md`; the
   `npm run bundle:check` and `npm run docs:check` gates are the ones most
   likely to fail after a dependency or documentation change.
3. Confirm `docs/generated/` was regenerated with `npm run docs:generate` if any
   `package.json` script, workflow, budget, runbook, or skill changed.

## Release notes

Release notes are automated by Release Please.

- `.github/workflows/release-please.yml` runs on every push to `main` and opens
  (or updates) a release pull request.
- `config/release-please-config.json` and `config/release-please-manifest.json`
  record the release type and current version.
- Merging the release pull request updates `CHANGELOG.md` and `package.json`,
  tags the commit, and publishes the GitHub Release.

Do not hand-edit `CHANGELOG.md`; write conventional commit messages and let the
workflow assemble the notes. If a release must be corrected, edit the release
body in GitHub rather than rewriting the changelog.

## Deploy

- **Vercel (current path).** Vercel builds the `main` branch and every pull
  request preview. The build is `npm run build` with output `dist/`. Verify a
  preview URL on the release pull request before merging.
- **GitHub Pages (manual, blocked).** `.github/workflows/deploy-pages.yml` runs
  only via `workflow_dispatch` and cannot publish from a private repo on the
  Free plan. Do not trigger it unless the repository is public or on Pro.

`vite.config.ts` selects the asset base path from the environment: `/` when
`VERCEL` is set and `/GTM-Partner-Dashboard/` otherwise. Set `BASE_PATH` to
override.

## After deploy

1. Load the deployed URL and confirm the provider selector still defaults to the
   local mock.
2. Open DevTools and confirm a single structured log record per data load and no
   error-level records.
3. If the deploy is bad, follow `docs/runbooks/rollback.md` rather than
   force-pushing.
