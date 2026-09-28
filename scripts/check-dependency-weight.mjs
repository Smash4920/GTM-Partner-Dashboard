import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import prettier from 'prettier';

export const DEFAULT_CONFIG_PATH = 'config/dependency-budgets.json';
export const DEFAULT_REPORT_PATH = 'build-metrics/dependency-weights.json';

/**
 * Sum every regular file under a package directory. Symlinks are skipped so a
 * package that links into a shared store cannot be double-counted.
 */
export function directorySize(directory) {
  let total = 0;
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        total += statSync(entryPath).size;
      }
    }
  };
  visit(directory);
  return total;
}

export function loadDependencyBudgets(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!Array.isArray(config.budgets) || config.budgets.length === 0) {
    throw new Error(`${configPath} must declare at least one dependency budget.`);
  }
  return { totalLimitBytes: config.totalLimitBytes, budgets: config.budgets };
}

/**
 * Pure comparison step: `measured` is a Map of package name to installed
 * bytes. Returns one entry per budget plus the total row.
 */
export function evaluateDependencyBudgets({ budgets, totalLimitBytes }, measured) {
  const rows = budgets.map((budget) => {
    const measuredBytes = measured.get(budget.name) ?? 0;
    return {
      name: budget.name,
      limitBytes: budget.limitBytes,
      measuredBytes,
      withinLimit: measuredBytes > 0 && measuredBytes <= budget.limitBytes,
    };
  });

  const totalMeasuredBytes = [...measured.values()].reduce((total, bytes) => total + bytes, 0);
  const total = {
    name: 'Total production dependencies',
    limitBytes: totalLimitBytes,
    measuredBytes: totalMeasuredBytes,
    withinLimit: totalMeasuredBytes <= totalLimitBytes,
  };

  return [...rows, total];
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

/**
 * Write the report through Prettier so a generated `build-metrics` file stays
 * clean for `npm run format:check` wherever the check runs.
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
    process.env.DEPENDENCY_BUDGET_CONFIG ?? DEFAULT_CONFIG_PATH,
  );
  const reportPath = resolve(
    repositoryRoot,
    process.env.DEPENDENCY_BUDGET_REPORT ?? DEFAULT_REPORT_PATH,
  );
  const nodeModules = resolve(repositoryRoot, 'node_modules');

  if (!existsSync(nodeModules)) {
    console.warn(
      'Dependency weight check skipped: node_modules is missing. Run `npm ci` before the check.',
    );
    return;
  }

  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
  const dependencies = packageJson.dependencies ?? {};
  const measured = new Map();

  for (const name of Object.keys(dependencies)) {
    const packageDirectory = resolve(nodeModules, name);
    if (existsSync(packageDirectory)) {
      measured.set(name, directorySize(packageDirectory));
    }
  }

  const config = loadDependencyBudgets(configPath);
  const rows = evaluateDependencyBudgets(config, measured);
  const failed = rows.filter((row) => !row.withinLimit);

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? 'passed' : 'failed',
    totalLimitBytes: config.totalLimitBytes,
    budgets: rows.map((row) => ({ ...row, headroomBytes: row.limitBytes - row.measuredBytes })),
  };

  await writeReport(reportPath, report);

  console.log('Production dependency install sizes:');
  for (const row of rows) {
    const marker = row.withinLimit ? 'ok  ' : 'FAIL';
    console.log(
      `  ${marker} ${row.name}: ${formatBytes(row.measuredBytes)} / ${formatBytes(row.limitBytes)}`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      '## Dependency weight',
      '',
      '| Dependency | Installed | Limit | Result |',
      '| --- | ---: | ---: | --- |',
      ...rows.map(
        (row) =>
          `| ${row.name} | ${formatBytes(row.measuredBytes)} | ${formatBytes(row.limitBytes)} | ${
            row.withinLimit ? 'pass' : 'fail'
          } |`,
      ),
      '',
    ].join('\n');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  }

  if (failed.length > 0) {
    console.error(
      '\nA production dependency grew past its install budget. Prefer a smaller dependency or a targeted build-time trim; raise the limit in config/dependency-budgets.json only with a written reason.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('\nDependency weights passed.');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
