import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_BUILD_BUDGET_MS = 60_000;
export const DEFAULT_REPORT_PATH = 'build-metrics/build.json';

const buildStages = [
  { name: 'TypeScript', command: 'tsc', args: ['-b'] },
  { name: 'Vite', command: 'vite', args: ['build'] },
];

function parsePositiveInteger(value, fallback, variableName) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }

  return parsed;
}

export function measureStage(stage, runCommand, now) {
  const startedAt = now();
  const result = runCommand(stage);
  const durationMs = Math.max(0, Math.round(now() - startedAt));

  return {
    name: stage.name,
    durationMs,
    exitCode: result.status ?? 1,
    status: result.status === 0 ? 'passed' : 'failed',
    error: result.error?.message,
  };
}

export function collectOutputMetrics(outputDirectory) {
  let fileCount = 0;
  let totalBytes = 0;

  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        fileCount += 1;
        totalBytes += statSync(entryPath).size;
      }
    }
  };

  visit(outputDirectory);
  return { fileCount, totalBytes };
}

export function createBuildReport({
  stages,
  budgetMs,
  output,
  commitSha,
  generatedAt,
  typescriptCacheHit,
}) {
  const totalDurationMs = stages.reduce((total, stage) => total + stage.durationMs, 0);
  const failed = stages.some((stage) => stage.status === 'failed');
  const status = failed ? 'failed' : totalDurationMs > budgetMs ? 'budget-exceeded' : 'passed';

  return {
    schemaVersion: 1,
    generatedAt,
    commitSha: commitSha || null,
    status,
    budgetMs,
    totalDurationMs,
    typescriptCacheHit: typescriptCacheHit ?? null,
    stages,
    output,
  };
}

export function formatSummary(report) {
  const rows = report.stages
    .map(
      (stage) => `| ${stage.name} | ${stage.status} | ${(stage.durationMs / 1000).toFixed(3)} s |`,
    )
    .join('\n');
  const output = report.output
    ? `${report.output.fileCount} files, ${(report.output.totalBytes / 1024).toFixed(1)} KiB`
    : 'Unavailable because the build did not complete';
  const cache =
    report.typescriptCacheHit === null
      ? 'Not reported'
      : report.typescriptCacheHit
        ? 'Hit'
        : 'Miss';

  return [
    '## Build performance',
    '',
    `**Status:** ${report.status}`,
    `**Total:** ${(report.totalDurationMs / 1000).toFixed(3)} s / ${(report.budgetMs / 1000).toFixed(3)} s budget`,
    `**TypeScript cache:** ${cache}`,
    `**Output:** ${output}`,
    '',
    '| Stage | Status | Duration |',
    '| --- | --- | ---: |',
    rows,
    '',
  ].join('\n');
}

function defaultRunCommand({ command, args }) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
}

export function runBuild({
  environment = process.env,
  now = () => performance.now(),
  runCommand = defaultRunCommand,
  generatedAt = () => new Date().toISOString(),
} = {}) {
  const budgetMs = parsePositiveInteger(
    environment.BUILD_BUDGET_MS,
    DEFAULT_BUILD_BUDGET_MS,
    'BUILD_BUDGET_MS',
  );
  const reportPath = resolve(environment.BUILD_METRICS_PATH ?? DEFAULT_REPORT_PATH);
  const stages = [];

  for (const stage of buildStages) {
    const result = measureStage(stage, runCommand, now);
    stages.push(result);
    if (result.status === 'failed') {
      break;
    }
  }

  const outputDirectory = resolve('dist');
  const output =
    stages.length === buildStages.length && stages.every((stage) => stage.status === 'passed')
      ? collectOutputMetrics(outputDirectory)
      : null;
  const report = createBuildReport({
    stages,
    budgetMs,
    output,
    commitSha: environment.GITHUB_SHA,
    generatedAt: generatedAt(),
    typescriptCacheHit:
      environment.TYPESCRIPT_CACHE_HIT === undefined
        ? null
        : environment.TYPESCRIPT_CACHE_HIT === 'true',
  });

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  const summary = formatSummary(report);
  if (environment.GITHUB_STEP_SUMMARY) {
    writeFileSync(environment.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  }

  console.log(summary);
  console.log(`Build metrics written to ${relative(process.cwd(), reportPath)}.`);

  for (const stage of stages) {
    if (stage.error) {
      console.error(`${stage.name} could not start: ${stage.error}`);
    }
  }

  return { report, exitCode: report.status === 'passed' ? 0 : 1 };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runBuild().exitCode;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
