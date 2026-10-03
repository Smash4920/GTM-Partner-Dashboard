# Security governance

This page documents the security and governance controls for the GTM Partner
Dashboard: what lives in the repository, how each control works, and the
GitHub settings a repository file cannot express. When a control changes,
change this page in the same pull request.

The product today is a client-only React dashboard over deterministic mock
data (`README.md`, `docs/migration-plan.md`). There is no backend, no
authentication layer, and no required local environment file. The controls
below are sized for that: they protect the repository and the build chain,
and they will carry over as the data layer moves to production volume.

Roadmap claims follow the same honesty rule: every Production Requirements
row carries a Demo status (Complete, WIP, or Pending) that reports only
verified client behavior, and a separate Production: Prod Only status
wherever a production dependency is intentionally paused. Demo completion
never completes a production dependency.

## Control matrix

| Control                 | Where                                     | Enforced by                                                                |
| ----------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Secret scanning         | `security.yml` job `secret-scan`          | gitleaks over full history, weekly + per change                            |
| Secret hygiene          | `.gitignore`                              | `.env*` ignored, `.env.example` stays trackable                            |
| Code ownership          | `.github/CODEOWNERS`                      | @Smash4920 owns every path; no gaps                                        |
| Dependency updates      | `.github/dependabot.yml`, `renovate.json` | Actions + devcontainers by Dependabot, npm by Renovate                     |
| Minimum release age     | `renovate.json`, `.github/dependabot.yml` | 7 days general, 14 days for npm majors                                     |
| Dependency audit        | `security.yml` job `dependency-audit`     | `npm audit`, fails on high or above                                        |
| Dynamic scanning (DAST) | `security.yml` job `dast`                 | OWASP ZAP baseline vs `vite preview`, reviewed rules                       |
| Workflow policy         | `scripts/check-workflows.mjs`             | `npm run workflows:check`, locally and in CI                               |
| Telemetry egress        | `src/lib/telemetry/`, `vite.config.ts`    | Allowlists + endpoint policy in code, unit/e2e suites, `bundle:check` scan |
| Issue intake            | `.github/ISSUE_TEMPLATE/*`                | Structured forms, no blank issues                                          |
| Label taxonomy          | `.github/labels.yml`                      | priority / type / area; strict sync job                                    |
| Pull-request discipline | `.github/pull_request_template.md`        | Description, contract, testing, risk, rollback                             |

## Controls in detail

### Secret scanning

`secret-scan` runs [gitleaks](https://github.com/gitleaks/gitleaks) via
`gitleaks/gitleaks-action` (pinned to a reviewed commit SHA for v3) over the
complete commit history (`fetch-depth: 0`) on every pull request, every push
to `main`, and weekly.
On a detected secret the job fails, posts a comment on the pull request, and
uploads a SARIF report as a run artifact. If a secret is ever detected, treat
it as exposed regardless of when it leaked: rotate the credential first, then
rewrite history if needed.

`.gitignore` is the first line of defense: `.env` and `.env.*` are ignored,
while `.env.example` (and any `.env.*.example` templates) stay committable so
the documented template can live in the tree. Private key and certificate
extensions (`*.pem`, `*.key`, `*.p12`, `*.pfx`) are ignored too.

The action is free for personal accounts. A `GITLEAKS_LICENSE` secret is
only required if the repository moves into an organization; the workflow
already passes the env var, so adding the secret is the only step.

### Code ownership

`.github/CODEOWNERS` assigns every path to @Smash4920. The catch-all rule
comes first, and more specific rules below it refine the assignment (GitHub
applies the last matching rule). Because there are no gaps, branch
protection can require review from Code Owners on any path. Review of the
provider seam (`src/data/`), the metric specification (`src/lib/`), and the
governance files (`/.github/`) is the priority while the data layer is mid
migration.

### Dependency update automation

Two tools, deliberately split by ecosystem so they never open duplicate
pull requests:

- **Dependabot** (`.github/dependabot.yml`) owns `github-actions` (weekly,
  grouped into one PR) and `devcontainers` (monthly; dormant until a
  manifest exists). Both entries carry a 7-day `cooldown` so action releases
  age before they are proposed. Dependabot also provides security alerts
  and automated security updates for every ecosystem; those are repository
  settings, not parts of this file, and they are never delayed by a
  cooldown.
- **Renovate** (`renovate.json`) owns npm. It groups minor/patch updates
  separately for dev tooling and production dependencies, and enforces the
  minimum release age policy below. The dependency dashboard issue lists
  everything it is holding back.

### Minimum release age policy

Both update tools age their releases before proposing them:

- `renovate.json` sets `minimumReleaseAge`: **7 days** for all npm updates
  and **14 days** for major versions (`matchUpdateTypes: ["major"]`). A
  release that is compromised or unpublished (npm's unpublish window is 72
  hours) is usually caught within a week by the ecosystem, maintainers, or
  registry scanners. By then the release has also been exercised by other
  consumers. Majors carry API breakage on top of supply-chain risk and need
  the coverage and e2e suites to pass against them elsewhere first.
- `.github/dependabot.yml` sets a **7-day `cooldown`** on the ecosystems it
  owns (`github-actions`, `devcontainers`). Dependabot's implicit default is
  3 days; the explicit week matches the npm policy so every ecosystem
  shares one stabilization window.

The gates apply to version updates only. Security updates are never delayed
by them -- a deliberately malicious release does not become safer by
waiting. When an advisory lands while an update is still aging, take the
update immediately after checking the diff, or pin a known-good version.

### Dependency audit

`dependency-audit` runs `npm audit --audit-level=high` against the lockfile
on every pull request, push to `main`, and weekly. Anything rated high or
critical by the npm registry fails the job; moderate findings are visible in
the job output for triage.

As of the 2026-10-03 amendment, the user chose to wait for an official upstream
`braces` fix. The high-severity audit remains blocking: no backport, override,
downgrade, advisory exception, or suppression is approved.

### Dynamic application security testing

The `dast` job builds the production bundle (`BASE_PATH=/` so the preview
serves at the server root), serves it with `npm run preview`, and runs the
OWASP ZAP baseline scan against `http://127.0.0.1:4173/`. The scan is
passive: it spiders the static app, inspects responses, and flags issues
such as missing security headers, cookie flags, and information leaks.

Severity handling: the scan fails on any **new WARN or FAIL** finding
(`fail_action: true`, and the blanket `-I` WARN suppression is removed).
The only accepted findings are the reviewed, rule-specific entries in
`.zap/rules.tsv`: each line names one exact ZAP rule ID, the threshold
override, and the rationale a reviewer accepted. `npm run workflows:check`
rejects the `-I` flag, a missing rules file, and entries without rationale.
The **2026-10-03** approved policy retains `10020`, `10021`, `10038`, and
`10063` and adds only `10049`, `10096`, `10109`, and `90004`. Acceptance covers
each **whole rule ID in the localhost preview scan**, not just the instances
in the historical report:

| Rule ID | Reviewed local-preview rationale                                                                                                                                                                                                       |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `10020` | Missing Anti-clickjacking Header: this client-only demo has no authenticated or sensitive state; production framing policy remains a host concern.                                                                                     |
| `10021` | X-Content-Type-Options Header Missing: preview serves correct static content types; production `nosniff` policy remains a host concern.                                                                                                |
| `10038` | Content Security Policy Header Not Set: CSP remains a production-host control, not waived for production by this preview exception.                                                                                                    |
| `10063` | Permissions Policy Header Not Set: the demo uses no camera, microphone, or geolocation; production policy remains a host concern.                                                                                                      |
| `10049` | Storable but Non-Cacheable Content (informational): public CSS and the sitemap SPA fallback use preview `no-cache` revalidation. No sensitive-data cache leak was demonstrated; this is not a private-data or production cache waiver. |
| `10096` | Timestamp Disclosure–Unix (low severity, low confidence): `1831565813` is the deterministic RNG constant `0x6d2b79f5` in `src/data/mock/rng.ts`, not a sensitive timestamp. This is a false positive; the RNG is unchanged.            |
| `10109` | Modern Web Application (informational): the scanner says no code change is required. Acceptance does not establish rendered-dashboard or AJAX-spider coverage.                                                                         |
| `90004` | Missing Cross-Origin Isolation headers: all COEP, COOP, and CORP subalerts are accepted locally under the whole rule. This is not production header compliance; indiscriminate isolation can break resource and pop-up integrations.   |

Re-review these exceptions when the scan target, data sensitivity, RNG
provenance, integrations, or production hosting changes. The preview is a local
scan target, not a production host; production response-header and cache
controls still require their own review. Unknown WARN/FAIL findings remain
blocking. No severity-wide ignore, `-I`, non-blocking scan step, or dependency
audit waiver is approved. A new finding requires triage and either a fix or
explicit approval for a justified exact-rule policy change.
`allow_issue_writing: false` keeps the report out of the issue tracker; the
artifact and the job log carry it.

These are policy amendments, not vulnerability fixes or retrospective scan
passes. Historical failures remain failures. Docker and Podman CLIs are
unavailable locally, so a full local ZAP baseline has not run. Hosted results
under the amended baseline remain pending separate exact-commit publication
approval; this amendment authorizes no push or manual rerun.

### Telemetry egress privacy

The client is the trust boundary for observability data, so egress is
governed in code and pinned by tests rather than by deployment convention:

- **Master switch.** `telemetry.enabled` is enforced at the single transport
  boundary (`src/lib/telemetry/transport.ts`): off means zero requests,
  beacons, analytics script loads, or lifecycle flushes, while in-process
  health, metrics, and error insights keep working.
- **Analytics is opt-in twice.** Product analytics additionally requires
  `analytics.enabled`, which is off by default pending privacy approval; both
  switches must be on before the analytics script installs or any event
  leaves.
- **Registered fields only.** Every envelope type has a checked-in field
  allowlist (`src/lib/telemetry/allowlist.ts`) enforced before queueing, with
  redaction (`src/lib/redact.ts`) as a second pass. Names, free-form prose,
  raw exception messages and stacks, records, secrets, and query-bearing
  URLs are dropped — error envelopes carry class, fingerprint, category,
  severity, route, and provider, and nothing else.
- **Destination policy.** Production telemetry endpoints must be HTTPS URLs
  on hosts in the checked-in `APPROVED_TELEMETRY_HOSTS` list — intentionally
  empty today, so production telemetry is local-only until a destination is
  approved in a reviewed change. Credentials, query strings, and non-default
  ports are rejected; invalid configuration fails closed with the problem
  surfaced on the health artifact. Plain HTTP is accepted only for loopback
  development collectors, and that exception is compiled out of production
  bundles.
- **No browser webhooks.** Alert dispatch is in-process (registered handlers,
  health checks, error insights). The `VITE_ALERT_ENDPOINT` webhook transport
  was removed; a static policy scan fails the build if it reappears.
- **No public source maps.** Production builds emit no `.map` files and no
  `sourceMappingURL` comments, and the same policy scan verifies the
  artifact.

### Client trust boundary

The browser is untrusted, so every in-browser rule below is presentation, not
enforcement:

- **Partner filtering is not authorization.** Partner View renders only the
  selected partner's Sell With and Allocate opportunities and registrations,
  but the picker that chooses that partner is an untrusted demo presentation
  selector: any visitor can select any partner. Serving external partners
  requires trusted sign-in and server-enforced row access first, so the
  roadmap keeps the picker-removal item at Demo: Pending with the enforcement
  work marked Prod Only.
- **Roster, notifications, and workflow actions are session-only
  simulations.** Turning notifications on or off for a teammate changes
  current-session routing state only — nothing provisions, authorizes,
  revokes, or restores sign-in or data access — and every send is recorded
  locally with the confirmation "Simulated / local only". Nothing is
  delivered, persisted, or written back, and a reload resets it all.
- **Flags are local and non-authoritative.** Product and operational flags
  hide functionality; they never grant a role, widen a demo access scope, or
  select another partner. Evaluation is fail-safe: a fresh value wins, a
  bounded last-known-good cache covers a brief outage, and anything else
  falls back to the registry safe default. The authenticated control plane
  remains Prod Only.
- **Deferred history stays deferred.** The per-manager and per-partner
  close-date-slippage, stage-aging, and category-confidence trend remains
  Pending until immutable historical partner-manager ownership and
  authoritative stage-entry events exist; weekly snapshots, partner-health
  alerts, and forecast reviews are not substitutes.

The production continuation runs in a fixed order — trusted identity, then
the warehouse and scoped API with row-level authorization, then source
ingestion, then persisted writes and audit, then production operations —
because real data must never arrive before server-side enforcement.

### Workflow hardening

`npm run workflows:check` (`scripts/check-workflows.mjs`) parses every
workflow in `.github/workflows/` and enforces the repository's workflow
security policy locally and in CI:

- **Immutable actions.** Every external `uses:` reference is pinned to a
  reviewed full 40-character commit SHA, with the reviewed tag recorded in
  a trailing comment. Dependabot still proposes action upgrades weekly;
  merging one is the review point for the new revision.
- **Least privilege.** Every workflow declares top-level `contents: read`
  (or `{}`). Write and `id-token` scopes exist only on jobs allowlisted in
  the checker, each with a recorded rationale; a stale allowlist entry or
  an unlisted write scope fails the check.
- **Trusted triggers.** `pull_request_target` and `workflow_run` are
  forbidden. State-changing jobs run only in trusted contexts: the Pages
  deployment and release publication are guarded to `refs/heads/main`,
  label sync never runs on a pull request, the error-to-insight sync is
  schedule/dispatch only, and the comment- and content-triggered assistant
  job requires an OWNER, MEMBER, or COLLABORATOR author before it starts.
  Fork pull requests receive a read-only `GITHUB_TOKEN` and no secrets,
  which keeps the gitleaks and ZAP write scopes inert for untrusted code.
- **Finite timeouts.** Every job declares `timeout-minutes` at or below
  its reviewed budget in the checker, and unbounded wait loops are
  rejected (the DAST preview startup loop is bounded at 60 seconds).
  On 2026-10-03, only CI's `e2e` job cap was approved to change from 30 to
  45 minutes. All other job caps, test deadlines, assertions, full axe scans,
  retries, and worker settings remain unchanged: four ordinary workers,
  one serial fixture worker, and two CI retries. Coverage floors remain
  95% statements / 90% branches / 96% functions / 96% lines; unit timing
  limits remain 210,000 ms total / 8,000 ms individual. No sharding or
  stronger runner is approved. This is not a speed fix: historical
  30-minute cancellations stay cancellations, and an actual hosted run
  under the 45-minute cap remains pending separate exact-commit publication
  approval.
- **Blocking scans.** gitleaks scans the full commit history and
  `npm audit --audit-level=high` gates the dependency tree. Both run on
  pull requests, pushes to `main`, the weekly schedule, and manual
  dispatch, and neither may use `continue-on-error`.

Remote GitHub settings -- branch protection, the workflow token's default
permissions, the allowed-actions policy -- cannot be expressed in a
repository file. They are listed below and remain unverified by the local
check.

### Issue intake and the label taxonomy

Issues are filed through structured forms only
(`.github/ISSUE_TEMPLATE/`, `blank_issues_enabled: false`):

- **Bug report** -- symptom, steps, affected view, evidence, and a checkbox
  that routes security problems away from public reports.
- **Feature request** -- problem, proposal, expected data-contract impact,
  and area, matching the migration seam in `docs/migration-plan.md`.
- **Security report** -- a non-sensitive coordination form that points
  reporters at private reporting first (see below).

Every report starts with `needs-triage` plus its type. Triage then applies
exactly one `priority:*`, exactly one `type:*`, and at least one `area:*`
from `.github/labels.yml`. The taxonomy is machine-readable
(`name`/`color`/`description` entries) and is synced strictly by the
`label-taxonomy` job on every push to `main` and weekly: labels that exist on
GitHub but not in the file are deleted, so the file is the single source of
truth. Automated dependency PRs carry `dependencies` (plus `area:build` or
`type:maintenance`) so they are identifiable without manual labeling.

### Pull-request discipline

`.github/pull_request_template.md` asks for the sections `AGENTS.md` already
requires: description, data-contract changes, the exact testing checklist in
CI order, screenshots for UI changes, risk (including partner-data boundary
impact), and a rollback plan. For a client-only app deployed through Vercel
previews with manual GitHub Pages deploys, rollback is normally a revert
commit; the section exists so anything else that needs unwinding is written
down before merge, not discovered after.

## Remote GitHub settings this repository cannot express

Files in this repository can define controls, but several only take effect
when a maintainer flips the matching GitHub setting. Each item below is a
one-time setup step:

1. **Branch protection on `main`.** Settings -> Branches -> Add branch
   protection rule for `main`: require pull requests, require review from
   Code Owners, and require status checks from both `CI` and `Security`
   workflows before merging. Nothing in a repository file can enforce this.
2. **GitHub-native secret scanning and push protection.** Settings ->
   Code security and analysis. Native secret scanning with push protection
   is free for public repositories but requires GitHub Advanced Security
   (paid) for private ones. While this repository is private without GHAS,
   the gitleaks workflow is the compensating control. If the repository
   becomes public or the plan changes, enable native scanning too -- push
   protection blocks the secret before the commit lands.
3. **Dependabot alerts and automated security updates.** Settings -> Code
   security and analysis: enable both. They cover every ecosystem and run
   independently of `.github/dependabot.yml`.
4. **Private vulnerability reporting.** Settings -> Code security and
   analysis -> Private vulnerability reporting: enable it, so the advisory
   link in the issue forms works. Public issues are the wrong channel for
   vulnerability reports.
5. **Renovate installation.** Install the Renovate GitHub App for this
   repository from the GitHub Marketplace and grant it access to
   `Smash4920/GTM-Partner-Dashboard`. Until it is installed,
   `renovate.json` sits inert and the npm age policy does not run.
6. **`GITLEAKS_LICENSE`.** Settings -> Secrets and variables -> Actions: add
   it only if the repository moves to an organization. Personal accounts
   need no license.
7. **Actions permissions.** Settings -> Actions -> General: leave the
   workflow token at the least privileges the workflows declare (every
   workflow now declares `contents: read` at the top and per-job write
   scopes explicitly) and restrict which actions can run to those from
   verified creators if the organization offers that control.

## When something fires

- **Secret scan fails:** rotate the exposed credential immediately, remove
  the secret from the branch, and consider history cleanup. The secret
  stays compromised until rotated.
- **Dependency audit fails:** read the advisory, upgrade the affected
  package when an approved official fix exists, or report the blocker.
  The current `braces` decision is to wait; do not backport, override,
  downgrade, suppress, or waive the high-severity audit.
- **DAST fails:** reproduce locally with `npm run preview`, confirm the
  finding when tooling is available, and fix it or seek explicit approval
  for a justified rule-specific entry to `.zap/rules.tsv`. Do not claim
  a full scan pass from static policy checks or preview inspection.
- **Workflow policy fails:** read the violation from
  `npm run workflows:check`. Either restore the control (action pin,
  permission scope, trigger guard, timeout, ZAP rule) or change the
  reviewed allowlist, budget, or guard in `scripts/check-workflows.mjs`
  with its rationale in the same pull request.

## Keeping this page true

Governance files drift when they are not reviewed. When you add a workflow,
change a label category, or alter the Dependabot/Renovate split, update the
control matrix and the affected section here in the same change. The label
taxonomy file, the issue forms, and this document are owned by
`.github/CODEOWNERS`, so the normal review path applies.
