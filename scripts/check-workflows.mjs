import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';

/**
 * Repository workflow security policy (VAL-SEC-008 through VAL-SEC-013).
 *
 * Every checked-in workflow in .github/workflows is parsed and checked:
 *
 *   - every external `uses:` reference is pinned to a full 40-character
 *     commit SHA (the reviewed version stays in the trailing `# vX` comment
 *     so Dependabot can keep proposing upgrades);
 *   - top-level permissions are `contents: read` or `{}` and job-level write
 *     or id-token scopes appear only in ALLOWED_JOB_WRITES, each with a
 *     recorded reviewer rationale;
 *   - jobs that hold write scopes or secrets run only in trusted contexts:
 *     scheduled/dispatch triggers, an explicit default-branch or author-trust
 *     guard, or a fork-safe pull_request trigger (forks receive a read-only
 *     token). `pull_request_target` and `workflow_run` are forbidden;
 *   - every job declares `timeout-minutes` at or below its reviewed budget in
 *     TIMEOUT_BUDGETS_MINUTES, and no step contains an unbounded wait loop;
 *   - the ZAP baseline scan targets the local `vite preview` build, fails on
 *     new WARN/FAIL findings, and may ignore only the exact rule IDs with
 *     rationale recorded in .zap/rules.tsv -- the blanket `-I` flag is
 *     forbidden;
 *   - gitleaks scans full history and `npm audit --audit-level=high` stays
 *     blocking (no `continue-on-error`) on pull requests, pushes to main,
 *     the weekly schedule, and manual runs;
 *   - the CI e2e job runs the same `npm run test:e2e` command as local, and
 *     the DAST job builds and serves a production preview with the canonical
 *     flags.
 *
 * Remote GitHub settings (branch protection, token defaults) cannot be
 * expressed in a repository file and remain unverified; see docs/security.md.
 */

const WORKFLOWS_DIRECTORY = '.github/workflows';

export const ZAP_RULES_FILE = '.zap/rules.tsv';
export const ZAP_TARGET = 'http://127.0.0.1:4173/';
export const PREVIEW_FLAGS = '--host 127.0.0.1 --port 4173 --strictPort';

const SHA_REFERENCE = /^[0-9a-f]{40}$/;
const FORBIDDEN_TRIGGERS = ['pull_request_target', 'workflow_run'];
const TRUSTED_ONLY_TRIGGERS = new Set(['schedule', 'workflow_dispatch']);
const ZAP_THRESHOLDS = new Set(['IGNORE', 'WARN', 'FAIL', 'INFO', 'OFF']);
// Whole-rule localhost-preview acceptances, reviewed on 2026-10-03.
// Unknown WARN/FAIL findings retain the scanner's blocking defaults.
const REVIEWED_ZAP_RULE_IDS = new Set([
  '10020',
  '10021',
  '10038',
  '10049',
  '10063',
  '10096',
  '10109',
  '90004',
]);
// `\b` after the condition would never fire for `:`, the shell no-op builtin,
// because a non-word character followed by `;` or whitespace has no word
// boundary — so `while :; do` must be matched with a lookahead instead.
const UNBOUNDED_LOOP_PATTERNS = [
  /\bwhile\s+(?:true|:)(?=\s|;|$)/,
  /\buntil\s+(?:true|:)(?=\s|;|$)/,
  /\bfor\s*\(\(\s*;\s*;\s*\)\)/,
];

/**
 * Reviewed job-level write and id-token scopes. Top-level permissions stay
 * at `contents: read` (or `{}`); any scope a job escalates must be listed
 * here with the rationale a reviewer accepted. Removing a scope from a job
 * without removing its entry fails as a stale allowlist entry.
 */
export const ALLOWED_JOB_WRITES = [
  {
    workflow: 'ci.yml',
    job: 'verify',
    permission: 'checks',
    reason:
      'dorny/test-reporter publishes the JUnit report as a check run; the step is skipped for cross-repository pull requests, and fork pull requests receive a read-only token.',
  },
  {
    workflow: 'deploy-pages.yml',
    job: 'deploy',
    permission: 'pages',
    reason:
      'GitHub Pages deployment requires pages: write; the job is manual-only and guarded to refs/heads/main.',
  },
  {
    workflow: 'deploy-pages.yml',
    job: 'deploy',
    permission: 'id-token',
    reason:
      'GitHub Pages deployment authenticates through OIDC; the job is manual-only and guarded to refs/heads/main.',
  },
  {
    workflow: 'droid-review.yml',
    job: 'droid-review',
    permission: 'pull-requests',
    reason:
      'Automated review posts pull-request comments; cross-repository pull requests are skipped and forks receive a read-only token.',
  },
  {
    workflow: 'droid-review.yml',
    job: 'droid-review',
    permission: 'issues',
    reason:
      'Automated review may comment on linked issues; same trust boundary as the pull-request scope.',
  },
  {
    workflow: 'droid-review.yml',
    job: 'droid-review',
    permission: 'id-token',
    reason:
      'The review action authenticates to its service through OIDC; cross-repository pull requests are skipped.',
  },
  {
    workflow: 'droid.yml',
    job: 'droid',
    permission: 'contents',
    reason:
      'The on-demand assistant pushes commits when asked; every trigger branch is guarded by author_association so untrusted comments or content cannot invoke it.',
  },
  {
    workflow: 'droid.yml',
    job: 'droid',
    permission: 'pull-requests',
    reason: 'The on-demand assistant edits pull requests; guarded by author_association.',
  },
  {
    workflow: 'droid.yml',
    job: 'droid',
    permission: 'issues',
    reason: 'The on-demand assistant edits issues; guarded by author_association.',
  },
  {
    workflow: 'droid.yml',
    job: 'droid',
    permission: 'id-token',
    reason:
      'The on-demand assistant authenticates to its service through OIDC; guarded by author_association.',
  },
  {
    workflow: 'error-to-insight.yml',
    job: 'sync-sentry-errors',
    permission: 'issues',
    reason:
      'The sync creates GitHub issues from unresolved Sentry errors; triggers are limited to the hourly schedule and manual dispatch.',
  },
  {
    workflow: 'release-please.yml',
    job: 'release-please',
    permission: 'contents',
    reason:
      'Release automation tags releases and pushes changelog commits; the job is guarded to refs/heads/main.',
  },
  {
    workflow: 'release-please.yml',
    job: 'release-please',
    permission: 'pull-requests',
    reason:
      'Release automation opens and updates the release pull request; the job is guarded to refs/heads/main.',
  },
  {
    workflow: 'security.yml',
    job: 'secret-scan',
    permission: 'pull-requests',
    reason:
      'gitleaks comments findings on pull requests; fork pull requests receive a read-only token, so the scope is inert for untrusted code.',
  },
  {
    workflow: 'security.yml',
    job: 'secret-scan',
    permission: 'actions',
    reason:
      'gitleaks uploads its SARIF report as a run artifact; fork pull requests receive a read-only token.',
  },
  {
    workflow: 'security.yml',
    job: 'dast',
    permission: 'actions',
    reason:
      'The ZAP baseline action attaches the zap_scan report as a run artifact; the job uses no secrets, and fork pull requests receive a read-only token.',
  },
  {
    workflow: 'security.yml',
    job: 'label-taxonomy',
    permission: 'issues',
    reason:
      'The strict label sync rewrites repository labels; the job is guarded to the default branch and never runs for pull requests.',
  },
];

/**
 * Reviewed per-job timeout budgets in minutes. Every job must declare
 * `timeout-minutes` at or below its budget; a job without a budget entry (or
 * a budget without a job) fails the check.
 */
export const TIMEOUT_BUDGETS_MINUTES = {
  'ci.yml': { verify: 30, e2e: 45 },
  'deploy-pages.yml': { build: 15, deploy: 15 },
  'droid-review.yml': { 'droid-review': 30 },
  'droid.yml': { droid: 30 },
  'error-to-insight.yml': { 'sync-sentry-errors': 5 },
  'release-please.yml': { 'release-please': 10 },
  'security.yml': {
    'secret-scan': 15,
    'dependency-audit': 10,
    dast: 30,
    'label-taxonomy': 10,
  },
};

/**
 * Guards that keep state-changing or secret-bearing jobs inside trusted
 * contexts. `jobIfMustContain` tokens must appear in the normalized job-level
 * `if` expression; `steps` pins conditions on individual steps. A job with
 * allowlisted write scopes needs an entry here unless its workflow triggers
 * are all trusted (schedule or manual dispatch).
 */
export const TRUSTED_TRIGGER_GUARDS = [
  {
    workflow: 'ci.yml',
    job: 'verify',
    context:
      'Fork pull requests receive a read-only token, and the check-run publish step is additionally skipped for cross-repository pull requests.',
    steps: [
      {
        usesIncludes: 'dorny/test-reporter@',
        ifMustContain: ['github.event.pull_request.head.repo.full_name == github.repository'],
      },
    ],
  },
  {
    workflow: 'deploy-pages.yml',
    job: 'build',
    context: 'Manual deployment builds only from the default branch.',
    jobIfMustContain: ["github.ref == 'refs/heads/main'"],
  },
  {
    workflow: 'deploy-pages.yml',
    job: 'deploy',
    context: 'Manual deployment publishes only from the default branch.',
    jobIfMustContain: ["github.ref == 'refs/heads/main'"],
  },
  {
    workflow: 'droid-review.yml',
    job: 'droid-review',
    context:
      'Automated review holds a service credential, so cross-repository (fork) pull requests are skipped; the remaining pull_request trigger receives a read-only token for forks.',
    jobIfMustContain: ['github.event.pull_request.head.repo.full_name == github.repository'],
  },
  {
    workflow: 'droid.yml',
    job: 'droid',
    context:
      'Comment-, review-, issue-, and pull-request-content triggers are untrusted input, so every branch of the condition requires an OWNER, MEMBER, or COLLABORATOR author before the secret-bearing job runs.',
    jobIfMustContain: [
      'github.event.comment.author_association',
      'github.event.issue.author_association',
      'github.event.review.author_association',
      'github.event.pull_request.author_association',
    ],
  },
  {
    workflow: 'release-please.yml',
    job: 'release-please',
    context: 'Release publication runs only on the default branch.',
    jobIfMustContain: ["github.ref == 'refs/heads/main'"],
  },
  {
    workflow: 'security.yml',
    job: 'secret-scan',
    context:
      'Secret scanning runs on pull requests by design; fork pull requests receive a read-only token, so its comment and artifact write scopes are inert for untrusted code.',
  },
  {
    workflow: 'security.yml',
    job: 'dast',
    context:
      'The ZAP baseline uses no secrets; fork pull requests receive a read-only token, so the artifact write scope is inert for untrusted code.',
  },
  {
    workflow: 'security.yml',
    job: 'label-taxonomy',
    context: 'Label synchronization rewrites repository state only from the default branch.',
    jobIfMustContain: ["github.ref == 'refs/heads/main'", "!= 'pull_request'"],
  },
];

function normalizeExpression(value) {
  return String(value ?? '').replace(/\s+/g, ' ');
}

function triggerNames(on) {
  if (typeof on === 'string') {
    return [on];
  }
  if (Array.isArray(on)) {
    return on.filter((entry) => typeof entry === 'string');
  }
  if (on && typeof on === 'object') {
    return Object.keys(on);
  }
  return [];
}

function isExternalReference(uses) {
  return !uses.startsWith('./') && !uses.startsWith('docker://') && !uses.startsWith('docker:');
}

function collectJobEntries(document) {
  if (!document || typeof document !== 'object' || !document.jobs) {
    return [];
  }
  return Object.entries(document.jobs);
}

function checkActionPins(file, document, violations, inventory) {
  const checkReference = (jobName, uses) => {
    inventory.actions.push({ file, job: jobName, uses });
    if (!isExternalReference(uses)) {
      return;
    }
    const reference = uses.includes('@') ? uses.slice(uses.lastIndexOf('@') + 1) : '';
    if (!SHA_REFERENCE.test(reference)) {
      violations.push(
        `${file}: job '${jobName}' uses mutable action reference '${uses}'; pin external actions to a reviewed full 40-character commit SHA`,
      );
    }
  };

  for (const [jobName, job] of collectJobEntries(document)) {
    if (typeof job.uses === 'string') {
      checkReference(jobName, job.uses);
    }
    for (const step of job.steps ?? []) {
      if (step && typeof step.uses === 'string') {
        checkReference(jobName, step.uses);
      }
    }
  }
}

function checkPermissions(file, document, violations, inventory, allowedJobWrites, usedAllowlist) {
  const topLevel = document.permissions;
  if (topLevel === undefined || topLevel === null) {
    violations.push(
      `${file}: declares no top-level permissions; use 'contents: read' (or '{}' when nothing is needed) and escalate per job`,
    );
  } else if (typeof topLevel !== 'object' || Array.isArray(topLevel)) {
    violations.push(`${file}: top-level permissions must be a map such as 'contents: read'`);
  } else {
    for (const [scope, value] of Object.entries(topLevel)) {
      if (!(scope === 'contents' && value === 'read')) {
        violations.push(
          `${file}: top-level permission '${scope}: ${value}' must be 'read'; write and id-token scopes belong on allowlisted jobs`,
        );
      }
    }
  }

  for (const [jobName, job] of collectJobEntries(document)) {
    const permissions = job.permissions ?? {};
    inventory.jobs.push({
      file,
      job: jobName,
      permissions: Object.entries(permissions)
        .map(([scope, value]) => `${scope}: ${value}`)
        .join(', '),
    });
    for (const [scope, value] of Object.entries(permissions)) {
      if (value === 'write' || (scope === 'id-token' && value !== 'none')) {
        const allowed = allowedJobWrites.find(
          (entry) => entry.workflow === file && entry.job === jobName && entry.permission === scope,
        );
        if (!allowed) {
          violations.push(
            `${file}: job '${jobName}' requests '${scope}: ${value}', which is not on the reviewed allowlist in scripts/check-workflows.mjs`,
          );
        } else {
          usedAllowlist.add(allowed);
        }
      }
    }
  }
}

function checkTimeouts(file, document, violations, inventory, timeoutBudgets) {
  const budgets = timeoutBudgets[file];
  if (!budgets) {
    violations.push(`${file}: has no reviewed timeout budgets in TIMEOUT_BUDGETS_MINUTES`);
    return;
  }

  const seen = new Set();
  for (const [jobName, job] of collectJobEntries(document)) {
    seen.add(jobName);
    const budget = budgets[jobName];
    const timeoutEntry = inventory.jobs.find(
      (entry) => entry.file === file && entry.job === jobName,
    );
    if (budget === undefined) {
      violations.push(`${file}: job '${jobName}' has no reviewed timeout budget`);
      continue;
    }
    const timeout = job['timeout-minutes'];
    if (timeout === undefined) {
      violations.push(`${file}: job '${jobName}' declares no timeout-minutes (budget ${budget})`);
    } else if (!Number.isInteger(timeout) || timeout <= 0) {
      violations.push(`${file}: job '${jobName}' timeout-minutes must be a positive integer`);
    } else if (timeout > budget) {
      violations.push(
        `${file}: job '${jobName}' timeout-minutes ${timeout} exceeds the reviewed budget of ${budget}`,
      );
    }
    if (timeoutEntry) {
      timeoutEntry.timeout = `${timeout ?? 'missing'} (budget ${budget})`;
    }
  }

  for (const budgetedJob of Object.keys(budgets)) {
    if (!seen.has(budgetedJob)) {
      violations.push(
        `${file}: stale timeout budget for job '${budgetedJob}', which no longer exists`,
      );
    }
  }
}

function checkStartupLoops(file, document, violations) {
  for (const [jobName, job] of collectJobEntries(document)) {
    for (const step of job.steps ?? []) {
      const run = typeof step?.run === 'string' ? step.run : '';
      for (const pattern of UNBOUNDED_LOOP_PATTERNS) {
        if (pattern.test(run)) {
          violations.push(
            `${file}: job '${jobName}' contains an unbounded loop (${pattern.source}); scanner and server startup waits must be bounded`,
          );
        }
      }
    }
  }
}

function checkTrustedTriggers(file, document, violations, guards) {
  const triggers = triggerNames(document.on);
  for (const forbidden of FORBIDDEN_TRIGGERS) {
    if (triggers.includes(forbidden)) {
      violations.push(
        `${file}: uses the '${forbidden}' trigger, which runs untrusted code with a write token; it is forbidden`,
      );
    }
  }

  for (const guard of guards.filter((entry) => entry.workflow === file)) {
    const job = document.jobs?.[guard.job];
    if (!job) {
      violations.push(`${file}: stale trusted-trigger guard for job '${guard.job}'`);
      continue;
    }
    const jobIf = normalizeExpression(job.if);
    for (const token of guard.jobIfMustContain ?? []) {
      if (!jobIf.includes(normalizeExpression(token))) {
        violations.push(
          `${file}: job '${guard.job}' is missing required guard '${token}' (${guard.context})`,
        );
      }
    }
    for (const stepGuard of guard.steps ?? []) {
      const step = (job.steps ?? []).find(
        (candidate) =>
          typeof candidate?.uses === 'string' && candidate.uses.includes(stepGuard.usesIncludes),
      );
      if (!step) {
        violations.push(
          `${file}: job '${guard.job}' has no step using '${stepGuard.usesIncludes}' for guard review`,
        );
        continue;
      }
      const stepIf = normalizeExpression(step.if);
      for (const token of stepGuard.ifMustContain) {
        if (!stepIf.includes(normalizeExpression(token))) {
          violations.push(
            `${file}: step '${stepGuard.usesIncludes}' in job '${guard.job}' is missing required guard '${token}' (${guard.context})`,
          );
        }
      }
    }
  }
}

function checkWriteJobCoverage(file, document, violations, allowedJobWrites, guards) {
  const triggers = triggerNames(document.on);
  const trustedOnly =
    triggers.length > 0 && triggers.every((trigger) => TRUSTED_ONLY_TRIGGERS.has(trigger));

  for (const [jobName, job] of collectJobEntries(document)) {
    const hasWrite = Object.entries(job.permissions ?? {}).some(
      ([scope, value]) => value === 'write' || (scope === 'id-token' && value !== 'none'),
    );
    if (!hasWrite) {
      continue;
    }
    const isAllowlisted = allowedJobWrites.some(
      (entry) => entry.workflow === file && entry.job === jobName,
    );
    if (!isAllowlisted) {
      continue; // already reported by checkPermissions
    }
    const guarded = guards.some((entry) => entry.workflow === file && entry.job === jobName);
    if (!guarded && !trustedOnly) {
      violations.push(
        `${file}: job '${jobName}' holds write scopes but has no trusted-trigger guard and its triggers are not limited to schedule/dispatch`,
      );
    }
  }
}

export function parseZapRules(text) {
  const entries = [];
  const violations = [];

  text.split('\n').forEach((line, index) => {
    const trimmed = line.trimEnd();
    if (trimmed === '' || trimmed.startsWith('#')) {
      return;
    }
    const [id, threshold, ...rationaleParts] = trimmed.split('\t');
    const rationale = rationaleParts.join('\t').trim();
    if (!/^\d+$/.test(id ?? '') || !ZAP_THRESHOLDS.has(threshold)) {
      violations.push(
        `${ZAP_RULES_FILE}:${index + 1}: malformed rule line '${trimmed}'; expected '<rule-id>\\t<IGNORE|WARN|FAIL|INFO|OFF>\\t<rationale>'`,
      );
      return;
    }
    if (rationale.length < 20) {
      violations.push(
        `${ZAP_RULES_FILE}:${index + 1}: rule ${id} has no checked-in rationale; every suppression needs a reviewer-accepted reason`,
      );
      return;
    }
    entries.push({ id, threshold, rationale });
  });

  return { entries, violations };
}

function checkZapPolicy(documents, violations, inventory, zapRulesText) {
  const file = 'security.yml';
  const document = documents.get(file);
  if (!document) {
    return;
  }
  const dast = document.jobs?.dast;
  if (!dast) {
    violations.push(`${file}: no 'dast' job; the ZAP baseline scan is required`);
    return;
  }

  if (
    dast['continue-on-error'] !== undefined ||
    (dast.steps ?? []).some((step) => step?.['continue-on-error'] !== undefined)
  ) {
    violations.push(`${file}: job 'dast' and its steps must not use continue-on-error`);
  }

  const zapStep = (dast.steps ?? []).find(
    (step) => typeof step?.uses === 'string' && step.uses.includes('zaproxy/action-baseline@'),
  );
  if (!zapStep) {
    violations.push(`${file}: job 'dast' has no zaproxy/action-baseline step`);
    return;
  }

  const options = zapStep.with ?? {};
  if (options.target !== ZAP_TARGET) {
    violations.push(
      `${file}: ZAP baseline must scan the local production preview at ${ZAP_TARGET}, not '${options.target}'`,
    );
  }
  const cmdOptions = String(options.cmd_options ?? '');
  const usesBlanketIgnore = cmdOptions
    .split(/\s+/)
    .some((token) => token.startsWith('-') && token.slice(1).includes('I'));
  if (usesBlanketIgnore) {
    violations.push(
      `${file}: ZAP cmd_options must not use '-I' (blanket WARN suppression); accepted findings belong in ${ZAP_RULES_FILE} with per-rule rationale`,
    );
  }
  if (options.fail_action !== true) {
    violations.push(
      `${file}: ZAP baseline requires fail_action: true so new WARN/FAIL findings fail the job`,
    );
  }
  if (options.allow_issue_writing !== false) {
    violations.push(`${file}: ZAP baseline requires allow_issue_writing: false`);
  }
  if (options.rules_file_name !== ZAP_RULES_FILE) {
    violations.push(
      `${file}: ZAP baseline must reference the reviewed rules file via rules_file_name: ${ZAP_RULES_FILE}`,
    );
  }

  if (zapRulesText === undefined) {
    violations.push(`${ZAP_RULES_FILE}: reviewed ZAP rules file does not exist`);
  } else {
    const { entries, violations: ruleViolations } = parseZapRules(zapRulesText);
    violations.push(...ruleViolations);
    const seen = new Set();
    for (const { id, threshold } of entries) {
      if (!REVIEWED_ZAP_RULE_IDS.has(id)) {
        violations.push(
          `${ZAP_RULES_FILE}: unreviewed rule ${id}; unknown WARN/FAIL remain blocking`,
        );
      }
      if (seen.has(id)) {
        violations.push(`${ZAP_RULES_FILE}: duplicate rule ${id}`);
      }
      if (threshold !== 'IGNORE') {
        violations.push(`${ZAP_RULES_FILE}: reviewed rule ${id} must use IGNORE`);
      }
      seen.add(id);
    }
    for (const id of REVIEWED_ZAP_RULE_IDS) {
      if (!seen.has(id)) {
        violations.push(`${ZAP_RULES_FILE}: missing reviewed rule ${id}`);
      }
    }
    inventory.zapRules = entries;
  }

  const serveStep = (dast.steps ?? []).find(
    (step) => typeof step?.run === 'string' && step.run.includes('preview'),
  );
  if (!serveStep) {
    violations.push(`${file}: job 'dast' must serve the production build with vite preview`);
  } else {
    if (!serveStep.run.includes(PREVIEW_FLAGS)) {
      violations.push(
        `${file}: job 'dast' must serve the production preview with the canonical '${PREVIEW_FLAGS}' flags`,
      );
    }
    if (serveStep.env?.BASE_PATH !== '/') {
      violations.push(
        `${file}: job 'dast' must serve with BASE_PATH=/ to match its root-base production build`,
      );
    }
    if (
      !/^\s*(?:node scripts\/check-preview-assets\.mjs|if ! node scripts\/check-preview-assets\.mjs; then)\s*$/m.test(
        serveStep.run,
      )
    ) {
      violations.push(
        `${file}: job 'dast' must check initial module and style assets with the bounded scripts/check-preview-assets.mjs readiness command`,
      );
    }
  }

  const buildStep = (dast.steps ?? []).find(
    (step) => typeof step?.run === 'string' && step.run.includes('npm run build'),
  );
  if (!buildStep || buildStep.env?.BASE_PATH !== '/') {
    violations.push(
      `${file}: job 'dast' must build with BASE_PATH=/ so the preview serves at the server root`,
    );
  }
}

function checkBlockingScans(documents, violations) {
  const file = 'security.yml';
  const document = documents.get(file);
  if (!document) {
    return; // run() requires security.yml in the checked-in inventory
  }

  const on = document.on ?? {};
  const triggers = triggerNames(on);
  for (const required of ['pull_request', 'schedule', 'workflow_dispatch']) {
    if (!triggers.includes(required)) {
      violations.push(`${file}: scans must stay blocking on trigger '${required}'`);
    }
  }
  const pushBranches =
    on && typeof on === 'object' && !Array.isArray(on) ? on.push?.branches : undefined;
  if (!Array.isArray(pushBranches) || !pushBranches.includes('main')) {
    violations.push(`${file}: scans must stay blocking on push to main`);
  }

  const secretScan = document.jobs?.['secret-scan'];
  if (!secretScan) {
    violations.push(`${file}: no 'secret-scan' job; gitleaks over full history is required`);
  } else {
    const checkout = (secretScan.steps ?? []).find(
      (step) => typeof step?.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    );
    if (!checkout || checkout.with?.['fetch-depth'] !== 0) {
      violations.push(`${file}: secret-scan must check out full history (fetch-depth: 0)`);
    }
    const gitleaks = (secretScan.steps ?? []).find(
      (step) => typeof step?.uses === 'string' && step.uses.includes('gitleaks/gitleaks-action@'),
    );
    if (!gitleaks) {
      violations.push(`${file}: secret-scan must run gitleaks/gitleaks-action`);
    }
    for (const jobName of ['secret-scan', 'dependency-audit']) {
      const job = document.jobs?.[jobName];
      if (!job) {
        continue;
      }
      if (job['continue-on-error'] !== undefined) {
        violations.push(`${file}: job '${jobName}' must not use continue-on-error`);
      }
      for (const step of job.steps ?? []) {
        if (step?.['continue-on-error'] !== undefined) {
          violations.push(
            `${file}: job '${jobName}' step '${step.name ?? step.uses ?? step.run}' must not use continue-on-error`,
          );
        }
      }
    }
  }

  const audit = document.jobs?.['dependency-audit'];
  if (!audit) {
    violations.push(`${file}: no 'dependency-audit' job; the npm audit gate is required`);
  } else {
    const hasAuditGate = (audit.steps ?? []).some(
      (step) => typeof step?.run === 'string' && step.run.includes('npm audit --audit-level=high'),
    );
    if (!hasAuditGate) {
      violations.push(`${file}: dependency-audit must run 'npm audit --audit-level=high'`);
    }
  }
}

function checkCommandParity(documents, violations) {
  const ci = documents.get('ci.yml');
  if (!ci) {
    return; // run() requires ci.yml in the checked-in inventory
  }
  const e2e = ci.jobs?.e2e;
  if (!e2e) {
    violations.push(`ci.yml: no 'e2e' job; CI must run the browser suite`);
  } else {
    const runsLocalCommand = (e2e.steps ?? []).some(
      (step) => typeof step?.run === 'string' && step.run.trim() === 'npm run test:e2e',
    );
    if (!runsLocalCommand) {
      violations.push(
        `ci.yml: job 'e2e' must run the same 'npm run test:e2e' command as local validation`,
      );
    }
  }
}

/**
 * Check parsed workflow sources against the repository workflow policy.
 * `workflowSources` is an array of `{ file, text }`; `zapRulesText` is the
 * contents of ZAP_RULES_FILE or undefined when the file is absent.
 */
export function checkWorkflowSources({
  workflowSources,
  zapRulesText,
  allowedJobWrites = ALLOWED_JOB_WRITES,
  timeoutBudgets = TIMEOUT_BUDGETS_MINUTES,
  trustedTriggerGuards = TRUSTED_TRIGGER_GUARDS,
}) {
  const violations = [];
  const inventory = { actions: [], jobs: [], zapRules: [], guards: trustedTriggerGuards };
  const documents = new Map();

  for (const { file, text } of workflowSources) {
    try {
      documents.set(file, parse(text));
    } catch (error) {
      violations.push(`${file}: workflow does not parse: ${error.message}`);
    }
  }

  const usedAllowlist = new Set();
  for (const [file, document] of documents) {
    if (!document || typeof document !== 'object') {
      violations.push(`${file}: workflow does not parse: empty document`);
      continue;
    }
    checkActionPins(file, document, violations, inventory);
    checkPermissions(file, document, violations, inventory, allowedJobWrites, usedAllowlist);
    checkTimeouts(file, document, violations, inventory, timeoutBudgets);
    checkStartupLoops(file, document, violations);
    checkTrustedTriggers(file, document, violations, trustedTriggerGuards);
    checkWriteJobCoverage(file, document, violations, allowedJobWrites, trustedTriggerGuards);
  }

  for (const entry of allowedJobWrites) {
    if (!usedAllowlist.has(entry)) {
      violations.push(
        `${entry.workflow}: stale allowlist entry for job '${entry.job}' permission '${entry.permission}'; remove it or restore the scope`,
      );
    }
  }

  checkZapPolicy(documents, violations, inventory, zapRulesText);
  checkBlockingScans(documents, violations);
  checkCommandParity(documents, violations);

  return violations;
}

function printInventory(workflowSources, violations) {
  const inventory = { actions: [], jobs: [], zapRules: [] };
  const documents = new Map();
  for (const { file, text } of workflowSources) {
    try {
      documents.set(file, parse(text));
    } catch {
      continue;
    }
  }
  for (const [file, document] of documents) {
    if (!document || typeof document !== 'object') {
      continue;
    }
    checkActionPins(file, document, [], inventory);
    checkPermissions(file, document, [], inventory, ALLOWED_JOB_WRITES, new Set());
    checkTimeouts(file, document, [], inventory, TIMEOUT_BUDGETS_MINUTES);
  }
  if (existsSync(resolve(ZAP_RULES_FILE))) {
    inventory.zapRules = parseZapRules(readFileSync(resolve(ZAP_RULES_FILE), 'utf8')).entries;
  }

  console.log(`Workflow policy inventory (${workflowSources.length} workflows):`);
  for (const { file } of workflowSources) {
    const jobs = inventory.jobs.filter((entry) => entry.file === file);
    console.log(`\n${file}`);
    for (const job of jobs) {
      console.log(
        `  job '${job.job}': timeout ${job.timeout ?? 'n/a'}; permissions [${job.permissions || 'inherited'}]`,
      );
    }
  }

  console.log('\nExternal action pins:');
  const seen = new Set();
  for (const action of inventory.actions) {
    if (isExternalReference(action.uses) && !seen.has(action.uses)) {
      seen.add(action.uses);
      console.log(`  ${action.uses}`);
    }
  }

  console.log('\nTrusted-trigger guards for write/secret-bearing jobs:');
  for (const guard of TRUSTED_TRIGGER_GUARDS) {
    console.log(`  ${guard.workflow}/${guard.job}: ${guard.context}`);
  }

  console.log('\nZAP rules baseline (reviewed suppressions):');
  if (inventory.zapRules.length === 0) {
    console.log('  (none; any WARN or FAIL finding fails the scan)');
  }
  for (const rule of inventory.zapRules) {
    console.log(`  ${rule.id}\t${rule.threshold}\t${rule.rationale}`);
  }

  console.log(
    `\nRemote GitHub settings (branch protection, token defaults, environments) are not verifiable from repository files and remain unverified.${violations.length > 0 ? '' : ''}`,
  );
}

const REQUIRED_WORKFLOWS = ['ci.yml', 'security.yml'];

function run() {
  const directory = resolve(WORKFLOWS_DIRECTORY);
  const workflowSources = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(yml|yaml)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({ file: name, text: readFileSync(join(directory, name), 'utf8') }));

  if (workflowSources.length === 0) {
    console.error(`Workflow policy check failed: no workflows found in ${WORKFLOWS_DIRECTORY}.`);
    process.exitCode = 1;
    return;
  }

  const missing = REQUIRED_WORKFLOWS.filter(
    (name) => !workflowSources.some((source) => source.file === name),
  );
  if (missing.length > 0) {
    console.error(
      `Workflow policy check failed: required workflows missing: ${missing.join(', ')}.`,
    );
    process.exitCode = 1;
    return;
  }

  const zapRulesPath = resolve(ZAP_RULES_FILE);
  const zapRulesText = existsSync(zapRulesPath) ? readFileSync(zapRulesPath, 'utf8') : undefined;

  const violations = checkWorkflowSources({ workflowSources, zapRulesText });
  printInventory(workflowSources, violations);

  if (violations.length === 0) {
    console.log('\nWorkflow policy check passed: every workflow satisfies the security policy.');
    return;
  }

  console.error('\nWorkflow policy violations:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
