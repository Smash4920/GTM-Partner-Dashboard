import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { parse } from 'yaml';

import { QUALITY_GATE, checkQualityPolicy, collectQualityPolicy } from './check-quality-policy.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const facts = () => collectQualityPolicy(root);

describe('final quality ratchets', () => {
  it('preserves the effective checked-in floors, ceilings, and ordered gate', () => {
    assert.deepEqual(checkQualityPolicy(facts()), []);
    assert.equal(QUALITY_GATE.length, 17);
  });

  it('accepts the approved aggregate ceiling and unchanged individual ceiling', () => {
    const value = facts();
    value.testPerformance.totalBudgetMs = 210000;
    value.testPerformance.slowestTestBudgetMs = 8000;
    assert.deepEqual(checkQualityPolicy(value), []);
  });

  it('rejects an aggregate ceiling one millisecond above the approved budget', () => {
    const value = facts();
    value.testPerformance.totalBudgetMs = 210001;
    assert.deepEqual(checkQualityPolicy(value), [
      'Vitest total: 210001 exceeds effective ceiling 210000',
    ]);
  });

  it('rejects an individual ceiling one millisecond above the unchanged budget', () => {
    const value = facts();
    value.testPerformance.slowestTestBudgetMs = 8001;
    assert.deepEqual(checkQualityPolicy(value), [
      'Vitest individual: 8001 exceeds effective ceiling 8000',
    ]);
  });

  it('rejects weakened coverage, static, build, and test-time limits', () => {
    const mutations = [
      (value) => {
        value.coverage.statements = 94;
      },
      (value) => {
        value.coverage.branches = 89;
      },
      (value) => {
        value.coverage.functions = 95;
      },
      (value) => {
        value.coverage.lines = 95;
      },
      (value) => {
        value.maxFileBytes += 1;
      },
      (value) => {
        value.maxTextLines += 1;
      },
      (value) => {
        value.complexity += 1;
      },
      (value) => {
        value.duplication += 0.1;
      },
      (value) => {
        value.buildBudgetMs += 1;
      },
      (value) => {
        value.testPerformance.totalBudgetMs += 1;
      },
      (value) => {
        value.testPerformance.slowestTestBudgetMs += 1;
      },
    ];
    for (const mutate of mutations) {
      const value = facts();
      mutate(value);
      assert.ok(checkQualityPolicy(value).length > 0);
    }
  });

  it('rejects missing, widened, or misdirected bundle and dependency ceilings', () => {
    for (const collection of ['bundleBudgets', 'dependencyBudgets', 'sizeLimits']) {
      const value = facts();
      value[collection].pop();
      assert.ok(checkQualityPolicy(value).length > 0, `${collection}: missing`);
    }
    const bundle = facts();
    bundle.bundleBudgets[0].limitBytes += 1;
    assert.ok(checkQualityPolicy(bundle).length > 0);
    const pattern = facts();
    pattern.bundleBudgets[0].pattern = 'dist/assets/nonexistent-*.js';
    assert.ok(checkQualityPolicy(pattern).length > 0);
    const dependency = facts();
    dependency.dependencyBudgets[0].limitBytes += 1;
    assert.ok(checkQualityPolicy(dependency).length > 0);
    const total = facts();
    total.dependencyTotalBytes += 1;
    assert.ok(checkQualityPolicy(total).length > 0);
    const size = facts();
    size.sizeLimits[0].limit = '236 kB';
    assert.ok(checkQualityPolicy(size).length > 0);
  });

  it('rejects missing, reordered, or non-blocking CI steps', () => {
    for (const mutate of [
      (steps) => steps.splice(2, 1),
      (steps) => steps.reverse(),
      (steps) => {
        steps[0]['continue-on-error'] = true;
      },
    ]) {
      const value = facts();
      mutate(value.ciSteps);
      assert.ok(checkQualityPolicy(value).length > 0);
    }
    const job = facts();
    job.ciNonBlocking = true;
    assert.ok(checkQualityPolicy(job).length > 0);
    const conditional = facts();
    conditional.ciConditional = true;
    assert.ok(checkQualityPolicy(conditional).length > 0);
    const build = facts();
    build.ciBuildBudgetMs = 60001;
    assert.ok(checkQualityPolicy(build).length > 0);
  });

  it('rejects missing or reordered handoff checklists and TypeScript weakening', () => {
    for (const path of ['README.md', 'AGENTS.md']) {
      const value = facts();
      value.documents[path] = 'npm run lint';
      assert.ok(checkQualityPolicy(value).length > 0);
    }
    for (const key of ['strict', 'noUnusedLocals', 'noUnusedParameters']) {
      const value = facts();
      value.typescript[key] = false;
      assert.ok(checkQualityPolicy(value).length > 0);
    }
  });

  it('collects the actual workflow jobs rather than a sampled gate', () => {
    const ci = parse(read('.github/workflows/ci.yml'));
    const value = facts();
    assert.deepEqual(
      value.ciSteps.map((step) => step.run),
      Object.values(ci.jobs)
        .flatMap((job) => job.steps.filter((step) => QUALITY_GATE.includes(step.run)))
        .map((step) => step.run),
    );
  });
});
