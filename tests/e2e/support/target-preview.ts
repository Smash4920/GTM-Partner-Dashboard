import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

export type TargetState =
  'finite' | 'no-target' | 'target-met' | 'action-resilience' | 'scaled-retry';
interface Ready {
  event: 'ready';
  pid: number;
  url: string;
  outDir: string;
  assets: { name: string; sha256: string }[];
}

export async function startTargetPreview(state: TargetState) {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const child = spawn(process.execPath, ['scripts/target-state-preview.mjs', state], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // close, unlike exit, guarantees that the final teardown record has drained.
  const exit = once(child, 'close');
  const events: Record<string, unknown>[] = [];
  let output = '';
  let buffer = '';
  let resolveReady: (ready: Ready) => void;
  const ready = new Promise<Ready>((resolve) => {
    resolveReady = resolve;
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    output += text;
    buffer += text;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('{"event":')) continue;
      const event = JSON.parse(line);
      events.push(event);
      if (event.event === 'ready') resolveReady(event);
    }
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let startup: Ready;
  try {
    startup = await Promise.race([
      ready,
      exit.then(() => {
        throw new Error(`Fixture runner exited before readiness:\n${output}`);
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Fixture readiness timed out')), 60_000);
      }),
    ]);
  } catch (error) {
    child.kill('SIGTERM');
    await exit;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  return {
    ...startup,
    runnerPid: child.pid,
    async stop() {
      child.kill('SIGTERM');
      const [code] = await exit;
      const stopped = events.find((event) => event.event === 'stopped');
      if (code !== 0 || stopped?.pidStopped !== true) {
        throw new Error(`Fixture teardown failed:\n${output}`);
      }
      return { events, output, runnerPid: child.pid, exitCode: code };
    },
  };
}
