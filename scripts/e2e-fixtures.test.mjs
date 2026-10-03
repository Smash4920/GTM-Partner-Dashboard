import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertWorkerLimit, prepareFixtures } from './e2e-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
test('bounds ordinary scheduling while reserving one manual validator slot', () => {
  for (const workers of [1, 2, 3, 4]) assertWorkerLimit(workers);
  for (const workers of [0, 5, 10, 1.5, NaN, undefined]) {
    assert.throws(() => assertWorkerLimit(workers), /1\.\.4 workers/);
  }
});

test('prepares each selected immutable fixture exactly once and cleans owned output', () => {
  const calls = [];
  const prepared = prepareFixtures(
    [
      'accessibility-modals.spec.ts',
      'accessibility-modals.spec.ts',
      'accessibility-inline-notifications.spec.ts',
    ],
    root,
    (...args) => calls.push(args),
  );
  assert.equal(calls.length, 2);
  assert.equal(Object.keys(prepared.env).length, 2);
  for (const [, directory] of calls) assert.equal(existsSync(directory), true);
  prepared.cleanup();
  for (const [, directory] of calls) assert.equal(existsSync(directory), false);
});

test('unselected fixture builders never run', () => {
  const prepared = prepareFixtures(['accessibility-routes.spec.ts'], root, () => assert.fail());
  assert.deepEqual(prepared.env, {});
  prepared.cleanup();
});

test('failed preparation blocks execution and removes all owned temporary output', () => {
  const directories = [];
  assert.throws(
    () =>
      prepareFixtures(
        ['accessibility-modals.spec.ts', 'accessibility-inline-notifications.spec.ts'],
        root,
        (_builder, directory) => {
          directories.push(directory);
          if (directories.length === 2) throw new Error('fixture failed');
        },
      ),
    /fixture failed/,
  );
  assert.equal(directories.length, 2);
  for (const directory of directories) assert.equal(existsSync(directory), false);
});

test('ordinary production preview uses four workers, strict startup and unchanged retries', () => {
  const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');
  assert.match(config, /workers: fixtureRun \? 1 : 4/);
  assert.match(config, /retries: fixtureRun \? 0 : process.env.CI \? 2 : 0/);
  assert.match(config, /vite preview --host 127\.0\.0\.1 --port \$\{port\} --strictPort/);
  assert.match(config, /reuseExistingServer: false/);
  assert.match(config, /BASE_PATH: '\/'/);
  assert.doesNotMatch(config, /npm run dev|E2E_PRODUCTION_PREVIEW/);
});

test('modal and inline workers read shared assets instead of rebuilding or deleting them', () => {
  for (const [spec, variable] of [
    ['accessibility-modals', 'E2E_MODAL_FIXTURE_DIR'],
    ['accessibility-inline-notifications', 'E2E_INLINE_FIXTURE_DIR'],
  ]) {
    const source = readFileSync(new URL(`../tests/e2e/${spec}.spec.ts`, import.meta.url), 'utf8');
    assert.match(source, new RegExp(`process.env.${variable}`));
    assert.doesNotMatch(source, /execFile|mkdtemp|await rm\(/);
    assert.match(source, /new AxeBuilder\(\{ page \}\)\.analyze\(\)/);
  }
});
