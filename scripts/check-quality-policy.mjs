import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

import { DEFAULT_BUILD_BUDGET_MS } from './build-with-metrics.mjs';
import { MAX_FILE_BYTES, MAX_TEXT_LINES } from './check-file-limits.mjs';

// The final gate is ordered and blocking. New checks may be added inside an
// existing step, but neither a missing check nor an optional job is equivalent.
export const QUALITY_GATE = [
  'agents:check',
  'check:file-limits',
  'format:check',
  'test:debt',
  'test:build-metrics',
  'test:sentry-sync',
  'debt:check',
  'lint',
  'dead-code',
  'lint:duplicates',
  'docs:check',
  'client-boundary:check',
  'test:coverage:ci',
  'test:performance',
  'bundle:check',
  'workflows:check',
  'test:e2e',
].map((script) => `npm run ${script}`);

const COVERAGE_FLOORS = { statements: 95, branches: 90, functions: 96, lines: 96 };
const BUNDLE_CEILINGS = [
  ['Total JavaScript', 'dist/assets/*.js', 'sum', 245760],
  ['Application chunk', 'dist/assets/index-*.js', 'each', 69632],
  ['Recharts chunk', 'dist/assets/recharts-*.js', 'each', 158720],
  ['Chart dependencies chunk', 'dist/assets/charts-vendor-*.js', 'each', 28672],
  ['Stylesheet', 'dist/assets/*.css', 'each', 30720],
];
const DEPENDENCY_CEILINGS = [
  ['recharts', 12582912],
  ['react-dom', 6291456],
  ['@fontsource/geist-mono', 4194304],
  ['@fontsource/geist-sans', 1572864],
  ['react', 1048576],
];
const SIZE_CEILINGS = [235, 65, 150, 24];

export function collectQualityPolicy(root) {
  const read = (path) => readFileSync(new URL(path, root), 'utf8');
  const json = (path) => JSON.parse(read(path));
  const vite = read('vite.config.ts');
  const ci = parse(read('.github/workflows/ci.yml'));
  const dependencies = json('config/dependency-budgets.json');
  return {
    coverage: Object.fromEntries(
      Object.keys(COVERAGE_FLOORS).map((key) => [
        key,
        Number(vite.match(new RegExp(`${key}:\\s*(\\d+)`))?.[1]),
      ]),
    ),
    maxFileBytes: MAX_FILE_BYTES,
    maxTextLines: MAX_TEXT_LINES,
    complexity: Number(
      read('eslint.config.js').match(/complexity:\s*\['error',\s*\{\s*max:\s*(\d+)/)?.[1],
    ),
    duplication: json('.jscpd.json').threshold,
    buildBudgetMs: DEFAULT_BUILD_BUDGET_MS,
    testPerformance: json('config/test-performance.json'),
    bundleBudgets: json('config/bundle-budgets.json').budgets,
    dependencyBudgets: dependencies.budgets,
    dependencyTotalBytes: dependencies.totalLimitBytes,
    sizeLimits: json('package.json')['size-limit'],
    typescript: json('tsconfig.app.json').compilerOptions,
    documents: Object.fromEntries(['README.md', 'AGENTS.md'].map((path) => [path, read(path)])),
    ciNonBlocking: Object.values(ci.jobs).some((job) => Boolean(job['continue-on-error'])),
    ciConditional: Object.values(ci.jobs).some((job) => Boolean(job.if)),
    ciBuildBudgetMs: Number(
      ci.jobs.verify.steps.find((step) => step.run === 'npm run bundle:check')?.env
        ?.BUILD_BUDGET_MS,
    ),
    ciSteps: Object.values(ci.jobs).flatMap((job) =>
      job.steps.filter((step) => QUALITY_GATE.includes(step.run)),
    ),
  };
}

export function checkQualityPolicy(facts) {
  const issues = [];
  const ceiling = (name, actual, maximum) => {
    if (!Number.isFinite(actual) || actual <= 0 || actual > maximum) {
      issues.push(`${name}: ${actual} exceeds effective ceiling ${maximum}`);
    }
  };
  for (const [key, minimum] of Object.entries(COVERAGE_FLOORS)) {
    if (!Number.isFinite(facts.coverage[key]) || facts.coverage[key] < minimum) {
      issues.push(`coverage ${key}: must remain at least ${minimum}%`);
    }
  }
  for (const [name, maximum] of Object.entries({
    maxFileBytes: 1048576,
    maxTextLines: 1200,
    complexity: 20,
    duplication: 1.5,
    buildBudgetMs: 60000,
  }))
    ceiling(name, facts[name], maximum);
  ceiling('Vitest total', facts.testPerformance.totalBudgetMs, 90000);
  ceiling('Vitest individual', facts.testPerformance.slowestTestBudgetMs, 8000);
  ceiling('CI build override', facts.ciBuildBudgetMs, 60000);
  ceiling('production dependencies total', facts.dependencyTotalBytes, 33554432);
  for (const [name, pattern, aggregate, maximum] of BUNDLE_CEILINGS) {
    const budget = facts.bundleBudgets.find((entry) => entry.name === name);
    ceiling(name, budget?.limitBytes, maximum);
    if (budget?.pattern !== pattern || budget?.aggregate !== aggregate) {
      issues.push(`${name}: must retain ${aggregate} over ${pattern}`);
    }
  }
  for (const [name, maximum] of DEPENDENCY_CEILINGS) {
    ceiling(
      name,
      facts.dependencyBudgets.find((entry) => entry.name === name)?.limitBytes,
      maximum,
    );
  }
  BUNDLE_CEILINGS.slice(0, 4).forEach(([name, path], index) => {
    const budget = facts.sizeLimits.find((entry) => entry.name === name);
    const match = budget?.limit.match(/^([\d.]+) kB$/);
    ceiling(`size-limit ${name}`, Number(match?.[1]), SIZE_CEILINGS[index]);
    if (budget?.path !== path) issues.push(`size-limit ${name}: must retain ${path}`);
  });
  for (const key of [
    'strict',
    'noUnusedLocals',
    'noUnusedParameters',
    'noFallthroughCasesInSwitch',
  ]) {
    if (facts.typescript[key] !== true) issues.push(`TypeScript ${key}: must remain true`);
  }
  if (
    facts.ciNonBlocking ||
    facts.ciConditional ||
    facts.ciSteps.some((step) => step['continue-on-error'] || step.if)
  ) {
    issues.push('quality gate CI jobs and steps must be unconditional and blocking');
  }
  if (JSON.stringify(facts.ciSteps.map((step) => step.run)) !== JSON.stringify(QUALITY_GATE)) {
    issues.push('CI must retain every gate step in the approved order');
  }
  for (const [path, text] of Object.entries(facts.documents)) {
    const blocks = [...text.matchAll(/```bash\n([\s\S]*?)```/g)];
    if (
      !blocks.some(
        (block) => JSON.stringify(block[1].trim().split('\n')) === JSON.stringify(QUALITY_GATE),
      )
    )
      issues.push(`${path}: must document the complete ordered gate`);
  }
  return issues;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const facts = collectQualityPolicy(new URL('../', import.meta.url));
  const issues = checkQualityPolicy(facts);
  if (issues.length) {
    console.error(issues.join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      'Quality policy passed: 17 blocking gate steps; coverage 95/90/96/96%; ' +
        '1 MiB/1,200 lines; complexity 20; duplication 1.5%; build 60,000 ms; ' +
        'Vitest 90,000/8,000 ms; all gzip, size-limit, and dependency ceilings preserved.',
    );
  }
}
