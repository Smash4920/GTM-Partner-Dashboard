# CI failure runbook

## Signal

A required check in `.github/workflows/ci.yml` is red on a pull request or on
`main`, and the failing step is not obvious from the log tail.

## General steps

1. Read the first failing step in the job log, not the last. Later failures are
   often cascade failures.
2. Reproduce locally with the same command the step runs.
3. Fix the cause, not the symptom. Do not lower a coverage threshold, widen a
   budget, or skip a check to make the build green without a written reason.

## Step-by-step

### `Validate AGENTS.md freshness`

`npm run agents:check` fails when `AGENTS.md` documents an `npm run` script that
no longer exists, a shell command it cannot validate, or a repository path that
was removed or renamed. Fix the documentation or restore the path. The check is
intentionally strict so the contributor guide cannot silently rot.

### `check:file-limits`

A file is over 1 MiB or a text file is over 1,200 lines. Split the file or move
the binary to Git LFS or a release asset. Lockfiles are exempt from the line
limit but not the size limit.

### `format:check`

Run `npm run format`, then review the diff. Prettier owns line wrapping; do not
hand-wrap to taste.

### `test:debt` / `debt:check`

A source debt marker is not linked to an issue. Use
`MARKER(#123): reason`, where the number is an issue in this repository, and
explain the removal condition.

### `lint` / `dead-code` / `lint:duplicates`

- Lint failures include module-boundary violations: keep dependencies flowing
  app shell to views to components to data and domain helpers.
- Knip reports unused files, exports, and dependencies. Remove the dead code or
  wire it in; do not silence the finding without a reason.
- jscpd fails when source duplication exceeds the configured threshold. Extract
  the shared helper instead of copying a second time.

### `docs:check`

Two failures are possible. Generated documentation under `docs/generated/` is
stale: run `npm run docs:generate` and commit the result (the pages are derived
from `package.json`, the workflows, the `config/` budgets, the runbooks, and
the skills). Or the documentation consistency check
(`scripts/check-docs-consistency.mjs`) found a claim that disagrees with the
client-only product: a missing required fact (the Demo/Production status axes,
the partner-picker limitation, the deferred Forecast Quality prerequisites,
session-only simulated actions, telemetry defaults) or a prohibited claim
(roster "authorization" language, calendar-hour SLA phrasing, webhook
endpoints, secret-shaped environment variables, or any assertion that
authentication, server enforcement, durable delivery, or a remote flag plane
exists). Fix the document or the fixture in the same change; do not weaken a
required claim to make the check pass.

### `client-boundary:check`

`npm run client-boundary:check` (`scripts/check-client-boundary.mjs`) failed:
a dependency, source file, workflow, or static asset crossed the client-only
boundary — a server framework, database client, authentication library,
warehouse SDK, live connector or HTTP client, notification sender, durable
browser store, realtime channel, a network primitive outside the reviewed
telemetry modules, browser storage outside the flag-rollout cohort, a Node
runtime API, a server-shaped path, a CI `services:` container, or an external
asset in `index.html`/`public/`. Remove the addition, or — for a genuinely
reviewed exception — update the allowlist in the checker with its rationale in
the same pull request.

### `test:coverage:ci`

- A failing test: read the assertion and the record it prints.
- A coverage threshold failure: the thresholds in `vite.config.ts` are a
  ratchet. Add tests for the new code; never lower the threshold.
- The same step writes `test-results/vitest-junit.xml`, which the timing report
  consumes.

### `test:performance`

`npm run test:performance` fails when the suite total or the slowest single test
exceeds `config/test-performance.json`. Remove real waiting, split the slow
test, or raise the budget with a written reason.

### `bundle:check`

`npm run build` runs the bundle budget after bundling. A failure names the
budget and the measured size. Shrink the bundle, or raise the limit in
`config/bundle-budgets.json` with a reason. The dependency weight check compares
installed package sizes against `config/dependency-budgets.json`.

### Playwright job

`npm run test:e2e` starts the Vite dev server on port 4173. If the browser
dependency fails, re-run with `npx playwright install --with-deps chromium`. If
a test is flaky, capture the trace artifact before changing the test.

## Escalation

If a required check is failing for infrastructure reasons (runner outage,
registry outage), re-run the job once, then note it in the pull request. Do not
merge with a red required check.
