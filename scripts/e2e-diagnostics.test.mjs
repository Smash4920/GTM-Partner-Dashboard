import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { boundedTail, collectResources, runWithDiagnostics } from './e2e-diagnostics.mjs';

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gtm-e2e-diagnostics-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('log tails have an exact byte bound and disclose dropped bytes', () => {
  const tail = boundedTail(4);
  tail.append(Buffer.from('abc'));
  tail.append(Buffer.from('def'));
  assert.equal(tail.value.toString(), 'cdef');
  assert.equal(tail.droppedBytes, 2);
  tail.append(Buffer.from('123456'));
  assert.equal(tail.value.toString(), '3456');
  assert.equal(tail.droppedBytes, 8);
});

test('resource collection only includes descendant technical fields and cgroup counters', (t) => {
  const directory = temporary(t);
  const procRoot = join(directory, 'proc');
  const cgroupRoot = join(directory, 'cgroup');
  mkdirSync(join(procRoot, 'self'), { recursive: true });
  mkdirSync(join(cgroupRoot, 'test'), { recursive: true });
  writeFileSync(join(procRoot, 'self/cgroup'), '0::/test\n');
  writeFileSync(
    join(procRoot, 'meminfo'),
    'MemTotal: 100 kB\nMemAvailable: 50 kB\nUnknown: private\n',
  );
  writeFileSync(join(cgroupRoot, 'test/memory.events'), 'oom 0\noom_kill 0\n');
  for (const [pid, parent] of [
    [100, 1],
    [101, 100],
    [102, 101],
    [103, 1],
  ]) {
    mkdirSync(join(procRoot, String(pid)));
    writeFileSync(
      join(procRoot, String(pid), 'status'),
      `Name: private\nPid: ${pid}\nPPid: ${parent}\nVmRSS: 10 kB\nThreads: 2\n`,
    );
  }
  const result = collectResources(100, { procRoot, cgroupRoot, shmPath: directory });
  assert.deepEqual(result.memory, { MemTotal: '100 kB', MemAvailable: '50 kB' });
  assert.deepEqual(
    result.processes.items.map(({ pid }) => pid),
    [100, 101, 102],
  );
  assert.equal(result.cgroupVersion, 2);
  assert.equal(result.cgroups[1].values['memory.events'], 'oom 0\noom_kill 0\n');
  assert.doesNotMatch(JSON.stringify(result), /private|Name/);
  assert.equal(typeof result.sharedMemory.availableBlocks, 'number');
});

test('missing resources are explicit and cgroup traversal is not followed', (t) => {
  const directory = temporary(t);
  mkdirSync(join(directory, 'self'));
  writeFileSync(join(directory, 'self/cgroup'), '0::/../../outside\n');
  const result = collectResources(100, {
    procRoot: directory,
    cgroupRoot: join(directory, 'cgroup'),
    shmPath: join(directory, 'missing'),
  });
  assert.equal(result.cgroups.length, 1);
  assert.equal(result.cgroups[0].values['memory.events'], 'unavailable:ENOENT');
  assert.deepEqual(result.sharedMemory, { unavailable: 'ENOENT' });
});

test('streamed crash output preserves stderr, snapshots and failing exit without a retry', async (t) => {
  const directory = temporary(t);
  const output = { stdout: '', stderr: '' };
  const result = await runWithDiagnostics(
    process.execPath,
    [
      '-e',
      "process.stdout.write('Target crashed\\n'); process.stderr.write('[pid=123][err] renderer diagnostic\\n'); process.exitCode = 7;",
    ],
    {
      directory,
      stdout: { write: (chunk) => (output.stdout += chunk.toString()) },
      stderr: { write: (chunk) => (output.stderr += chunk.toString()) },
      snapshot: (pid) => ({ rootPid: pid, counter: 42 }),
    },
  );
  assert.equal(result.status, 7);
  assert.equal(readFileSync(join(directory, 'stdout.log'), 'utf8'), output.stdout);
  assert.equal(readFileSync(join(directory, 'stderr.log'), 'utf8'), output.stderr);
  assert.match(output.stderr, /\[pid=123\]\[err\] renderer diagnostic/);
  const report = JSON.parse(readFileSync(join(directory, 'resources.json'), 'utf8'));
  assert.equal(report.cause, 'unknown');
  assert.equal(report.baseline.counter, 42);
  assert.equal(report.final.counter, 42);
  assert.equal(report.events.length, 1);
  assert.match(report.events[0].excerpt, /Target crashed/);
  assert.deepEqual(report.droppedBytes, { stdout: 0, stderr: 0 });
});

test('failed executable startup produces diagnostics and a failing status', async (t) => {
  const directory = temporary(t);
  const result = await runWithDiagnostics(join(directory, 'missing-executable'), [], {
    directory,
    snapshot: () => ({}),
  });
  assert.notEqual(result.status, 0);
  const report = JSON.parse(readFileSync(join(directory, 'resources.json'), 'utf8'));
  assert.equal(report.errorCode, 'ENOENT');
  assert.equal(report.cause, 'unknown');
});

test('rolling resources, crash events and stderr remain bounded with deterministic timers', async (t) => {
  const directory = temporary(t);
  t.mock.timers.enable({ apis: ['setInterval'] });
  const running = runWithDiagnostics(
    process.execPath,
    ['-e', "process.stderr.write(('FATAL: '+ 'x'.repeat(65536) + '\\n').repeat(32));"],
    {
      directory,
      stdout: { write() {} },
      stderr: { write() {} },
      snapshot: () => ({ counter: 42 }),
    },
  );
  t.mock.timers.tick(100_000);
  const inProgress = JSON.parse(readFileSync(join(directory, 'resources.json'), 'utf8'));
  assert.equal(inProgress.complete, false);
  assert.equal(inProgress.samples.length, 12);
  const result = await running;
  assert.equal(result.status, 0);
  const report = JSON.parse(readFileSync(join(directory, 'resources.json'), 'utf8'));
  assert.equal(report.complete, true);
  assert.equal(report.samples.length, 12);
  assert.equal(report.events.length, 8);
  for (const event of report.events) {
    assert.ok(event.excerpt.length <= 4096);
    assert.match(event.excerpt, /FATAL:/);
    assert.ok(readFileSync(join(directory, event.stderrFile)).length <= 128 * 1024);
    assert.ok(event.stderrDroppedBytes >= 0);
  }
  assert.equal(readFileSync(join(directory, 'stderr.log')).length, 1024 * 1024);
  assert.ok(report.droppedBytes.stderr > 0);
});
