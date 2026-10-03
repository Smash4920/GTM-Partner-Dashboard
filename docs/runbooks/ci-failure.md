# CI failure runbook

## Signal

A required check in `.github/workflows/ci.yml` is red on a pull request or on
`main`, and the failing step is not obvious from the log tail.

## General steps

1. Read the first failing step in the job log, not the last. Later failures are
   often cascade failures.
2. Reproduce locally with the same command the step runs.
3. Fix the cause, not the symptom. Never lower a coverage threshold, widen a
   budget, or skip a check to make the build green. Report a blocker if the
   regression cannot be fixed within the existing limits.

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

### `test:debt`

Reproduce with `npm run test:debt`. Fix the policy-scanner regression without
relaxing linked-issue requirements.

### `test:build-metrics`

Reproduce with `npm run test:build-metrics`. Check deterministic stage timing,
failed-build reporting, and the 60,000 ms budget; never widen the ceiling.

### `test:sentry-sync`

Reproduce with `npm run test:sentry-sync`. These are local mocked API tests,
not a connected Sentry service. Restore idempotency, trust, and bounded issue
creation behavior without introducing credentials.

### `debt:check`

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

Three failures are possible. `quality:check` rejects weakened effective
ratchets or missing/reordered/non-blocking gate steps and handoff checklists.
Restore the policy, never reduce it. Generated documentation under `docs/generated/` is
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
exceeds `config/test-performance.json` (210,000 ms total, 8,000 ms per test).
Remove unnecessary waiting or repeated setup while preserving assertions.
If that cannot restore the budget, report the blocker.

### `bundle:check`

`npm run build` runs the bundle budget after bundling. A failure names the
budget and the measured size. Shrink the bundle without changing behavior or
report the blocker; never widen `config/bundle-budgets.json`. The dependency weight check compares
installed package sizes against `config/dependency-budgets.json`.

### `workflows:check`

Reproduce with `npm run workflows:check`. Restore immutable action revisions,
least privilege, trusted write triggers, finite timeouts, blocking scans,
reviewed ZAP rules, and local/CI production-preview parity. This static policy
does not verify remote repository settings or execute hosted scanners.

The 2026-10-03 local-preview amendment accepts exactly eight whole ZAP rule IDs:
`10020`, `10021`, `10038`, `10063`, plus `10049`, `10096`, `10109`, and `90004`.
Scope is the whole rule in the localhost preview scan, not production compliance:
`90004` includes all COEP/COOP/CORP subalerts; `10049` accepts public-asset
revalidation, not private-data caching; `10096` is the deterministic RNG constant
`1831565813` / `0x6d2b79f5` false positive, not a reason to change the RNG;
`10109` makes no rendered-dashboard or AJAX-spider coverage claim. See
[`security.md`](../security.md) for reviewed rationales. Re-review when target,
data sensitivity, RNG provenance, integrations, or production hosting changes.
Unknown WARN/FAIL remain blocking; do not use `-I` or severity-wide suppression.
Docker and Podman CLIs are unavailable locally, so full local ZAP remains unrun.
The amended hosted baseline outcome is pending separate exact-commit publication
approval; static policy checks do not turn historical scan failures into passes.

The high-severity dependency audit also remains blocking. The user chose to wait
for the official upstream `braces` fix; no backport, override, downgrade,
advisory exception, or suppression is approved.

### Playwright job

`npm run test:e2e` builds production assets and starts strict Vite production
preview on `127.0.0.1:4173`, with `BASE_PATH=/` and no HMR. Serial port-owning
fixtures finish before ordinary preview starts. Ordinary local and CI runs use
four workers; serial fixtures use one worker. CI keeps two retries and its
reviewed 45-minute `e2e` job cap, approved on 2026-10-03 to replace 30 minutes.
All other job caps, individual test deadlines, assertions, full axe scans,
workers, and retries are unchanged, as are coverage floors 95/90/96/96
(statements/branches/functions/lines) and unit timing limits 210,000/8,000 ms
(total/individual). No sharding or stronger runner is approved.
This is a policy amendment, not a speed fix: historical measurements and
30-minute cancellations are unchanged. Actual hosted 45-minute execution is
pending separate exact-commit publication approval.
Inspect `build-metrics/e2e-timing.json` for actual wall time and phase outcomes,
and `build-metrics/e2e-preview-lifecycle.json` for verified PID teardown. If the browser
dependency fails, re-run with `npx playwright install --with-deps chromium`. If
a test is flaky, capture the trace artifact before changing the test.

## Escalation

If a required check is failing for infrastructure reasons (runner outage,
registry outage), re-run the job once, then note it in the pull request. Do not
merge with a red required check.

For this amendment, no new push, hosted rerun, merge, deployment, or settings
change is authorized. Preserve prior failures and cancellations and seek
separate exact-commit publication approval for new hosted evidence.
