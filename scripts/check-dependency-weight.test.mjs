import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { directorySize, evaluateDependencyBudgets } from './check-dependency-weight.mjs';

const temporaryDirectories = [];

function createPackage(files) {
  const directory = mkdtempSync(join(tmpdir(), 'dependency-weight-'));
  temporaryDirectories.push(directory);
  for (const [file, contents] of Object.entries(files)) {
    const filePath = join(directory, file);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, contents);
  }
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('dependency install measurement', () => {
  it('sums sizes recursively including nested directories', () => {
    const directory = createPackage({
      'index.js': '12345',
      'lib/nested.js': '1234567',
    });

    assert.equal(directorySize(directory), 12);
  });

  it('reports each budget and the total', () => {
    const measured = new Map([
      ['recharts', 9_000],
      ['react', 400],
    ]);

    const rows = evaluateDependencyBudgets(
      {
        totalLimitBytes: 20_000,
        budgets: [
          { name: 'recharts', limitBytes: 10_000 },
          { name: 'react', limitBytes: 500 },
        ],
      },
      measured,
    );

    assert.deepEqual(
      rows.map((row) => [row.name, row.withinLimit]),
      [
        ['recharts', true],
        ['react', true],
        ['Total production dependencies', true],
      ],
    );
  });

  it('fails a dependency that grows past its install budget and fails a missing package', () => {
    const rows = evaluateDependencyBudgets(
      {
        totalLimitBytes: 1_000,
        budgets: [
          { name: 'recharts', limitBytes: 100 },
          { name: 'absent', limitBytes: 100 },
        ],
      },
      new Map([['recharts', 9_000]]),
    );

    assert.equal(rows[0].withinLimit, false);
    assert.equal(rows[1].withinLimit, false);
  });
});
