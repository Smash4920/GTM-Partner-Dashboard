import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const args = process.argv.slice(2);
const fixtureFile = 'target-state-fixtures.spec.ts';
if (args.some((arg) => arg === '--shard' || arg.startsWith('--shard='))) {
  throw new Error('Serial fixture E2E cannot be sharded; run the combined suite without --shard.');
}

function run(extraArgs, env, capture = false) {
  return spawnSync(process.execPath, [cli, 'test', ...args, ...extraArgs], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
}

// Ask Playwright itself to resolve grep/file/project filters. No hand-written
// grep parser and no pass-with-no-tests escape hatch in actual test runs.
const selection = run(
  ['--list', '--reporter=json'],
  { E2E_DISCOVERY: '1', E2E_TARGET_FIXTURES: '0' },
  true,
);
if (selection.status !== 0) {
  process.stdout.write(selection.stdout ?? '');
  process.stderr.write(selection.stderr ?? '');
  process.exit(selection.status ?? 1);
}
const report = JSON.parse(selection.stdout);
function files(suites) {
  return suites.flatMap((suite) => [
    ...(suite.specs?.length ? [suite.file] : []),
    ...files(suite.suites ?? []),
  ]);
}
const selected = files(report.suites);
if (selected.some((file) => file.endsWith(fixtureFile))) {
  const types = spawnSync(
    process.execPath,
    ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.e2e.json'],
    { cwd: root, stdio: 'inherit' },
  );
  if (types.status !== 0) process.exit(types.status ?? 1);
  const result = run([], { E2E_TARGET_FIXTURES: '1', E2E_DISCOVERY: '0' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (selected.some((file) => !file.endsWith(fixtureFile))) {
  const pidDir = mkdtempSync(join(tmpdir(), 'gtm-e2e-preview-'));
  const pidFile = join(pidDir, 'preview.pid');
  let status = 1;
  try {
    const result = run([], {
      E2E_TARGET_FIXTURES: '0',
      E2E_DISCOVERY: '0',
      E2E_PREVIEW_PID_FILE: pidFile,
    });
    status = result.status ?? 1;
    if (process.env.E2E_PRODUCTION_PREVIEW === '1' && !args.includes('--list')) {
      const pid = Number(readFileSync(pidFile, 'utf8').trim());
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid production preview PID');
      let pidStopped = false;
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        pidStopped = true;
      }
      mkdirSync(join(root, 'build-metrics'), { recursive: true });
      writeFileSync(
        join(root, 'build-metrics/e2e-preview-lifecycle.json'),
        JSON.stringify({ pid, pidStopped, exitCode: status }, null, 2),
      );
      if (!pidStopped) throw new Error(`Production preview PID ${pid} did not stop`);
      process.stdout.write(`Production preview PID ${pid}: verified stopped\n`);
    }
  } finally {
    rmSync(pidDir, { recursive: true, force: true });
  }
  process.exit(status);
}
