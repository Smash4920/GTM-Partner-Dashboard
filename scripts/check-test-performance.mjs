import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_JUNIT_PATH = 'test-results/vitest-junit.xml';
export const DEFAULT_CONFIG_PATH = 'config/test-performance.json';
export const DEFAULT_REPORT_PATH = 'build-metrics/test-performance.json';

function decodeEntities(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAttributes(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([A-Za-z_][\w.-]*)="([^"]*)"/g)) {
    attributes[match[1]] = decodeEntities(match[2]);
  }
  return attributes;
}

/**
 * Parse the JUnit report Vitest writes with `--reporter=junit`. Only the
 * fields the timing budget needs are read, so a future reporter version that
 * adds elements does not break the parser.
 */
export function parseJunit(xml) {
  const testCases = [];
  const testCasePattern = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;

  for (const match of xml.matchAll(testCasePattern)) {
    const attributes = parseAttributes(match[1]);
    const body = match[2] ?? '';
    const status =
      body.includes('<failure') || body.includes('<error')
        ? 'failed'
        : body.includes('<skipped')
          ? 'skipped'
          : 'passed';

    testCases.push({
      classname: attributes.classname ?? '',
      name: attributes.name ?? '',
      timeMs: Math.round(Number(attributes.time ?? '0') * 1000),
      status,
    });
  }

  const totalsMatch = xml.match(/<testsuites\b([^>]*)>/);
  const totals = totalsMatch ? parseAttributes(totalsMatch[1]) : {};

  return {
    testCount: Number(totals.tests ?? testCases.length),
    failureCount: Number(totals.failures ?? 0),
    errorCount: Number(totals.errors ?? 0),
    totalTimeMs: testCases.reduce((total, testCase) => total + testCase.timeMs, 0),
    testCases,
  };
}

export function evaluateTestPerformance({ parsed, config }) {
  const sorted = [...parsed.testCases].sort((left, right) => right.timeMs - left.timeMs);
  const slowest = sorted.slice(0, config.reportSlowest ?? 15);
  const slowestTest = sorted[0];
  const violations = [];

  if (parsed.totalTimeMs > config.totalBudgetMs) {
    violations.push(
      `Suite took ${(parsed.totalTimeMs / 1000).toFixed(2)}s, over the ${(
        config.totalBudgetMs / 1000
      ).toFixed(2)}s budget.`,
    );
  }

  if (slowestTest && slowestTest.timeMs > config.slowestTestBudgetMs) {
    violations.push(
      `Slowest test "${slowestTest.name}" took ${(slowestTest.timeMs / 1000).toFixed(
        2,
      )}s, over the ${(config.slowestTestBudgetMs / 1000).toFixed(2)}s per-test budget.`,
    );
  }

  return { slowest, violations, sorted };
}

function run() {
  const repositoryRoot = process.cwd();
  const junitPath = resolve(repositoryRoot, process.env.TEST_JUNIT_PATH ?? DEFAULT_JUNIT_PATH);
  const configPath = resolve(
    repositoryRoot,
    process.env.TEST_PERFORMANCE_CONFIG ?? DEFAULT_CONFIG_PATH,
  );
  const reportPath = resolve(
    repositoryRoot,
    process.env.TEST_PERFORMANCE_REPORT ?? DEFAULT_REPORT_PATH,
  );

  if (!existsSync(junitPath)) {
    console.warn(
      `Test performance report skipped: ${junitPath} is missing. Generate it with \`npm run test:coverage:ci\`.`,
    );
    return;
  }

  const parsed = parseJunit(readFileSync(junitPath, 'utf8'));
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const { slowest, violations } = evaluateTestPerformance({ parsed, config });

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: violations.length === 0 ? 'passed' : 'failed',
    testCount: parsed.testCount,
    failureCount: parsed.failureCount,
    errorCount: parsed.errorCount,
    totalTimeMs: parsed.totalTimeMs,
    totalBudgetMs: config.totalBudgetMs,
    slowestTestBudgetMs: config.slowestTestBudgetMs,
    slowest,
    violations,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    `Vitest: ${parsed.testCount} tests, ${parsed.failureCount} failures, ${(
      parsed.totalTimeMs / 1000
    ).toFixed(2)}s total (budget ${(config.totalBudgetMs / 1000).toFixed(2)}s).`,
  );
  console.log('Slowest tests:');
  for (const testCase of slowest) {
    console.log(
      `  ${(testCase.timeMs / 1000).toFixed(3)}s  ${testCase.classname} > ${testCase.name}`,
    );
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      '## Test performance',
      '',
      `**${parsed.testCount} tests** in ${(parsed.totalTimeMs / 1000).toFixed(2)}s (budget ${(
        config.totalBudgetMs / 1000
      ).toFixed(2)}s).`,
      '',
      '| Slowest test | Duration |',
      '| --- | ---: |',
      ...slowest.map(
        (testCase) =>
          `| ${testCase.classname} > ${testCase.name} | ${(testCase.timeMs / 1000).toFixed(3)}s |`,
      ),
      '',
    ].join('\n');
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary, { flag: 'a' });
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`Test performance budget exceeded: ${violation}`);
    }
    console.error(
      '\nSplit the slow test, remove real waiting, or raise the budget in config/test-performance.json with a reason.',
    );
    process.exitCode = 1;
    return;
  }

  console.log('Test performance budgets passed.');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
