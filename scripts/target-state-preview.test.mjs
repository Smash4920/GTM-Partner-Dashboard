import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { access } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

test('unknown fixture states fail before starting a preview', () => {
  const result = spawnSync(process.execPath, ['scripts/target-state-preview.mjs', 'invalid'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown target-state fixture/);
  assert.doesNotMatch(result.stdout, /"event":"ready"/);
});

test('fixture selection fails rather than silently resharding the matrix', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/run-e2e.mjs', '--grep', 'VAL-DATA-002', '--shard=1/1', '--list'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Serial fixture E2E cannot be sharded/);
});

test('VAL-RES-011 selects both the real scaled success and isolated scaled retry cases', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/run-e2e.mjs', '--grep', 'VAL-RES-011', '--list'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /target-state-fixtures\.spec\.ts.*VAL-RES-011: built Scaled 100×/);
  assert.match(result.stdout, /action-route-resilience\.spec\.ts.*VAL-RES-011: Scaled 100×/);
});

test(
  'shutdown escalates for an unresponsive owned preview and removes temporary output',
  {
    timeout: 60_000,
  },
  async () => {
    const runner = spawn(process.execPath, ['scripts/target-state-preview.mjs', 'finite'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(runner, 'close');
    const events = [];
    let buffer = '';
    let resolveReady;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    runner.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines.filter((line) => line.startsWith('{"event":'))) {
        const event = JSON.parse(line);
        events.push(event);
        if (event.event === 'ready') resolveReady(event);
      }
    });
    let stderr = '';
    runner.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const preview = await Promise.race([
      ready,
      closed.then(() => {
        throw new Error(`Startup failed: ${stderr}`);
      }),
    ]);
    try {
      process.kill(preview.pid, 'SIGSTOP');
      runner.kill('SIGTERM');
      const [code] = await closed;
      assert.equal(code, 0, stderr);
      assert.deepEqual(events.at(-1), {
        event: 'stopped',
        state: 'finite',
        pid: preview.pid,
        pidStopped: true,
        outDir: preview.outDir,
      });
      assert.throws(() => process.kill(preview.pid, 0), { code: 'ESRCH' });
      await assert.rejects(access(preview.outDir), { code: 'ENOENT' });
    } finally {
      runner.kill('SIGTERM');
    }
  },
);
