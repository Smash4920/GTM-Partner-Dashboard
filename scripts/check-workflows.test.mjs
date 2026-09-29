import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALLOWED_JOB_WRITES,
  TIMEOUT_BUDGETS_MINUTES,
  TRUSTED_TRIGGER_GUARDS,
  ZAP_RULES_FILE,
  checkWorkflowSources,
  parseZapRules,
} from './check-workflows.mjs';

const PINNED_CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';

function compliantWorkflow(overrides = {}) {
  const job = {
    'runs-on': 'ubuntu-latest',
    'timeout-minutes': 10,
    steps: [{ uses: PINNED_CHECKOUT }, { run: 'npm ci' }],
    ...(overrides.job ?? {}),
  };
  const workflow = {
    name: 'Fixture',
    on: { pull_request: null },
    permissions: { contents: 'read' },
    jobs: { verify: job },
  };
  return {
    file: 'fixture.yml',
    text: null, // filled below
    workflow,
  };
}

function source(overrides = {}) {
  const { file, workflow } = compliantWorkflow(overrides);
  return { file, text: toYaml(workflow) };
}

// Minimal YAML emitter for the fixture shapes used below. The checker tests
// only need plain mappings, lists, strings, numbers, booleans, and null.
function toYaml(value, indent = 0) {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry !== null && typeof entry === 'object') {
          const rendered = toYaml(entry, indent + 1);
          return `${pad}- ${rendered.trimStart()}`;
        }
        return `${pad}- ${scalar(entry)}`;
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${pad}{}`;
    }
    return entries
      .map(([key, entry]) => {
        if (entry !== null && typeof entry === 'object') {
          if (!Array.isArray(entry) && Object.keys(entry).length === 0) {
            return `${pad}${key}: {}`;
          }
          return `${pad}${key}:\n${toYaml(entry, indent + 1)}`;
        }
        return `${pad}${key}: ${scalar(entry)}`;
      })
      .join('\n');
  }
  return `${pad}${scalar(value)}`;
}

function scalar(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

function checkOne(overrides = {}, options = {}) {
  return checkWorkflowSources({
    workflowSources: [source(overrides)],
    allowedJobWrites: options.allowedJobWrites ?? [],
    timeoutBudgets: options.timeoutBudgets ?? { 'fixture.yml': { verify: 30 } },
    trustedTriggerGuards: options.trustedTriggerGuards ?? [],
    zapRulesText: options.zapRulesText,
  });
}

describe('workflow syntax and action pinning (VAL-SEC-008)', () => {
  it('accepts a workflow whose actions use full 40-character commit SHAs', () => {
    assert.deepEqual(checkOne(), []);
  });

  it('rejects workflows that do not parse', () => {
    const violations = checkWorkflowSources({
      workflowSources: [{ file: 'broken.yml', text: 'jobs: [unclosed' }],
      allowedJobWrites: [],
      timeoutBudgets: {},
      trustedTriggerGuards: [],
    });
    assert.equal(violations.length, 1);
    assert.match(violations[0], /broken\.yml: workflow does not parse/);
  });

  for (const [uses, label] of [
    ['actions/checkout@v7', 'major tag'],
    ['actions/checkout@main', 'branch'],
    ['googleapis/release-please-action@v5.1.3', 'release tag'],
    ['actions/checkout', 'missing reference'],
    ['actions/checkout@3d3c42e', 'short SHA'],
  ]) {
    it(`rejects mutable or invalid action reference ${uses} (${label})`, () => {
      const violations = checkOne({
        job: { steps: [{ uses }] },
      });
      assert.equal(violations.length, 1);
      assert.match(violations[0], /mutable action reference/);
    });
  }

  it('accepts local and docker step references without pinning', () => {
    const violations = checkOne({
      job: {
        steps: [
          { uses: './.github/actions/local' },
          { uses: 'docker://alpine:3.21' },
          { run: 'true' },
        ],
      },
    });
    assert.deepEqual(violations, []);
  });

  it('checks reusable-workflow job references as well as step references', () => {
    const violations = checkOne({
      job: { uses: 'owner/repository/.github/workflows/reused.yml@main', steps: undefined },
    });
    assert.equal(violations.length, 1);
    assert.match(violations[0], /mutable action reference/);
  });
});

describe('least-privilege permissions (VAL-SEC-009)', () => {
  it('rejects a workflow without top-level permissions', () => {
    const { file, workflow } = compliantWorkflow();
    delete workflow.permissions;
    const violations = checkWorkflowSources({
      workflowSources: [{ file, text: toYaml(workflow) }],
      allowedJobWrites: [],
      timeoutBudgets: { 'fixture.yml': { verify: 30 } },
      trustedTriggerGuards: [],
    });
    assert.ok(violations.some((line) => /top-level permissions/.test(line)));
  });

  it('accepts the compliant baseline fixture', () => {
    assert.deepEqual(checkOne(), []);
  });

  it('rejects a top-level write scope', () => {
    const { file, workflow } = compliantWorkflow();
    workflow.permissions = { contents: 'write' };
    const violations = checkWorkflowSources({
      workflowSources: [{ file, text: toYaml(workflow) }],
      allowedJobWrites: [],
      timeoutBudgets: { 'fixture.yml': { verify: 30 } },
      trustedTriggerGuards: [],
    });
    assert.ok(
      violations.some((line) => /top-level permission 'contents: write' must be 'read'/.test(line)),
    );
  });

  it('accepts an empty top-level permissions map', () => {
    const { file, workflow } = compliantWorkflow();
    workflow.permissions = {};
    const violations = checkWorkflowSources({
      workflowSources: [{ file, text: toYaml(workflow) }],
      allowedJobWrites: [],
      timeoutBudgets: { 'fixture.yml': { verify: 30 } },
      trustedTriggerGuards: [],
    });
    assert.deepEqual(violations, []);
  });

  it('rejects a job write scope that is not on the allowlist', () => {
    const violations = checkOne({
      job: { permissions: { contents: 'write' } },
    });
    assert.ok(violations.some((line) => /not on the reviewed allowlist/.test(line)));
  });

  it('accepts an allowlisted and guarded job write scope', () => {
    const violations = checkOne(
      { job: { permissions: { checks: 'write' } } },
      {
        allowedJobWrites: [
          { workflow: 'fixture.yml', job: 'verify', permission: 'checks', reason: 'test' },
        ],
        trustedTriggerGuards: [{ workflow: 'fixture.yml', job: 'verify', context: 'test guard' }],
      },
    );
    assert.deepEqual(violations, []);
  });

  it('rejects stale allowlist entries no workflow uses', () => {
    const violations = checkOne(
      {},
      {
        allowedJobWrites: [
          { workflow: 'fixture.yml', job: 'verify', permission: 'checks', reason: 'unused' },
        ],
      },
    );
    assert.ok(violations.some((line) => /stale allowlist entry/.test(line)));
  });

  it('treats id-token write as an allowlisted-only scope', () => {
    const violations = checkOne({
      job: { permissions: { 'id-token': 'write' } },
    });
    assert.ok(violations.some((line) => /not on the reviewed allowlist/.test(line)));
  });
});

describe('job timeouts (VAL-SEC-011)', () => {
  it('rejects a job without timeout-minutes', () => {
    const { file, workflow } = compliantWorkflow();
    delete workflow.jobs.verify['timeout-minutes'];
    const violations = checkWorkflowSources({
      workflowSources: [{ file, text: toYaml(workflow) }],
      allowedJobWrites: [],
      timeoutBudgets: { 'fixture.yml': { verify: 30 } },
      trustedTriggerGuards: [],
    });
    assert.ok(violations.some((line) => /no timeout-minutes/.test(line)));
  });

  it('rejects a timeout above the reviewed budget', () => {
    const violations = checkOne({ job: { 'timeout-minutes': 45 } });
    assert.ok(violations.some((line) => /exceeds the reviewed budget/.test(line)));
  });

  it('rejects a job with no reviewed budget entry', () => {
    const violations = checkOne({ job: {} }, { timeoutBudgets: {} });
    assert.ok(violations.some((line) => /no reviewed timeout budget/.test(line)));
  });

  it('rejects stale budget entries for jobs that do not exist', () => {
    const violations = checkOne(
      {},
      { timeoutBudgets: { 'fixture.yml': { verify: 30, ghost: 10 } } },
    );
    assert.ok(violations.some((line) => /stale timeout budget/.test(line)));
  });

  it('rejects unbounded startup loops', () => {
    const violations = checkOne({
      job: { steps: [{ run: 'while true; do curl localhost; done' }] },
    });
    assert.ok(violations.some((line) => /unbounded loop/.test(line)));
  });
});

describe('trusted trigger guards (VAL-SEC-010)', () => {
  it('rejects pull_request_target triggers outright', () => {
    const { file, workflow } = compliantWorkflow();
    workflow.on = { pull_request_target: null };
    const violations = checkWorkflowSources({
      workflowSources: [{ file, text: toYaml(workflow) }],
      allowedJobWrites: [],
      timeoutBudgets: { 'fixture.yml': { verify: 30 } },
      trustedTriggerGuards: [],
    });
    assert.ok(violations.some((line) => /pull_request_target/.test(line)));
  });

  it('requires write jobs to have a guard entry or trusted-only triggers', () => {
    const violations = checkOne(
      { job: { permissions: { issues: 'write' } } },
      {
        allowedJobWrites: [
          { workflow: 'fixture.yml', job: 'verify', permission: 'issues', reason: 'test' },
        ],
      },
    );
    assert.ok(violations.some((line) => /no trusted-trigger guard/.test(line)));
  });

  it('accepts write jobs whose triggers are all trusted contexts', () => {
    const { file, workflow } = compliantWorkflow();
    workflow.on = { schedule: [{ cron: '0 0 * * 1' }], workflow_dispatch: null };
    workflow.jobs.verify.permissions = { issues: 'write' };
    const violations = checkWorkflowSources({
      workflowSources: [{ file, text: toYaml(workflow) }],
      allowedJobWrites: [
        { workflow: 'fixture.yml', job: 'verify', permission: 'issues', reason: 'test' },
      ],
      timeoutBudgets: { 'fixture.yml': { verify: 30 } },
      trustedTriggerGuards: [],
    });
    assert.deepEqual(violations, []);
  });

  it('requires the declared guard tokens in the job condition', () => {
    const violations = checkOne(
      {
        job: {
          permissions: { contents: 'write' },
          if: "github.ref == 'refs/heads/develop'",
        },
      },
      {
        allowedJobWrites: [
          { workflow: 'fixture.yml', job: 'verify', permission: 'contents', reason: 'test' },
        ],
        trustedTriggerGuards: [
          {
            workflow: 'fixture.yml',
            job: 'verify',
            context: 'test guard',
            jobIfMustContain: ["github.ref == 'refs/heads/main'"],
          },
        ],
      },
    );
    assert.ok(violations.some((line) => /missing required guard/.test(line)));
  });

  it('accepts a guard whose tokens are present despite irregular spacing', () => {
    const violations = checkOne(
      {
        job: {
          permissions: { contents: 'write' },
          if: "github.event_name != 'pull_request'  &&   github.ref == 'refs/heads/main'",
        },
      },
      {
        allowedJobWrites: [
          { workflow: 'fixture.yml', job: 'verify', permission: 'contents', reason: 'test' },
        ],
        trustedTriggerGuards: [
          {
            workflow: 'fixture.yml',
            job: 'verify',
            context: 'test guard',
            jobIfMustContain: ["github.ref == 'refs/heads/main'", "!= 'pull_request'"],
          },
        ],
      },
    );
    assert.deepEqual(violations, []);
  });
});

const ZAP_PIN = 'zaproxy/action-baseline@de8ad967d3548d44ef623df22cf95c3b0baf8b25';
const GITLEAKS_PIN = 'gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e';

const VALID_ZAP_WITH = {
  target: 'http://127.0.0.1:4173/',
  cmd_options: '-d',
  fail_action: true,
  allow_issue_writing: false,
  rules_file_name: ZAP_RULES_FILE,
};

const VALID_RULES = [
  '# Reviewed baseline exceptions.',
  '10020\tIGNORE\tStatic preview demo has no authenticated state; framing headers belong to the production host.',
  '',
].join('\n');

const DEFAULT_SERVE_RUN =
  'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort & for _ in $(seq 1 60); do curl http://127.0.0.1:4173/ && exit 0; sleep 1; done; exit 1';

function securityWorkflow(overrides = {}) {
  const workflow = {
    name: 'Security',
    on: {
      pull_request: null,
      push: { branches: ['main'] },
      schedule: [{ cron: '30 6 * * 1' }],
      workflow_dispatch: null,
    },
    permissions: { contents: 'read' },
    jobs: {
      'secret-scan': {
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 15,
        steps: [{ uses: PINNED_CHECKOUT, with: { 'fetch-depth': 0 } }, { uses: GITLEAKS_PIN }],
        ...(overrides.secretScan ?? {}),
      },
      'dependency-audit': {
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 10,
        steps: [{ uses: PINNED_CHECKOUT }, { run: 'npm audit --audit-level=high' }],
        ...(overrides.dependencyAudit ?? {}),
      },
      dast: {
        'runs-on': 'ubuntu-latest',
        'timeout-minutes': 30,
        steps: [
          { uses: PINNED_CHECKOUT },
          { name: 'Build', run: 'npm run build', env: { BASE_PATH: '/' } },
          { name: 'Serve', run: overrides.serveRun ?? DEFAULT_SERVE_RUN },
          { name: 'ZAP', uses: ZAP_PIN, with: overrides.zapWith ?? VALID_ZAP_WITH },
        ],
      },
    },
  };
  if (overrides.on) {
    workflow.on = overrides.on;
  }
  return { file: 'security.yml', text: toYaml(workflow) };
}

function checkSecurity(overrides = {}, options = {}) {
  return checkWorkflowSources({
    workflowSources: [securityWorkflow(overrides)],
    allowedJobWrites: [],
    timeoutBudgets: {
      'security.yml': { 'secret-scan': 15, 'dependency-audit': 10, dast: 30 },
    },
    trustedTriggerGuards: [
      { workflow: 'security.yml', job: 'secret-scan', context: 'test' },
      { workflow: 'security.yml', job: 'dast', context: 'test' },
    ],
    zapRulesText: 'zapRulesText' in options ? options.zapRulesText : VALID_RULES,
  });
}

describe('blocking scans (VAL-SEC-013)', () => {
  it('accepts full-history gitleaks and a high-severity npm audit gate', () => {
    assert.deepEqual(checkSecurity(), []);
  });

  for (const trigger of ['pull_request', 'schedule', 'workflow_dispatch']) {
    it(`rejects a scan workflow that does not trigger on ${trigger}`, () => {
      const on = {
        pull_request: null,
        push: { branches: ['main'] },
        schedule: [{ cron: '30 6 * * 1' }],
        workflow_dispatch: null,
      };
      delete on[trigger];
      const violations = checkSecurity({ on });
      assert.ok(violations.some((line) => /security\.yml.*trigger/.test(line)));
    });
  }

  it('rejects a push trigger that does not name the main branch', () => {
    const violations = checkSecurity({
      on: {
        pull_request: null,
        push: { branches: ['develop'] },
        schedule: [{ cron: '0 0 * * 1' }],
        workflow_dispatch: null,
      },
    });
    assert.ok(violations.some((line) => /push to main/.test(line)));
  });

  it('rejects shallow history for the secret scan', () => {
    const violations = checkSecurity({
      secretScan: {
        steps: [{ uses: PINNED_CHECKOUT, with: { 'fetch-depth': 1 } }, { uses: GITLEAKS_PIN }],
      },
    });
    assert.ok(violations.some((line) => /fetch-depth: 0/.test(line)));
  });

  it('rejects continue-on-error on the secret scan and dependency audit', () => {
    const violations = checkSecurity({
      dependencyAudit: { 'continue-on-error': true },
    });
    assert.ok(violations.some((line) => /continue-on-error/.test(line)));
  });

  it('rejects an audit gate without the high severity level', () => {
    const violations = checkSecurity({
      dependencyAudit: { steps: [{ uses: PINNED_CHECKOUT }, { run: 'npm audit' }] },
    });
    assert.ok(violations.some((line) => /npm audit --audit-level=high/.test(line)));
  });
});

describe('ZAP rules policy (VAL-SEC-012)', () => {
  function checkDast(zapWith = VALID_ZAP_WITH, options = {}) {
    return checkSecurity({ zapWith, serveRun: options.serveRun }, options);
  }

  it('accepts a rules-file policy with a reviewed entry', () => {
    assert.deepEqual(checkDast(), []);
  });

  for (const cmdOptions of ['-d -I', '-I', '-d -I -x']) {
    it(`rejects blanket WARN suppression cmd_options '${cmdOptions}'`, () => {
      const violations = checkDast({ ...VALID_ZAP_WITH, cmd_options: cmdOptions });
      assert.ok(violations.some((line) => /must not use '-I'/.test(line)));
    });
  }

  it('requires the reviewed rules file reference', () => {
    const withoutFile = { ...VALID_ZAP_WITH };
    delete withoutFile.rules_file_name;
    const violations = checkDast(withoutFile);
    assert.ok(violations.some((line) => /rules_file_name/.test(line)));
  });

  it('requires the rules file to exist', () => {
    const violations = checkDast(VALID_ZAP_WITH, { zapRulesText: undefined });
    assert.ok(violations.some((line) => /does not exist/.test(line)));
  });

  it('requires the baseline to fail on findings and scan the local preview', () => {
    const violations = checkDast({ ...VALID_ZAP_WITH, fail_action: false });
    assert.ok(violations.some((line) => /fail_action: true/.test(line)));

    const targetViolations = checkDast({ ...VALID_ZAP_WITH, target: 'https://example.com/' });
    assert.ok(targetViolations.some((line) => /127\.0\.0\.1:4173/.test(line)));
  });

  it('requires the production preview to be served with the canonical command', () => {
    const violations = checkDast(VALID_ZAP_WITH, { serveRun: 'npm run dev &' });
    assert.ok(violations.some((line) => /vite preview/.test(line)));
  });

  it('rejects ZAP rule entries without a rationale', () => {
    const violations = checkDast(VALID_ZAP_WITH, { zapRulesText: '10020\tIGNORE\n' });
    assert.ok(violations.some((line) => /rationale/.test(line)));
  });

  it('rejects malformed ZAP rule lines', () => {
    const violations = checkDast(VALID_ZAP_WITH, { zapRulesText: 'banana\n' });
    assert.ok(violations.some((line) => /malformed/.test(line)));
  });
});

describe('CI and DAST command parity', () => {
  it('requires the CI e2e job to run the local test:e2e command', () => {
    const workflow = {
      name: 'CI',
      on: { pull_request: null },
      permissions: { contents: 'read' },
      jobs: {
        e2e: {
          'runs-on': 'ubuntu-latest',
          'timeout-minutes': 30,
          steps: [{ uses: PINNED_CHECKOUT }, { run: 'npm run test:e2e' }],
        },
      },
    };
    const pass = checkWorkflowSources({
      workflowSources: [{ file: 'ci.yml', text: toYaml(workflow) }],
      allowedJobWrites: [],
      timeoutBudgets: { 'ci.yml': { e2e: 30 } },
      trustedTriggerGuards: [],
    });
    assert.deepEqual(pass, []);

    workflow.jobs.e2e.steps[1].run = 'npm run test:e2e:ci-only';
    const fail = checkWorkflowSources({
      workflowSources: [{ file: 'ci.yml', text: toYaml(workflow) }],
      allowedJobWrites: [],
      timeoutBudgets: { 'ci.yml': { e2e: 30 } },
      trustedTriggerGuards: [],
    });
    assert.ok(fail.some((line) => /npm run test:e2e/.test(line)));
  });
});

describe('ZAP rules parser', () => {
  it('parses rule IDs, thresholds, and rationales and skips comments', () => {
    const rules = parseZapRules(
      '# header\n\n10020\tIGNORE\tAccepted for the local preview.\n10038\tWARN\tKept visible for triage review.\n',
    );
    assert.deepEqual(rules.entries, [
      { id: '10020', threshold: 'IGNORE', rationale: 'Accepted for the local preview.' },
      { id: '10038', threshold: 'WARN', rationale: 'Kept visible for triage review.' },
    ]);
    assert.deepEqual(rules.violations, []);
  });

  it('rejects unknown thresholds and missing rationales', () => {
    const rules = parseZapRules('1\tMAYBE\tno\n2\tIGNORE\n');
    assert.equal(rules.violations.length, 2);
  });
});

describe('repository policy configuration', () => {
  it('keeps the reviewed inventories well formed', () => {
    for (const entry of ALLOWED_JOB_WRITES) {
      assert.ok(entry.workflow.endsWith('.yml'));
      assert.ok(entry.job.length > 0);
      assert.ok(entry.permission.length > 0);
      assert.ok(entry.reason.length >= 20);
    }
    for (const [workflow, jobs] of Object.entries(TIMEOUT_BUDGETS_MINUTES)) {
      assert.ok(workflow.endsWith('.yml'));
      for (const budget of Object.values(jobs)) {
        assert.ok(Number.isInteger(budget) && budget > 0);
      }
    }
    for (const guard of TRUSTED_TRIGGER_GUARDS) {
      assert.ok(guard.workflow.endsWith('.yml'));
      assert.ok(guard.job.length > 0);
      assert.ok(guard.context.length >= 20);
    }
  });
});
