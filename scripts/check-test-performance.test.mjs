import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateTestPerformance, parseJunit } from './check-test-performance.mjs';

const JUNIT = `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="3" failures="1" errors="0" time="1.5">
  <testsuite name="src/lib/metrics.test.ts" tests="3" failures="1" errors="0" skipped="1" time="1.5">
    <testcase classname="src/lib/metrics.test.ts" name="fast &gt; case" time="0.003">
    </testcase>
    <testcase classname="src/lib/metrics.test.ts" name="slow &gt; case" time="0.900">
    </testcase>
    <testcase classname="src/lib/metrics.test.ts" name="skipped &gt; case" time="0">
      <skipped />
    </testcase>
    <testcase classname="src/lib/metrics.test.ts" name="failing &gt; case" time="0.100">
      <failure message="boom">stack</failure>
    </testcase>
  </testsuite>
</testsuites>`;

describe('JUnit parsing', () => {
  it('reads test counts, decoded names, durations, and status', () => {
    const parsed = parseJunit(JUNIT);

    assert.equal(parsed.testCount, 3);
    assert.equal(parsed.failureCount, 1);
    assert.equal(parsed.totalTimeMs, 1003);
    assert.deepEqual(
      parsed.testCases.map((testCase) => [testCase.name, testCase.status, testCase.timeMs]),
      [
        ['fast > case', 'passed', 3],
        ['slow > case', 'passed', 900],
        ['skipped > case', 'skipped', 0],
        ['failing > case', 'failed', 100],
      ],
    );
  });
});

describe('test performance budget', () => {
  const baseConfig = { totalBudgetMs: 5_000, slowestTestBudgetMs: 1_000, reportSlowest: 2 };

  it('passes a suite within both budgets and reports the slowest tests first', () => {
    const { slowest, violations } = evaluateTestPerformance({
      parsed: parseJunit(JUNIT),
      config: baseConfig,
    });

    assert.deepEqual(violations, []);
    assert.deepEqual(
      slowest.map((testCase) => testCase.name),
      ['slow > case', 'failing > case'],
    );
  });

  it('reports a total budget breach and a single slow test', () => {
    const { violations } = evaluateTestPerformance({
      parsed: parseJunit(JUNIT),
      config: { totalBudgetMs: 500, slowestTestBudgetMs: 100, reportSlowest: 5 },
    });

    assert.equal(violations.length, 2);
    assert.match(violations[0], /Suite took 1\.00s/);
    assert.match(violations[1], /slow > case/);
  });
});
