import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { validateAgentsMarkdown } from './check-agents-md.mjs';

const temporaryDirectories = [];

function createRepository(files = []) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), 'agents-md-check-'));
  temporaryDirectories.push(repositoryRoot);

  for (const file of files) {
    const filePath = join(repositoryRoot, file);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, '');
  }

  return repositoryRoot;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('AGENTS.md freshness checks', () => {
  it('accepts documented npm commands and repository paths that are current', () => {
    const repositoryRoot = createRepository([
      'package-lock.json',
      'README.md',
      'src/lib/metrics.ts',
    ]);
    const markdown = [
      'Read `README.md` and `src/lib/metrics.ts`.',
      'Do not commit `dist/` or `*.tsbuildinfo`.',
      '```bash',
      'npm ci',
      'npm run lint # explain this command',
      'npm test -- src/lib/metrics.test.ts',
      '```',
    ].join('\n');

    assert.deepEqual(
      validateAgentsMarkdown({
        markdown,
        packageJson: { scripts: { lint: 'eslint .', test: 'vitest run' } },
        repositoryRoot,
      }),
      [],
    );
  });

  it('reports stale npm scripts, unvalidated commands, and missing paths', () => {
    const repositoryRoot = createRepository(['package-lock.json']);
    const markdown = [
      'Read `docs/removed.md` and `missing.config.ts`.',
      '```bash',
      'npm run removed',
      'npm run lint && node scripts/manual.mjs',
      '```',
    ].join('\n');

    assert.deepEqual(
      validateAgentsMarkdown({
        markdown,
        packageJson: { scripts: {} },
        repositoryRoot,
      }),
      [
        'Documented command `npm run removed` references missing package script `removed`.',
        'Documented shell command is not validated: `npm run lint && node scripts/manual.mjs`.',
        'Documented repository path does not exist: `docs/removed.md`.',
        'Documented repository path does not exist: `missing.config.ts`.',
      ],
    );
  });

  it('requires the lockfile promised by the npm ci instructions', () => {
    const repositoryRoot = createRepository();

    assert.deepEqual(
      validateAgentsMarkdown({
        markdown: '```bash\nnpm ci\n```',
        packageJson: { scripts: {} },
        repositoryRoot,
      }),
      ['`npm ci` is documented, but package-lock.json does not exist.'],
    );
  });
});
