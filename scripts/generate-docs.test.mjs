import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { renderNpmScripts, renderQualityGates, renderRepositoryMap } from './generate-docs.mjs';

const facts = {
  scripts: [
    { name: 'build', command: 'tsc -b && vite build' },
    { name: 'lint', command: 'eslint .' },
  ],
  ciScripts: new Set(['lint']),
  workflows: ['ci.yml'],
  configs: ['bundle-budgets.json'],
  runbooks: [{ file: 'docs/runbooks/incident-response.md', title: 'Incident response' }],
  skills: [
    {
      name: 'migrate-dashboard-data-view',
      hasSkillFile: true,
      description: 'Migrate a view to scoped data.',
    },
  ],
  topLevelDirectories: ['config', 'docs', 'scripts', 'src'],
  bundleBudgets: {
    budgets: [
      {
        name: 'Total JavaScript',
        pattern: 'dist/assets/*.js',
        aggregate: 'sum',
        limitBytes: 245760,
      },
    ],
  },
  dependencyBudgets: {
    totalLimitBytes: 33_554_432,
    budgets: [{ name: 'recharts', limitBytes: 12_582_912 }],
  },
  testPerformance: { totalBudgetMs: 90_000, slowestTestBudgetMs: 8_000, reportSlowest: 15 },
  qualityPolicy: {
    coverage: { statements: 95, branches: 90, functions: 96, lines: 96 },
    maxFileBytes: 1048576,
    maxTextLines: 1200,
    complexity: 20,
    duplication: 1.5,
    buildBudgetMs: 60000,
    sizeLimits: [{ name: 'Total JavaScript', limit: '235 kB' }],
  },
};

describe('generated npm scripts page', () => {
  it('lists every script in sorted order and marks CI usage', () => {
    const markdown = renderNpmScripts(facts);

    assert.match(markdown, /\| `build` \| `tsc -b && vite build` \| no \|/);
    assert.match(markdown, /\| `lint` \| `eslint \.` \| yes \|/);
    assert.ok(markdown.indexOf('`build`') < markdown.indexOf('`lint`'));
  });
});

describe('generated repository map page', () => {
  it('renders top-level directories, workflows, runbooks, and skills', () => {
    const markdown = renderRepositoryMap(facts);

    assert.match(markdown, /\| `src` \| Application source: shell/);
    assert.match(markdown, /\| `config` \| Checked-in budgets/);
    assert.match(markdown, /\.github\/workflows\/ci\.yml/);
    assert.match(markdown, /\[Incident response\]\(\.\.\/runbooks\/incident-response\.md\)/);
    assert.match(markdown, /\.skills\/migrate-dashboard-data-view\/SKILL\.md/);
  });
});

describe('generated quality gates page', () => {
  it('renders bundle, dependency, and test budgets', () => {
    const markdown = renderQualityGates(facts);

    assert.match(markdown, /240\.0 KiB \(gzip, sum\)/);
    assert.match(markdown, /\| `recharts` \| 12288\.0 KiB \|/);
    assert.match(markdown, /Total production dependency budget: 32768\.0 KiB/);
    assert.match(markdown, /Suite total: 90\.00s/);
    assert.match(markdown, /Statements: 95%/);
    assert.match(markdown, /Complexity: 20/);
    assert.match(markdown, /Build: 60,000 ms/);
    assert.match(markdown, /235 kB/);
    assert.ok(
      markdown.indexOf('npm run test:coverage:ci') < markdown.indexOf('npm run test:performance'),
    );
  });
});
