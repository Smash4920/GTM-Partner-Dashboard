# Repository map

Generated from the working tree by `scripts/generate-docs.mjs`. Build output,
dependencies, and tool caches are excluded.

## Top-level directories

| Directory       | Purpose                                                          |
| --------------- | ---------------------------------------------------------------- |
| `.claude`       | Uncategorized.                                                   |
| `.devcontainer` | Uncategorized.                                                   |
| `.github`       | CI, release automation, and repository templates.                |
| `.husky`        | Uncategorized.                                                   |
| `.skills`       | Agent skills available for repository tasks.                     |
| `.zap`          | Reviewed OWASP ZAP baseline rules for the DAST workflow scan.    |
| `config`        | Checked-in budgets and release automation configuration.         |
| `docs`          | Product documentation and operational runbooks.                  |
| `public`        | Static assets copied into the build unchanged.                   |
| `scripts`       | Node policy checks and tooling run locally and in CI.            |
| `src`           | Application source: shell, views, components, data, and helpers. |
| `tests`         | Playwright end-to-end browser tests.                             |

## CI workflows

- `.github/workflows/ci.yml`
- `.github/workflows/deploy-pages.yml`
- `.github/workflows/droid-review.yml`
- `.github/workflows/droid.yml`
- `.github/workflows/error-to-insight.yml`
- `.github/workflows/release-please.yml`
- `.github/workflows/security.yml`

## Shared configuration

- `config/audit-exceptions.json`
- `config/bundle-budgets.json`
- `config/dependency-budgets.json`
- `config/release-please-config.json`
- `config/release-please-manifest.json`
- `config/test-performance.json`

## Runbooks

- [CI failure runbook](../runbooks/ci-failure.md)
- [Deployment runbook](../runbooks/deployment.md)
- [Incident response runbook](../runbooks/incident-response.md)
- [Rollback runbook](../runbooks/rollback.md)

## Skills

- `.skills/migrate-dashboard-data-view/SKILL.md` — Extend the GTM Partner Dashboard data layer with scoped aggregates and paginated DataProvider queries. Use for DataProvider contract changes, view data work, provider implementations, or removal of list methods. (The load-everything DashboardData flow this skill originally migrated views away from is deleted; every route already reads the scoped contract.)
- `.skills/release-and-deploy/SKILL.md` — Cut and deploy a GTM Partner Dashboard release. Use when merging to main, preparing release notes, deploying to Vercel, publishing GitHub Pages, or rolling back a bad deploy.
