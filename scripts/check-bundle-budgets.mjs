import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

export const DEFAULT_CONFIG_PATH = 'config/bundle-budgets.json';
export const DEFAULT_REPORT_PATH = 'build-metrics/bundle-budgets.json';

/**
 * Translate a repository-relative glob into a regular expression. Only `*`
 * (within a path segment) and `**` (across segments) are supported, which is
 * all the budget file uses; anything more would be a dependency.
 */
export function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const withWildcards = escaped
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '.*');
  return new RegExp(`^${withWildcards}$`);
}

export function listRelativeFiles(directory, repositoryRoot) {
  if (!existsSync(directory)) {
    return [];
  }

  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        files.push(relative(repositoryRoot, entryPath).split('\\').join('/'));
      }
    }
  };

  visit(directory);
  return files.sort();
}

/**
 * Gzip with the highest compression level so the measured number is the
 * smallest the asset can be. That makes the budget a hard ceiling rather than
 * one that shifts with the runner's zlib defaults.
 */
export function gzipBytes(filePath) {
  return gzipSync(readFileSync(filePath), { level: 9 }).byteLength;
}

export function loadBundleBudgets(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!Array.isArray(config.budgets) || config.budgets.length === 0) {
    throw new Error(`${configPath} must declare at least one budget.`);
  }
  return config.budgets;
}

/**
 * Pure evaluation of the budgets against the already-measured candidates.
 * `candidates` is a list of `{ path, bytes }`, where `bytes` is the gzip size.
 */
export function evaluateBudgets(budgets, candidates) {
  return budgets.map((budget) => {
    const matcher = globToRegExp(budget.pattern);
    const matched = candidates.filter((candidate) => matcher.test(candidate.path));
    const measuredBytes =
      budget.aggregate === 'sum'
        ? matched.reduce((total, candidate) => total + candidate.bytes, 0)
        : Math.max(0, ...matched.map((candidate) => candidate.bytes));
    const matchedBytes = matched.reduce((total, candidate) => total + candidate.bytes, 0);
    const withinLimit = matched.length > 0 && measuredBytes <= budget.limitBytes;

    return {
      name: budget.name,
      pattern: budget.pattern,
      aggregate: budget.aggregate,
      limitBytes: budget.limitBytes,
      measuredBytes,
      matchedBytes,
      matchedFiles: matched.map((candidate) => candidate.path),
      withinLimit,
    };
  });
}

function formatBytes(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function buildBudgetReport(results) {
  const failed = results.filter((result) => !result.withinLimit);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? 'passed' : 'failed',
    budgets: results.map((result) => ({
      ...result,
      headroomBytes: result.limitBytes - result.measuredBytes,
    })),
  };
}

/**
 * Write the report through Prettier so a generated `build-metrics` file stays
 * clean for `npm run format:check` wherever the build runs.
 */
async function writeReport(reportPath, report) {
  const options = (await prettier.resolveConfig(reportPath)) ?? {};
  const contents = await prettier.format(JSON.stringify(report), { ...options, parser: 'json' });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, contents);
}

async function run() {
  const repositoryRoot = process.cwd();
  const configPath = resolve(
    repositoryRoot,
    process.env.BUNDLE_BUDGET_CONFIG ?? DEFAULT_CONFIG_PATH,
  );
  const reportPath = resolve(
    repositoryRoot,
    process.env.BUNDLE_BUDGET_REPORT ?? DEFAULT_REPORT_PATH,
  );
  const assetDirectory = resolve(repositoryRoot, 'dist/assets');

  if (!existsSync(assetDirectory)) {
    console.error(
      'Bundle budget check failed: dist/assets does not exist. Run `npm run build` first.',
    );
    process.exitCode = 1;
    return;
  }

  const candidates = listRelativeFiles(assetDirectory, repositoryRoot).map((path) => ({
    path,
    bytes: gzipBytes(resolve(repositoryRoot, path)),
  }));

  const results = evaluateBudgets(loadBundleBudgets(configPath), candidates);
  const report = buildBudgetReport(results);

  await writeReport(reportPath, report);

  console.log(`Bundle budgets (${new Date().toISOString()}):`);
  for (const result of report.budgets) {
    const marker = result.withinLimit ? 'ok  ' : 'FAIL';
    console.log(
      `  ${marker} ${result.name}: ${formatBytes(result.measuredBytes)} / ${formatBytes(
        result.limitBytes,
      )} across ${result.matchedFiles.length} file(s)`,
    );
  }

  const summary = [
    '## Bundle budget',
    '',
    '| Budget | Measured (gzip) | Limit | Result |',
    '| --- | ---: | ---: | --- |',
    ...report.budgets.map(
      (result) =>
        `| ${result.name} | ${formatBytes(result.measuredBytes)} | ${formatBytes(
          result.limitBytes,
        )} | ${result.withinLimit ? 'pass' : 'fail'} |`,
    ),
    '',
  ].join('\n');

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  }

  if (report.status !== 'passed') {
    console.error(
      '\nBundle budget exceeded. Reduce the bundle or, with a written reason, raise the limit in config/bundle-budgets.json.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\nBundle budgets passed.');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
