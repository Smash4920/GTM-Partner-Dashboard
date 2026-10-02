import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statfsSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

const LOG_BYTES = 1024 * 1024;
const MAX_PROCESSES = 64;
const MAX_SAMPLES = 12;
const MAX_EVENTS = 8;
const CGROUP_FILES = [
  'memory.current',
  'memory.peak',
  'memory.max',
  'memory.events',
  'memory.events.local',
  'memory.stat',
  'pids.current',
  'pids.max',
  'cpu.stat',
];

export function boundedTail(limit = LOG_BYTES) {
  let value = Buffer.alloc(0);
  let totalBytes = 0;
  return {
    append(chunk) {
      const bytes = Buffer.from(chunk);
      totalBytes += bytes.length;
      value = Buffer.concat([value, bytes.subarray(-limit)]).subarray(-limit);
    },
    get value() {
      return value;
    },
    get droppedBytes() {
      return totalBytes - value.length;
    },
  };
}

function read(path) {
  try {
    return readFileSync(path, 'utf8').slice(0, 16_384);
  } catch (error) {
    return `unavailable:${error.code ?? 'UNKNOWN'}`;
  }
}

function fields(text, allowed) {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.split(/:\s*/, 2))
      .filter(([key]) => allowed.includes(key)),
  );
}

function processes(procRoot, rootPid) {
  let pids;
  try {
    pids = readdirSync(procRoot).filter((name) => /^\d+$/.test(name));
  } catch (error) {
    return { unavailable: error.code ?? 'UNKNOWN' };
  }
  const scanned = pids.slice(0, 4096).map((pid) => {
    const status = fields(read(join(procRoot, pid, 'status')), [
      'Pid',
      'PPid',
      'State',
      'VmRSS',
      'VmHWM',
      'VmSize',
      'Threads',
    ]);
    return { pid: Number(pid), parentPid: Number(status.PPid), status };
  });
  const descendants = new Set([rootPid]);
  for (let pass = 0; pass < MAX_PROCESSES; pass++) {
    const previous = descendants.size;
    for (const item of scanned) {
      if (descendants.has(item.parentPid)) descendants.add(item.pid);
    }
    if (descendants.size === previous) break;
  }
  const selected = scanned.filter((item) => descendants.has(item.pid));
  return {
    scanned: scanned.length,
    scanTruncated: pids.length > scanned.length,
    truncated: selected.length > MAX_PROCESSES,
    items: selected.slice(0, MAX_PROCESSES),
  };
}

export function collectResources(
  rootPid,
  { procRoot = '/proc', cgroupRoot = '/sys/fs/cgroup', shmPath = '/dev/shm' } = {},
) {
  const membership = read(join(procRoot, 'self/cgroup')).match(/^0::(.*)$/m);
  const directories = new Set([cgroupRoot]);
  if (membership) {
    const directory = resolve(cgroupRoot, `.${membership[1]}`);
    if (directory === cgroupRoot || directory.startsWith(`${cgroupRoot}${sep}`)) {
      directories.add(directory);
    }
  }
  let sharedMemory;
  try {
    const { bsize, blocks, bfree, bavail } = statfsSync(shmPath);
    sharedMemory = { blockBytes: bsize, blocks, freeBlocks: bfree, availableBlocks: bavail };
  } catch (error) {
    sharedMemory = { unavailable: error.code ?? 'UNKNOWN' };
  }
  return {
    rootPid,
    memory: fields(read(join(procRoot, 'meminfo')), [
      'MemTotal',
      'MemAvailable',
      'SwapTotal',
      'SwapFree',
    ]),
    pressure: read(join(procRoot, 'pressure/memory')),
    sharedMemory,
    cgroupVersion: membership ? 2 : 'unavailable',
    cgroups: [...directories].map((directory) => ({
      directory,
      values: Object.fromEntries(
        CGROUP_FILES.map((file) => [file, read(join(directory, file)).slice(0, 4096)]),
      ),
    })),
    processes: processes(procRoot, rootPid),
  };
}

// Local test artifacts only: never read process environments or command lines,
// launch another browser, change Chromium flags, or infer a crash cause.
export async function runWithDiagnostics(
  command,
  args,
  {
    cwd,
    env,
    directory,
    stdout = process.stdout,
    stderr = process.stderr,
    snapshot = collectResources,
    intervalMs = 5000,
  },
) {
  const tails = { stdout: boundedTail(), stderr: boundedTail() };
  const samples = [];
  const events = [];
  const started = performance.now();
  const child = spawn(command, args, { cwd, env, stdio: ['inherit', 'pipe', 'pipe'] });
  const capture = (reason) => {
    try {
      return {
        reason,
        elapsedMs: Math.round(performance.now() - started),
        ...snapshot(child.pid),
      };
    } catch (error) {
      return { reason, unavailable: error.code ?? 'UNKNOWN' };
    }
  };
  const baseline = capture('start');
  let errorCode;
  let result = { status: null, signal: null };
  function persist(final) {
    for (const name of ['stdout', 'stderr']) {
      writeFileSync(join(directory, `${name}.log`), tails[name].value);
    }
    writeFileSync(
      join(directory, 'resources.json'),
      JSON.stringify(
        {
          ...result,
          complete: Boolean(final),
          errorCode,
          cause: 'unknown',
          logByteLimit: LOG_BYTES,
          droppedBytes: { stdout: tails.stdout.droppedBytes, stderr: tails.stderr.droppedBytes },
          baseline,
          samples,
          events,
          final,
        },
        null,
        2,
      ),
    );
  }
  persist();
  const prefixes = { stdout: '', stderr: '' };
  for (const [name, stream] of [
    ['stdout', stdout],
    ['stderr', stderr],
  ]) {
    child[name].on('data', (chunk) => {
      stream.write(chunk);
      tails[name].append(chunk);
      const text = prefixes[name] + chunk.toString();
      const match =
        /Target crashed|renderer.*crash|FATAL:|<process did exit:.*signal=(?!null)/i.exec(text);
      if (events.length < MAX_EVENTS && match) {
        // Keep the first recurrence's stderr even if later retries roll the
        // phase-wide tail forward. Never fabricate missing renderer output.
        const stderrFile = `event-${events.length + 1}-stderr.log`;
        const eventStderr = tails.stderr.value.subarray(-128 * 1024);
        writeFileSync(join(directory, stderrFile), eventStderr);
        events.push({
          stream: name,
          excerpt: text.slice(Math.max(0, match.index - 512), match.index + 3584),
          stderrFile,
          stderrDroppedBytes:
            tails.stderr.droppedBytes + tails.stderr.value.length - eventStderr.length,
          resource: capture('crash-or-abnormal-exit-output'),
        });
        persist();
        prefixes[name] = '';
      } else {
        prefixes[name] = text.slice(-128);
      }
    });
  }
  const timer = setInterval(() => {
    samples.push(capture('periodic'));
    if (samples.length > MAX_SAMPLES) samples.shift();
    persist();
  }, intervalMs);
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    result = await new Promise((resolveResult) => {
      child.on('error', (error) => {
        errorCode = error.code ?? 'UNKNOWN';
      });
      child.on('close', (status, signal) => resolveResult({ status, signal }));
    });
  } finally {
    clearInterval(timer);
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', terminate);
  }
  persist(capture('close'));
  return result;
}
