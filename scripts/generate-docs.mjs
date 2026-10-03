import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import prettier from 'prettier';
import { QUALITY_GATE, collectQualityPolicy } from './check-quality-policy.mjs';

export const GENERATED_DIRECTORY = 'docs/generated';

/**
 * Directories that are build output, dependencies, or tool caches. Excluding
 * them keeps the repository map stable across machines and checkouts.
 */
const EXCLUDED_DIRECTORIES = new Set([
  '.factory',
  '.git',
  '.vite',
  'build-metrics',
  'coverage',
  'dist',
  'droid-wiki',
  'node_modules',
  'playwright-report',
  'test-results',
]);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function listDirectory(directoryPath) {
  if (!existsSync(directoryPath)) {
    return [];
  }
  return readdirSync(directoryPath, { withFileTypes: true });
}

function ciScriptReferences(ciPath) {
  if (!existsSync(ciPath)) {
    return new Set();
  }

  const referenced = new Set();
  for (const match of readFileSync(ciPath, 'utf8').matchAll(/npm (?:run )?([A-Za-z0-9:._-]+)/g)) {
    referenced.add(match[1]);
  }
  return referenced;
}

function runbookSummaries(runbookDirectory) {
  return listDirectory(runbookDirectory)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'README.md')
    .map((entry) => entry.name)
    .sort()
    .map((fileName) => {
      const contents = readFileSync(join(runbookDirectory, fileName), 'utf8');
      const heading = contents.match(/^#\s+(.+)$/m);
      return {
        file: `docs/runbooks/${fileName}`,
        title: heading ? heading[1].trim() : fileName,
      };
    });
}

function skillSummaries(skillDirectory) {
  return listDirectory(skillDirectory)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const skillFile = join(skillDirectory, name, 'SKILL.md');
      const description = existsSync(skillFile)
        ? (readFileSync(skillFile, 'utf8').match(/^description:\s*(.+)$/m)?.[1] ?? '')
        : '';
      return { name, hasSkillFile: existsSync(skillFile), description: description.trim() };
    });
}

/**
 * Short purpose notes for the directories a contributor is most likely to
 * touch. A directory that is not listed still appears in the map; it is simply
 * uncategorized, so adding one does not require editing this file.
 */
const DIRECTORY_PURPOSES = {
  '.github': 'CI, release automation, and repository templates.',
  '.skills': 'Agent skills available for repository tasks.',
  '.zap': 'Reviewed OWASP ZAP baseline rules for the DAST workflow scan.',
  config: 'Checked-in budgets and release automation configuration.',
  docs: 'Product documentation and operational runbooks.',
  public: 'Static assets copied into the build unchanged.',
  scripts: 'Node policy checks and tooling run locally and in CI.',
  src: 'Application source: shell, views, components, data, and helpers.',
  tests: 'Playwright end-to-end browser tests.',
};

function topLevelDirectories(repositoryRoot) {
  return listDirectory(repositoryRoot)
    .filter((entry) => entry.isDirectory() && !EXCLUDED_DIRECTORIES.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Gather every fact the generated pages render. Pure with respect to the
 * working tree: given the same files it always produces the same structure,
 * which is what lets `docs:check` fail on drift.
 */
export function collectRepositoryFacts(repositoryRoot) {
  const packageJson = readJson(resolve(repositoryRoot, 'package.json'));
  const ciPath = resolve(repositoryRoot, '.github/workflows/ci.yml');

  return {
    generatedFrom: [
      'package.json',
      '.github/workflows/ci.yml',
      'config/*.json',
      'vite.config.ts',
      'eslint.config.js',
      '.jscpd.json',
      'scripts/check-file-limits.mjs',
      'scripts/build-with-metrics.mjs',
      'docs/runbooks/*',
      '.skills/*',
    ],
    scripts: Object.entries(packageJson.scripts ?? {})
      .map(([name, command]) => ({ name, command }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    ciScripts: ciScriptReferences(ciPath),
    bundleBudgets: readJson(resolve(repositoryRoot, 'config/bundle-budgets.json')),
    dependencyBudgets: readJson(resolve(repositoryRoot, 'config/dependency-budgets.json')),
    testPerformance: readJson(resolve(repositoryRoot, 'config/test-performance.json')),
    qualityPolicy: collectQualityPolicy(pathToFileURL(`${repositoryRoot}/`)),
    workflows: listDirectory(resolve(repositoryRoot, '.github/workflows'))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort(),
    configs: listDirectory(resolve(repositoryRoot, 'config'))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort(),
    runbooks: runbookSummaries(resolve(repositoryRoot, 'docs/runbooks')),
    skills: skillSummaries(resolve(repositoryRoot, '.skills')),
    topLevelDirectories: topLevelDirectories(repositoryRoot),
  };
}

function table(header, rows) {
  return [header, header.replace(/[^|]/g, '-'), ...rows].join('\n');
}

export function renderNpmScripts(facts) {
  return [
    '# npm scripts',
    '',
    'Every script declared in `package.json`. The CI column marks scripts run by',
    '`.github/workflows/ci.yml`. This page is generated by',
    '`scripts/generate-docs.mjs`; edit `package.json`, then run `npm run docs:generate`.',
    '',
    table(
      '| Script | Command | CI |',
      facts.scripts.map(
        (script) =>
          `| \`${script.name}\` | \`${script.command.replace(/\|/g, '\\|')}\` | ${
            facts.ciScripts.has(script.name) ? 'yes' : 'no'
          } |`,
      ),
    ),
    '',
  ].join('\n');
}

export function renderRepositoryMap(facts) {
  return [
    '# Repository map',
    '',
    'Generated from the working tree by `scripts/generate-docs.mjs`. Build output,',
    'dependencies, and tool caches are excluded.',
    '',
    '## Top-level directories',
    '',
    table(
      '| Directory | Purpose |',
      facts.topLevelDirectories.map(
        (name) => `| \`${name}\` | ${DIRECTORY_PURPOSES[name] ?? 'Uncategorized.'} |`,
      ),
    ),
    '',
    '## CI workflows',
    '',
    ...facts.workflows.map((name) => `- \`.github/workflows/${name}\``),
    '',
    '## Shared configuration',
    '',
    ...facts.configs.map((name) => `- \`config/${name}\``),
    '',
    '## Runbooks',
    '',
    ...facts.runbooks.map(
      (runbook) => `- [${runbook.title}](${relative('docs/generated', runbook.file)})`,
    ),
    '',
    '## Skills',
    '',
    ...facts.skills.map(
      (skill) =>
        `- \`.skills/${skill.name}/SKILL.md\`${skill.description ? ` — ${skill.description}` : ''}`,
    ),
    '',
  ].join('\n');
}

export function renderQualityGates(facts) {
  const { bundleBudgets, dependencyBudgets, testPerformance, qualityPolicy } = facts;
  const formatBytes = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

  return [
    '# Quality gates',
    '',
    'Effective limits from checked-in configuration and policy scripts. Never weaken',
    'a ratchet to make a failing check pass. `npm run quality:check` checks gate parity',
    'and preserves these floors and ceilings; it also runs inside `docs:check`.',
    '',
    '## Complete ordered gate',
    '',
    '```bash',
    ...QUALITY_GATE,
    '```',
    '',
    '## Coverage and static ratchets',
    '',
    `- Statements: ${qualityPolicy.coverage.statements}%`,
    `- Branches: ${qualityPolicy.coverage.branches}%`,
    `- Functions: ${qualityPolicy.coverage.functions}%`,
    `- Lines: ${qualityPolicy.coverage.lines}%`,
    `- File bytes: ${qualityPolicy.maxFileBytes} (1 MiB); text lines: ${qualityPolicy.maxTextLines}`,
    '- Only documented generated lockfiles are exempt from the text-line limit.',
    `- Complexity: ${qualityPolicy.complexity}`,
    `- Duplication: ${qualityPolicy.duplication}%`,
    '- Formatting, module boundaries, strict TypeScript, Knip, and linked debt stay blocking.',
    '',
    '## Build and size-limit ceilings',
    '',
    `- Build: ${qualityPolicy.buildBudgetMs.toLocaleString('en-US')} ms (TypeScript plus Vite)`,
    ...qualityPolicy.sizeLimits.map((budget) => `- ${budget.name}: ${budget.limit} (size-limit)`),
    '',
    '## Bundle budgets',
    '',
    table(
      '| Budget | Pattern | Limit |',
      bundleBudgets.budgets.map(
        (budget) =>
          `| ${budget.name} | \`${budget.pattern}\` | ${formatBytes(budget.limitBytes)} (gzip, ${budget.aggregate}) |`,
      ),
    ),
    '',
    '## Dependency install budgets',
    '',
    table(
      '| Dependency | Limit |',
      dependencyBudgets.budgets.map(
        (budget) => `| \`${budget.name}\` | ${formatBytes(budget.limitBytes)} |`,
      ),
    ),
    '',
    `Total production dependency budget: ${formatBytes(dependencyBudgets.totalLimitBytes)}.`,
    '',
    '## Test performance budgets',
    '',
    `- Suite total: ${(testPerformance.totalBudgetMs / 1000).toFixed(2)}s`,
    `- Slowest single test: ${(testPerformance.slowestTestBudgetMs / 1000).toFixed(2)}s`,
    '',
  ].join('\n');
}

export function renderGeneratedReadme() {
  return [
    '# Generated documentation',
    '',
    'These pages are produced from repository state by `scripts/generate-docs.mjs`.',
    'Do not edit them by hand; `npm run docs:check` fails when they drift.',
    '',
    '```bash',
    'npm run docs:generate  # rewrite the pages below',
    'npm run docs:check     # fail if the committed pages are stale',
    '```',
    '',
    '- [`npm-scripts.md`](./npm-scripts.md) — every `package.json` script and whether CI runs it.',
    '- [`repository-map.md`](./repository-map.md) — source layout, workflows, runbooks, and skills.',
    '- [`quality-gates.md`](./quality-gates.md) — ordered gate, coverage/static ratchets, build, bundle, dependency, and test budgets.',
    '',
  ].join('\n');
}

export async function generateDocs(repositoryRoot) {
  const facts = { ...collectRepositoryFacts(repositoryRoot), repositoryRoot };
  const options =
    (await prettier.resolveConfig(resolve(repositoryRoot, 'docs/generated/x.md'))) ?? {};
  const pages = {
    'README.md': renderGeneratedReadme(),
    'npm-scripts.md': renderNpmScripts(facts),
    'repository-map.md': renderRepositoryMap(facts),
    'quality-gates.md': renderQualityGates(facts),
  };

  const formatted = await Promise.all(
    Object.entries(pages).map(async ([name, markdown]) => [
      `${GENERATED_DIRECTORY}/${name}`,
      await prettier.format(markdown, { ...options, parser: 'markdown' }),
    ]),
  );

  return new Map(formatted);
}

function run({ check }) {
  const repositoryRoot = process.cwd();
  return generateDocs(repositoryRoot).then((docs) => {
    const drifted = [];
    for (const [relativePath, contents] of docs) {
      const absolutePath = resolve(repositoryRoot, relativePath);
      if (check) {
        const existing = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : undefined;
        if (existing !== contents) {
          drifted.push(relativePath);
        }
      } else {
        mkdirSync(dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, contents);
        console.log(`Wrote ${relativePath}.`);
      }
    }

    if (!check) {
      return 0;
    }

    if (drifted.length === 0) {
      console.log('Generated documentation is current.');
      return 0;
    }

    console.error('Generated documentation is stale for:');
    for (const relativePath of drifted) {
      console.error(`- ${relativePath}`);
    }
    console.error('\nRun `npm run docs:generate` and commit the result.');
    return 1;
  });
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run({ check: process.argv.includes('--check') })
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
