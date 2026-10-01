import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const state = process.argv[2] ?? 'finite';
if (!['finite', 'no-target', 'target-met'].includes(state)) {
  throw new Error('Unknown target-state fixture');
}
const outDir = await mkdtemp(join(tmpdir(), 'gtm-target-state-'));
const entry = `tests/fixtures/target-states/${state}.html`;
let stopping = false;
let preview;
let exited;
const readinessAbort = new AbortController();
let requestStop;
const stopRequested = new Promise((resolve) => {
  requestStop = resolve;
});
const stop = () => {
  stopping = true;
  readinessAbort.abort();
  preview?.kill('SIGTERM');
  requestStop();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

try {
  // This alternate input never touches ordinary dist or production config.
  await build({
    configFile: false,
    root,
    base: '/',
    plugins: [react()],
    build: {
      outDir,
      sourcemap: false,
      rollupOptions: { input: join(root, entry) },
    },
  });
  if (!stopping) {
    const assets = await Promise.all(
      (await readdir(join(outDir, 'assets')))
        .filter((name) => /\.(js|css)$/.test(name))
        .map(async (name) => ({
          name,
          sha256: createHash('sha256')
            .update(await readFile(join(outDir, 'assets', name)))
            .digest('hex'),
        })),
    );
    preview = spawn(
      process.execPath,
      [
        join(root, 'node_modules/vite/bin/vite.js'),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        '4173',
        '--strictPort',
        '--base',
        '/',
        '--outDir',
        outDir,
      ],
      { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    exited = once(preview, 'exit');
    const url = `http://127.0.0.1:4173/${entry}`;
    let ready = false;
    for (let attempt = 0; attempt < 100 && !stopping; attempt += 1) {
      if (preview.exitCode !== null) throw new Error('Fixture preview exited during startup');
      try {
        const response = await fetch(url, {
          signal: AbortSignal.any([readinessAbort.signal, AbortSignal.timeout(1_000)]),
        });
        ready = response.ok && (await response.text()).includes(`data-target-state="${state}"`);
      } catch {
        // Bounded readiness polling, never reuse a different service.
      }
      if (ready) break;
      await sleep(100);
    }
    if (!ready) throw new Error('Fixture preview did not become ready');
    process.stdout.write(
      `${JSON.stringify({ event: 'ready', state, pid: preview.pid, outDir, url, assets })}\n`,
    );
    await Promise.race([
      stopRequested,
      exited.then(([code, signal]) => {
        if (!stopping) throw new Error(`Fixture preview exited unexpectedly: ${code ?? signal}`);
      }),
    ]);
  }
} finally {
  if (preview?.exitCode === null && preview.signalCode === null) {
    preview.kill('SIGTERM');
    await Promise.race([exited, sleep(5_000, undefined, { ref: false })]);
    if (preview.exitCode === null && preview.signalCode === null) {
      preview.kill('SIGKILL');
      await exited;
    }
  }
  let pidStopped = true;
  if (preview?.pid) {
    try {
      process.kill(preview.pid, 0);
      pidStopped = false;
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
    }
  }
  await rm(outDir, { recursive: true, force: true });
  process.stdout.write(
    `${JSON.stringify({ event: 'stopped', state, pid: preview?.pid, pidStopped, outDir })}\n`,
  );
  if (!pidStopped) process.exitCode = 1;
}
