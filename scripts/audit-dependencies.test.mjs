import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  collectBlockingAdvisories,
  evaluateAudit,
  validateExceptions,
} from './audit-dependencies.mjs';

const ADVISORY_URL = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';

function advisoryVia(overrides = {}) {
  return {
    source: 1,
    name: 'braces',
    dependency: 'braces',
    title: 'braces vulnerable to stack-exhaustion denial of service',
    url: ADVISORY_URL,
    severity: 'high',
    range: '*',
    ...overrides,
  };
}

function reportWith(vulnerabilities) {
  return { auditReportVersion: 2, vulnerabilities };
}

function bracesReport(viaOverrides = {}) {
  return reportWith({
    braces: {
      name: 'braces',
      severity: 'high',
      isDirect: false,
      via: [advisoryVia(viaOverrides)],
      effects: ['chokidar', 'micromatch'],
    },
    // Rollup entries reference the advisory by package name as a string;
    // they must never be counted as separate advisories.
    chokidar: { name: 'chokidar', severity: 'high', via: ['braces'] },
    micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
  });
}

function exception(overrides = {}) {
  return {
    id: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    reason:
      'Accepted risk: dev-only build and lint tooling parses only repository-controlled ' +
      'glob patterns and never ships in the client bundle; remove when upstream patches.',
    issue: 'https://github.com/Smash4920/GTM-Partner-Dashboard/issues/55',
    ...overrides,
  };
}

test('accepts a reviewed advisory and reports it as accepted', () => {
  const { accepted, violations } = evaluateAudit(bracesReport(), [exception()]);

  assert.deepEqual(violations, []);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].advisory.id, 'ghsa-vfj7-8cjw-p6xm');
});

test('blocks an unlisted high advisory', () => {
  const { violations } = evaluateAudit(bracesReport(), []);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /unreviewed high advisory ghsa-vfj7-8cjw-p6xm \(braces\)/);
});

test('blocks critical advisories', () => {
  const { violations } = evaluateAudit(bracesReport({ severity: 'critical' }), []);

  assert.match(violations[0], /unreviewed critical advisory/);
});

test('ignores advisories below the blocking severity', () => {
  const report = bracesReport({ severity: 'moderate' });
  const { accepted, violations } = evaluateAudit(report, []);

  assert.deepEqual(accepted, []);
  assert.deepEqual(violations, []);
});

test('collects one record per advisory, not per dependent package', () => {
  const advisories = collectBlockingAdvisories(bracesReport());

  assert.equal(advisories.length, 1);
  assert.equal(advisories[0].name, 'braces');
});

test('rejects an exception naming the wrong package', () => {
  const { violations } = evaluateAudit(bracesReport(), [exception({ package: 'micromatch' })]);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /exception names package 'micromatch'/);
});

test('fails a stale exception so a fixed advisory cannot leave a waiver behind', () => {
  const { violations } = evaluateAudit(reportWith({}), [exception()]);

  assert.equal(violations.length, 1);
  assert.match(violations[0], /stale exception GHSA-vfj7-8cjw-p6xm \(braces\)/);
});

test('validates exception entries', () => {
  assert.deepEqual(validateExceptions({ exceptions: [exception()] }), []);

  const violations = validateExceptions({
    exceptions: [
      exception({ id: 'CVE-2026-93687' }),
      exception({ id: 'GHSA-aaaa-bbbb-cccc', reason: 'too short' }),
      exception({ id: 'GHSA-dddd-eeee-ffff', issue: 'https://example.com/issues/55' }),
      exception({ id: 'GHSA-gggg-hhhh-iiii', package: '' }),
    ],
  });

  assert.equal(violations.length, 4);
  assert.ok(violations.some((line) => /GitHub advisory id/.test(line)));
  assert.ok(violations.some((line) => /accepted exposure/.test(line)));
  assert.ok(violations.some((line) => /tracking the removal condition/.test(line)));
  assert.ok(violations.some((line) => /name the package/.test(line)));
});

test('rejects duplicate exception ids', () => {
  const violations = validateExceptions({ exceptions: [exception(), exception()] });

  assert.deepEqual(violations, ['GHSA-vfj7-8cjw-p6xm: duplicate exception']);
});
