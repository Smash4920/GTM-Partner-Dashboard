import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWithDiagnostics } from './e2e-diagnostics.mjs';
import { assertWorkerLimit, prepareFixtures } from './e2e-fixtures.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const args = process.argv.slice(2);
const started = performance.now();
const phases = [];
const fixtureFile = 'target-state-fixtures.spec.ts';
if (args.some((arg) => arg === '--shard' || arg.startsWith('--shard='))) {
  throw new Error('Serial fixture E2E cannot be sharded; run the combined suite without --shard.');
}
const policy = spawnSync(
  process.execPath,
  ['--test', 'scripts/e2e-fixtures.test.mjs', 'scripts/e2e-diagnostics.test.mjs'],
  { cwd: root, stdio: 'inherit' },
);
if (policy.status !== 0) process.exit(policy.status ?? 1);

function run(extraArgs, env, capture = false) {
  return spawnSync(process.execPath, [cli, 'test', ...args, ...extraArgs], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
}

async function measured(name, extraArgs, env) {
  const start = performance.now();
  let diagnostics;
  let result;
  if (args.includes('--list')) {
    result = run(extraArgs, env);
  } else {
    const parent = join(root, 'build-metrics/e2e-diagnostics');
    mkdirSync(parent, { recursive: true });
    diagnostics = mkdtempSync(
      join(parent, `${env.E2E_TARGET_FIXTURES === '1' ? 'serial' : 'ordinary'}-`),
    );
    process.stdout.write(`E2E local crash diagnostics: ${diagnostics}\n`);
    result = await runWithDiagnostics(process.execPath, [cli, 'test', ...args, ...extraArgs], {
      cwd: root,
      directory: diagnostics,
      env: {
        ...process.env,
        ...env,
        // Browser process stderr, not API/protocol or application console tracing.
        DEBUG: [process.env.DEBUG, 'pw:browser'].filter(Boolean).join(','),
      },
    });
  }
  phases.push({
    name,
    durationMs: Math.round(performance.now() - start),
    exitCode: result.status,
    diagnostics,
  });
  return result;
}

function finish(status) {
  if (!args.includes('--list')) {
    mkdirSync(join(root, 'build-metrics'), { recursive: true });
    const timing = {
      durationMs: Math.round(performance.now() - started),
      exitCode: status,
      ordinaryWorkers: report.config.workers,
      serialFixtureWorkers: 1,
      phases,
      remoteCI: 'unverified',
    };
    writeFileSync(join(root, 'build-metrics/e2e-timing.json'), JSON.stringify(timing, null, 2));
    process.stdout.write(`E2E wall time: ${timing.durationMs}ms; exit ${status}\n`);
  }
  process.exit(status);
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
assertWorkerLimit(report.config.workers);
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
  const result = await measured('serial target fixtures', [], {
    E2E_TARGET_FIXTURES: '1',
    E2E_DISCOVERY: '0',
  });
  if (result.status !== 0) finish(result.status ?? 1);
}
if (selected.some((file) => !file.endsWith(fixtureFile))) {
  const pidDir = mkdtempSync(join(tmpdir(), 'gtm-e2e-preview-'));
  const pidFile = join(pidDir, 'preview.pid');
  let status = 1;
  let prepared;
  try {
    const preparationStarted = performance.now();
    prepared = args.includes('--list')
      ? { env: {}, cleanup() {} }
      : prepareFixtures(selected, root);
    phases.push({
      name: 'immutable fixture preparation',
      durationMs: Math.round(performance.now() - preparationStarted),
      exitCode: 0,
    });
    const result = await measured('ordinary production preview', [], {
      ...prepared.env,
      E2E_TARGET_FIXTURES: '0',
      E2E_DISCOVERY: '0',
      E2E_PREVIEW_PID_FILE: pidFile,
    });
    status = result.status ?? 1;
    if (!args.includes('--list') && existsSync(pidFile)) {
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
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    phases.push({ name: 'preparation or preview lifecycle failure', exitCode: 1 });
    status = 1;
  } finally {
    prepared?.cleanup();
    rmSync(pidDir, { recursive: true, force: true });
  }
  finish(status);
}
finish(0);
