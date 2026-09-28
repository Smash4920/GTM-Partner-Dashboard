import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateBudgets, globToRegExp } from './check-bundle-budgets.mjs';

describe('bundle budget globs', () => {
  it('matches a basename wildcard without crossing directories', () => {
    const matcher = globToRegExp('dist/assets/index-*.js');

    assert.equal(matcher.test('dist/assets/index-a1b2c3.js'), true);
    assert.equal(matcher.test('dist/assets/recharts-a1b2c3.js'), false);
    assert.equal(matcher.test('dist/assets/nested/index-a1b2c3.js'), false);
  });

  it('treats a dot as a literal character', () => {
    assert.equal(globToRegExp('dist/assets/*.js').test('dist/assets/appXjs'), false);
  });
});

describe('bundle budget evaluation', () => {
  const candidates = [
    { path: 'dist/assets/index-abc.js', bytes: 60_000 },
    { path: 'dist/assets/recharts-abc.js', bytes: 140_000 },
    { path: 'dist/assets/charts-vendor-abc.js', bytes: 20_000 },
  ];

  it('sums every match for a total budget', () => {
    const [result] = evaluateBudgets(
      [
        {
          name: 'Total JavaScript',
          pattern: 'dist/assets/*.js',
          aggregate: 'sum',
          limitBytes: 300_000,
        },
      ],
      candidates,
    );

    assert.equal(result.measuredBytes, 220_000);
    assert.equal(result.withinLimit, true);
  });

  it('checks each match independently for a per-file budget', () => {
    const [result] = evaluateBudgets(
      [
        {
          name: 'Recharts chunk',
          pattern: 'dist/assets/recharts-*.js',
          aggregate: 'each',
          limitBytes: 150_000,
        },
      ],
      candidates,
    );

    assert.equal(result.measuredBytes, 140_000);
    assert.equal(result.withinLimit, true);
  });

  it('fails a budget whose pattern matches nothing', () => {
    const [result] = evaluateBudgets(
      [{ name: 'Missing', pattern: 'dist/assets/gone-*.js', aggregate: 'each', limitBytes: 1 }],
      candidates,
    );

    assert.equal(result.matchedFiles.length, 0);
    assert.equal(result.withinLimit, false);
  });

  it('fails a per-file budget when one chunk grows past the limit', () => {
    const [result] = evaluateBudgets(
      [
        {
          name: 'Application chunk',
          pattern: 'dist/assets/index-*.js',
          aggregate: 'each',
          limitBytes: 50_000,
        },
      ],
      candidates,
    );

    assert.equal(result.withinLimit, false);
  });
});
