import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { describe, it } from 'node:test';

import { parse } from 'yaml';

import { waitForPreviewAssets } from './check-preview-assets.mjs';
import {
  ALLOWED_JOB_WRITES,
  TIMEOUT_BUDGETS_MINUTES,
  TRUSTED_TRIGGER_GUARDS,
  ZAP_RULES_FILE,
  checkWorkflowSources,
  parseZapRules,
} from './check-workflows.mjs';

const PINNED_CHECKOUT = 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1';

function repositorySources() {
  const directory = new URL('../.github/workflows/', import.meta.url);
  return readdirSync(directory)
    .filter((file) => /\.ya?ml$/.test(file))
    .map((file) => ({ file, text: readFileSync(new URL(file, directory), 'utf8') }));
}

function repositoryRules() {
  return readFileSync(new URL('../.zap/rules.tsv', import.meta.url), 'utf8');
}

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
  if (String(value).includes('\n')) {
    return JSON.stringify(String(value));
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
  it('accepts CI e2e at 45 minutes and rejects 46 against the actual policy', () => {
    for (const timeout of [45, 46]) {
      const workflowSources = repositorySources().map((source) => {
        if (source.file !== 'ci.yml') return source;
        const workflow = parse(source.text);
        workflow.jobs.e2e['timeout-minutes'] = timeout;
        return { ...source, text: toYaml(workflow) };
      });
      const violations = checkWorkflowSources({ workflowSources, zapRulesText: repositoryRules() });
      if (timeout === 45) {
        assert.deepEqual(violations, []);
      } else {
        assert.ok(violations.some((line) => /e2e.*46.*budget of 45/.test(line)));
      }
    }
  });

  it('preserves every other reviewed cap and rejects each job one minute over budget', () => {
    const expected = {
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
    assert.deepEqual(TIMEOUT_BUDGETS_MINUTES, expected);
    for (const source of repositorySources()) {
      const workflow = parse(source.text);
      for (const [job, budget] of Object.entries(expected[source.file])) {
        assert.equal(workflow.jobs[job]['timeout-minutes'], budget, `${source.file}/${job}`);
        const changed = structuredClone(workflow);
        changed.jobs[job]['timeout-minutes'] = budget + 1;
        const workflowSources = repositorySources().map((entry) =>
          entry.file === source.file ? { ...entry, text: toYaml(changed) } : entry,
        );
        assert.ok(
          checkWorkflowSources({ workflowSources, zapRulesText: repositoryRules() }).some(
            (line) => line.includes(`job '${job}'`) && line.includes('exceeds the reviewed budget'),
          ),
          `${source.file}/${job}`,
        );
      }
    }
  });

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

  it('rejects unbounded loops on the shell no-op builtin `:`', () => {
    // `while :` is the idiomatic bash spin loop; a word-boundary anchor after
    // the condition would miss it because `:` is not a word character.
    for (const run of [
      'while :; do curl localhost; done',
      'until :; do curl localhost; done',
      'while : ; do sleep 1; done',
    ]) {
      const violations = checkOne({ job: { steps: [{ run }] } });
      assert.ok(
        violations.some((line) => /unbounded loop/.test(line)),
        run,
      );
    }
  });

  it('tolerates bounded loops and words that merely start with the condition', () => {
    const violations = checkOne({
      job: {
        steps: [
          { run: 'for _ in $(seq 1 60); do curl localhost && exit 0; sleep 1; done; exit 1' },
          { run: 'while truly -eq 1; do echo bounded-by-tool; done' },
        ],
      },
    });
    assert.deepEqual(violations, []);
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
  '10021\tIGNORE\tCorrect content types are served locally; production nosniff remains a hosting concern.',
  '10038\tIGNORE\tCSP remains a production-host requirement, not verified by this localhost preview.',
  '10063\tIGNORE\tNo powerful browser features are used in this localhost preview demo.',
  '10049\tIGNORE\tPublic localhost preview assets revalidate; no sensitive cache waiver is approved.',
  '10096\tIGNORE\tThe apparent timestamp is a deterministic RNG constant in the local mock bundle.',
  '10109\tIGNORE\tSPA identification locally requires no code change and proves no rendered scan coverage.',
  '90004\tIGNORE\tCOEP, COOP and CORP are accepted only for the whole localhost preview rule.',
  '',
].join('\n');

const DEFAULT_SERVE_RUN =
  './node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort &\nnode scripts/check-preview-assets.mjs';

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
          {
            name: 'Serve',
            run: overrides.serveRun ?? DEFAULT_SERVE_RUN,
            env: overrides.serveEnv ?? { BASE_PATH: '/' },
            ...(overrides.serveStep ?? {}),
          },
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

  it('accepts exactly the eight reviewed whole-rule local-preview exceptions', () => {
    assert.deepEqual(checkDast(), []);
    const rules = parseZapRules(repositoryRules());
    assert.deepEqual(rules.violations, []);
    assert.deepEqual(
      rules.entries
        .map(({ id, threshold }) => ({ id, threshold }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      ['10020', '10021', '10038', '10049', '10063', '10096', '10109', '90004'].map((id) => ({
        id,
        threshold: 'IGNORE',
      })),
    );
    assert.deepEqual(checkDast(VALID_ZAP_WITH, { zapRulesText: repositoryRules() }), []);
  });

  for (const id of ['10020', '10021', '10038', '10049', '10063', '10096', '10109', '90004']) {
    it(`rejects missing reviewed rule ${id}`, () => {
      const zapRulesText = VALID_RULES.split('\n')
        .filter((line) => !line.startsWith(`${id}\t`))
        .join('\n');
      assert.ok(
        checkDast(VALID_ZAP_WITH, { zapRulesText }).some((line) =>
          line.includes(`missing reviewed rule ${id}`),
        ),
      );
    });
  }

  for (const threshold of ['IGNORE', 'OFF', 'INFO', 'WARN', 'FAIL']) {
    it(`rejects unreviewed rule overrides even at ${threshold} severity`, () => {
      const zapRulesText = `${VALID_RULES}\n99999\t${threshold}\tUnreviewed rule must retain blocking scanner behavior.\n`;
      assert.ok(
        checkDast(VALID_ZAP_WITH, { zapRulesText }).some((line) =>
          /unreviewed rule 99999/.test(line),
        ),
      );
    });
  }

  for (const threshold of ['OFF', 'INFO', 'WARN', 'FAIL']) {
    it(`rejects changing an approved IGNORE threshold to ${threshold}`, () => {
      const zapRulesText = VALID_RULES.replace('90004\tIGNORE', `90004\t${threshold}`);
      assert.ok(
        checkDast(VALID_ZAP_WITH, { zapRulesText }).some((line) =>
          /90004.*must use IGNORE/.test(line),
        ),
      );
    });
  }

  it('rejects duplicate reviewed rules and severity-wide suppression', () => {
    const duplicate = `${VALID_RULES}\n10020\tIGNORE\tDuplicate framing exception must not broaden the reviewed policy.\n`;
    assert.ok(
      checkDast(VALID_ZAP_WITH, { zapRulesText: duplicate }).some((line) =>
        /duplicate rule 10020/.test(line),
      ),
    );
    assert.ok(
      checkDast(VALID_ZAP_WITH, {
        zapRulesText: `${VALID_RULES}\n*\tIGNORE\tIgnore every severity across the whole preview.\n`,
      }).some((line) => /malformed/.test(line)),
    );
  });

  it('records dated local whole-rule rationale without claiming a fix or production waiver', () => {
    const text = repositoryRules();
    assert.match(text, /whole rule ID/);
    assert.match(text, /re-review/i);
    const entries = parseZapRules(text).entries;
    for (const id of ['10049', '10096', '10109', '90004']) {
      const rationale = entries.find((entry) => entry.id === id)?.rationale;
      assert.match(rationale ?? '', /2026-10-03/);
      assert.match(rationale ?? '', /local.*preview/i);
    }
    assert.match(
      entries.find(({ id }) => id === '10049')?.rationale ?? '',
      /no.*private.*cache waiver/i,
    );
    assert.match(
      entries.find(({ id }) => id === '10096')?.rationale ?? '',
      /1831565813.*0x6d2b79f5.*rng\.ts/,
    );
    assert.match(entries.find(({ id }) => id === '10109')?.rationale ?? '', /no.*rendered.*AJAX/i);
    assert.match(
      entries.find(({ id }) => id === '90004')?.rationale ?? '',
      /COEP.*COOP.*CORP.*no production/i,
    );
    assert.ok(
      readFileSync(new URL('../src/data/mock/rng.ts', import.meta.url), 'utf8').includes(
        '0x6d2b79f5',
      ),
    );
    assert.equal(0x6d2b79f5, 1831565813);
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

  for (const serveEnv of [{}, { BASE_PATH: '/GTM-Partner-Dashboard/' }]) {
    it(`rejects missing or wrong preview base ${JSON.stringify(serveEnv)}`, () => {
      assert.ok(checkSecurity({ serveEnv }).some((line) => /serve with BASE_PATH=\//.test(line)));
    });
  }

  it('rejects root-only HTTP readiness even when the startup loop is bounded', () => {
    const serveRun =
      'npm run preview -- --host 127.0.0.1 --port 4173 --strictPort & for _ in $(seq 1 60); do curl --fail http://127.0.0.1:4173/ && exit 0; sleep 1; done; exit 1';
    assert.ok(
      checkSecurity({ serveRun }).some((line) => /initial module and style assets/.test(line)),
    );
  });

  it('rejects ignored or backgrounded asset readiness failures', () => {
    for (const suffix of [' || true', ' &', '; exit 0']) {
      assert.ok(
        checkSecurity({ serveRun: DEFAULT_SERVE_RUN + suffix }).some((line) =>
          /initial module and style assets/.test(line),
        ),
      );
    }
  });

  it('rejects non-blocking DAST setup or scan steps', () => {
    const violations = checkSecurity({ serveStep: { 'continue-on-error': true } });
    assert.ok(violations.some((line) => /dast.*continue-on-error/.test(line)));
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

describe('DAST initial asset readiness', () => {
  const html = `<!doctype html><div id="root"></div>
    <script crossorigin src="/assets/index-abc123.js" type="module"></script>
    <link href="/assets/vendor-def456.js" rel="modulepreload">
    <link rel="stylesheet" href="/assets/index-abc123.css">`;

  function fixture(overrides = {}) {
    const responses = {
      '/': [html, 'text/html'],
      '/assets/index-abc123.js': ['import "./vendor-def456.js";', 'text/javascript'],
      '/assets/vendor-def456.js': ['export const ready = true;', 'application/javascript'],
      '/assets/index-abc123.css': ['body { margin: 0; }', 'text/css'],
      ...overrides,
    };
    const requests = [];
    let time = 0;
    return {
      requests,
      options: {
        timeoutMs: 3,
        now: () => time,
        pause: async () => {
          time += 1;
        },
        fetchImpl: async (url, options) => {
          requests.push(new URL(url).pathname);
          assert.ok(options.signal);
          assert.equal(options.redirect, 'error');
          const [body, type, status = 200] = responses[new URL(url).pathname] ?? ['', '', 404];
          return new Response(body, { status, headers: { 'content-type': type } });
        },
      },
    };
  }

  it('requires successful actual GETs of the initial module, preload, and stylesheet', async () => {
    const { requests, options } = fixture();
    const assets = await waitForPreviewAssets(options);
    assert.equal(assets.length, 3);
    assert.deepEqual(requests, [
      '/',
      '/assets/index-abc123.js',
      '/assets/vendor-def456.js',
      '/assets/index-abc123.css',
    ]);
  });

  for (const path of [
    '/assets/index-abc123.js',
    '/assets/vendor-def456.js',
    '/assets/index-abc123.css',
  ]) {
    for (const [label, response] of [
      ['404', ['', 'text/plain', 404]],
      ['HTML fallback', [html, 'text/html']],
      ['mislabeled HTML fallback', [html, path.endsWith('.css') ? 'text/css' : 'text/javascript']],
      ['empty body', ['', path.endsWith('.css') ? 'text/css' : 'text/javascript']],
    ]) {
      it(`rejects root 200 with ${path} returning ${label}`, async () => {
        const { options } = fixture({ [path]: response });
        await assert.rejects(waitForPreviewAssets(options), /not ready within.*asset/);
      });
    }
  }

  it('rejects HTML without required initial modules or styles', async () => {
    for (const body of [
      '<div id="root"></div>',
      html.replace(/<link rel="stylesheet"[^>]+>/, ''),
    ]) {
      const { options } = fixture({ '/': [body, 'text/html'] });
      await assert.rejects(waitForPreviewAssets(options), /initial module and stylesheet/);
    }
  });

  it('rejects cross-origin asset references without making an external request', async () => {
    const { requests, options } = fixture({
      '/': [html.replace('/assets/index-abc123.js', 'https://example.com/app.js'), 'text/html'],
    });
    await assert.rejects(waitForPreviewAssets(options), /same origin/);
    assert.ok(requests.every((path) => path === '/'));
  });

  it('resolves relative assets and tolerates content-type charset parameters', async () => {
    const { options } = fixture({
      '/': [html.replaceAll('"/assets/', '"./assets/'), 'text/html; charset=utf-8'],
      '/assets/index-abc123.css': ['body {}', 'text/css; charset=utf-8'],
    });
    assert.equal((await waitForPreviewAssets(options)).length, 3);
  });

  it('bounds unavailable startup and recovers when the next attempt succeeds', async () => {
    const { options } = fixture();
    const fetchImpl = options.fetchImpl;
    let attempts = 0;
    options.fetchImpl = async (...args) => {
      if (attempts++ === 0) throw new Error('connection refused');
      return fetchImpl(...args);
    };
    assert.equal((await waitForPreviewAssets(options)).length, 3);
    options.fetchImpl = async () => {
      throw new Error('connection refused');
    };
    await assert.rejects(waitForPreviewAssets(options), /not ready within 3ms: connection refused/);
  });

  for (const stall of ['fetch', 'body']) {
    it(`bounds a stalled ${stall} and aborts the owned request`, async () => {
      let signal;
      let time = 0;
      const options = {
        timeoutMs: 10,
        now: () => time,
        pause: async () => {
          time = 10;
        },
        fetchImpl: async (_, options) => {
          signal = options.signal;
          if (stall === 'fetch') return new Promise(() => {});
          return {
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            text: () => new Promise(() => {}),
          };
        },
      };
      await assert.rejects(waitForPreviewAssets(options), /request or response body timed out/);
      assert.equal(signal.aborted, true);
    });
  }
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
