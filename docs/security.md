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

## Control matrix

| Control                 | Where                                     | Enforced by                                            |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Secret scanning         | `security.yml` job `secret-scan`          | gitleaks over full history, weekly + per change        |
| Secret hygiene          | `.gitignore`                              | `.env*` ignored, `.env.example` stays trackable        |
| Code ownership          | `.github/CODEOWNERS`                      | @Smash4920 owns every path; no gaps                    |
| Dependency updates      | `.github/dependabot.yml`, `renovate.json` | Actions + devcontainers by Dependabot, npm by Renovate |
| Minimum release age     | `renovate.json`, `.github/dependabot.yml` | 7 days general, 14 days for npm majors                 |
| Dependency audit        | `security.yml` job `dependency-audit`     | `npm audit`, fails on high or above                    |
| Dynamic scanning (DAST) | `security.yml` job `dast`                 | OWASP ZAP baseline vs `vite preview`, reviewed rules   |
| Workflow policy         | `scripts/check-workflows.mjs`             | `npm run workflows:check`, locally and in CI           |
| Issue intake            | `.github/ISSUE_TEMPLATE/*`                | Structured forms, no blank issues                      |
| Label taxonomy          | `.github/labels.yml`                      | priority / type / area; strict sync job                |
| Pull-request discipline | `.github/pull_request_template.md`        | Description, contract, testing, risk, rollback         |

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
Today's accepted set is four header-hardening alerts raised against
`vite preview`: the preview is a local scan target, not a production host,
and response headers are owned by the production hosts (Vercel, GitHub
Pages). A new WARN means the artifact changed: reproduce locally with
`npm run preview`, fix it, or add a justified rule entry in the same pull
request. `allow_issue_writing: false` keeps the report out of the issue
tracker; the artifact and the job log carry it.

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
  package, and if no fixed release exists, pin a known-good version and
  note the exception in the PR.
- **DAST fails:** reproduce locally with `npm run preview`, confirm the
  finding, fix it or add a justified rule-specific entry to
  `.zap/rules.tsv`, and keep the ratchet moving.
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
