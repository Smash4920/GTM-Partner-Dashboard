import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const root = fileURLToPath(new URL('../', import.meta.url));
const eslint = new ESLint({ cwd: root });

test('only generated browser report/results trees are excluded from source lint', async () => {
  for (const path of [
    'build-metrics/target-state-fixtures/report/trace/assets/generated.js',
    'build-metrics/target-state-fixtures/results/trace/generated.ts',
    'playwright-report/trace/assets/generated.js',
    'test-results/e2e/trace/generated.ts',
  ]) {
    assert.equal(await eslint.isPathIgnored(`${root}${path}`), true, path);
  }
  for (const path of [
    'build-metrics/source.ts',
    'build-metrics/target-state-fixtures/source.ts',
    'build-metrics/target-state-fixtures/reporting/source.ts',
    'scripts/target-state-preview.mjs',
    'tests/e2e/target-state-fixtures.spec.ts',
    'tests/fixtures/target-states/entry.test.tsx',
    'src/App.tsx',
  ]) {
    assert.equal(await eslint.isPathIgnored(`${root}${path}`), false, path);
  }
});
