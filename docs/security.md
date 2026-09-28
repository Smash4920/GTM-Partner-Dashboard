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
| Dynamic scanning (DAST) | `security.yml` job `dast`                 | OWASP ZAP baseline vs `vite preview`                   |
| Issue intake            | `.github/ISSUE_TEMPLATE/*`                | Structured forms, no blank issues                      |
| Label taxonomy          | `.github/labels.yml`                      | priority / type / area; strict sync job                |
| Pull-request discipline | `.github/pull_request_template.md`        | Description, contract, testing, risk, rollback         |

## Controls in detail

### Secret scanning

`secret-scan` runs [gitleaks](https://github.com/gitleaks/gitleaks) via
`gitleaks/gitleaks-action@v3` over the complete commit history
(`fetch-depth: 0`) on every pull request, every push to `main`, and weekly.
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

Severity handling: **FAIL**-level findings fail the job (`fail_action:
true`). **WARN**-level findings do not fail it (`-I`), but they are printed
in the job log and captured in the `zap_scan` artifact with every run.
WARNs are expected today because `vite preview` serves no security headers;
the production hosts (Vercel, GitHub Pages) own those headers. The
intentional ratchet: reduce WARNs by adding a `rules_file_name` policy file
for accepted findings, and remove `-I` once the expected set reaches zero,
so any new warning blocks the merge. `allow_issue_writing: false` keeps the
report out of the issue tracker; the artifact and the job log carry it.

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
   workflow token at the least privileges the workflows declare
   (`security.yml` requests per-job scopes explicitly) and restrict which
   actions can run to those from verified creators if the organization
   offers that control.

## When something fires

- **Secret scan fails:** rotate the exposed credential immediately, remove
  the secret from the branch, and consider history cleanup. The secret
  stays compromised until rotated.
- **Dependency audit fails:** read the advisory, upgrade the affected
  package, and if no fixed release exists, pin a known-good version and
  note the exception in the PR.
- **DAST fails:** reproduce locally with `npm run preview`, confirm the
  finding, fix it or add a justified entry to a ZAP rules file (wire it via
  `rules_file_name`), and keep the ratchet moving.

## Keeping this page true

Governance files drift when they are not reviewed. When you add a workflow,
change a label category, or alter the Dependabot/Renovate split, update the
control matrix and the affected section here in the same change. The label
taxonomy file, the issue forms, and this document are owned by
`.github/CODEOWNERS`, so the normal review path applies.
