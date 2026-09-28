import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';

import {
  collectOutputMetrics,
  createBuildReport,
  formatSummary,
  measureStage,
} from './build-with-metrics.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('build performance metrics', () => {
  it('measures a build stage and records a successful result', () => {
    const times = [100, 475];
    const result = measureStage(
      { name: 'TypeScript', command: 'tsc', args: ['-b'] },
      () => ({ status: 0 }),
      () => times.shift(),
    );

    assert.deepEqual(result, {
      name: 'TypeScript',
      durationMs: 375,
      exitCode: 0,
      status: 'passed',
      error: undefined,
    });
  });

  it('records nested build output size and file count', () => {
    const outputDirectory = mkdtempSync(join(tmpdir(), 'build-metrics-'));
    temporaryDirectories.push(outputDirectory);
    mkdirSync(join(outputDirectory, 'assets'));
    writeFileSync(join(outputDirectory, 'index.html'), '12345');
    writeFileSync(join(outputDirectory, 'assets', 'app.js'), '1234567');

    assert.deepEqual(collectOutputMetrics(outputDirectory), {
      fileCount: 2,
      totalBytes: 12,
    });
  });

  it('fails the report when a successful build exceeds its duration budget', () => {
    const report = createBuildReport({
      stages: [
        {
          name: 'TypeScript',
          durationMs: 4_000,
          exitCode: 0,
          status: 'passed',
        },
        { name: 'Vite', durationMs: 6_001, exitCode: 0, status: 'passed' },
      ],
      budgetMs: 10_000,
      output: { fileCount: 4, totalBytes: 1024 },
      commitSha: 'abc123',
      generatedAt: '2026-09-28T00:00:00.000Z',
      typescriptCacheHit: true,
    });

    assert.equal(report.status, 'budget-exceeded');
    assert.equal(report.totalDurationMs, 10_001);
    assert.match(formatSummary(report), /10\.001 s \/ 10\.000 s budget/);
    assert.match(formatSummary(report), /TypeScript cache:\*\* Hit/);
  });

  it('gives a failed stage precedence over the duration budget', () => {
    const report = createBuildReport({
      stages: [{ name: 'TypeScript', durationMs: 100, exitCode: 2, status: 'failed' }],
      budgetMs: 1,
      output: null,
      commitSha: '',
      generatedAt: '2026-09-28T00:00:00.000Z',
      typescriptCacheHit: null,
    });

    assert.equal(report.status, 'failed');
    assert.equal(report.commitSha, null);
  });
});
