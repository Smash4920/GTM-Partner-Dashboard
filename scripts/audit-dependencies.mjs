import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Dependency audit gate with reviewed exceptions.
 *
 * Wraps `npm audit --audit-level=high --json`: every high or critical
 * advisory fails the job except the reviewed exceptions in
 * config/audit-exceptions.json, each of which carries an accepted-exposure
 * rationale and the tracking issue with its removal condition. An exception
 * that no longer matches a reported advisory fails as stale, so the list
 * only shrinks and an upstream fix cannot leave a permanent waiver behind.
 * See docs/security.md ("Dependency audit") for the governance record.
 */

const EXCEPTIONS_URL = new URL('../config/audit-exceptions.json', import.meta.url);
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const ADVISORY_ID_PATTERN = /GHSA-[0-9a-z-]+/i;
const ISSUE_URL_PATTERN = /^https:\/\/github\.com\/Smash4920\/GTM-Partner-Dashboard\/issues\/\d+$/;
const MIN_REASON_LENGTH = 80;

export function validateExceptions(config) {
  const violations = [];
  const seen = new Set();

  for (const [index, entry] of (config.exceptions ?? []).entries()) {
    const label = typeof entry?.id === 'string' ? entry.id : `entry ${index + 1}`;
    const id = typeof entry?.id === 'string' ? entry.id.toLowerCase() : undefined;

    if (!id || !ADVISORY_ID_PATTERN.test(label)) {
      violations.push(`${label}: id must be a GitHub advisory id (GHSA-...)`);
    } else if (seen.has(id)) {
      violations.push(`${label}: duplicate exception`);
    }
    if (id) {
      seen.add(id);
    }

    if (typeof entry?.package !== 'string' || entry.package.length === 0) {
      violations.push(`${label}: package must name the package the advisory affects`);
    }
    if (typeof entry?.reason !== 'string' || entry.reason.length < MIN_REASON_LENGTH) {
      violations.push(
        `${label}: reason must explain the accepted exposure (at least ${MIN_REASON_LENGTH} characters)`,
      );
    }
    if (typeof entry?.issue !== 'string' || !ISSUE_URL_PATTERN.test(entry.issue)) {
      violations.push(
        `${label}: issue must link the repository issue tracking the removal condition`,
      );
    }
  }

  return violations;
}

/**
 * Flattens an `npm audit --json` report to one record per blocking advisory.
 * Rollup vulnerabilities name a dependent package as a string `via`; the
 * object form is the actual advisory record and the only one evaluated.
 */
export function collectBlockingAdvisories(report) {
  const advisories = new Map();

  for (const vulnerability of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of vulnerability?.via ?? []) {
      if (typeof via !== 'object' || via === null) {
        continue;
      }
      const severity = via.severity ?? vulnerability.severity;
      if (!BLOCKING_SEVERITIES.has(severity)) {
        continue;
      }
      const id = via.url?.match(ADVISORY_ID_PATTERN)?.[0]?.toLowerCase();
      if (!id || advisories.has(id)) {
        continue;
      }
      advisories.set(id, {
        id,
        name: via.name ?? vulnerability.name,
        severity,
        title: via.title ?? '',
        url: via.url,
      });
    }
  }

  return [...advisories.values()];
}

export function evaluateAudit(report, exceptions) {
  const violations = [];
  const accepted = [];
  const advisories = collectBlockingAdvisories(report);
  const exceptionsById = new Map(exceptions.map((entry) => [entry.id.toLowerCase(), entry]));

  for (const advisory of advisories) {
    const exception = exceptionsById.get(advisory.id);
    if (!exception) {
      violations.push(
        `unreviewed ${advisory.severity} advisory ${advisory.id} (${advisory.name}): ` +
          `${advisory.title} -- ${advisory.url}`,
      );
    } else if (exception.package !== advisory.name) {
      violations.push(
        `${advisory.id}: exception names package '${exception.package}' ` +
          `but the advisory is for '${advisory.name}'`,
      );
    } else {
      accepted.push({ advisory, exception });
    }
  }

  const reportedIds = new Set(advisories.map((advisory) => advisory.id));
  for (const exception of exceptions) {
    if (!reportedIds.has(exception.id.toLowerCase())) {
      violations.push(
        `stale exception ${exception.id} (${exception.package}): npm audit no longer ` +
          'reports it; remove the entry from config/audit-exceptions.json',
      );
    }
  }

  return { accepted, violations };
}

function readAuditReport() {
  try {
    const stdout = execFileSync('npm', ['audit', '--json', '--audit-level=high'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    // npm audit exits nonzero when it finds advisories; the report is still
    // on stdout. Anything else (registry outage, lockfile mismatch) is a
    // real failure and must not be read as a clean report.
    if (typeof error.stdout === 'string' && error.stdout.trimStart().startsWith('{')) {
      return JSON.parse(error.stdout);
    }
    throw new Error(`npm audit did not produce a report: ${error.message}`);
  }
}

function run() {
  const config = JSON.parse(readFileSync(EXCEPTIONS_URL, 'utf8'));
  const { accepted, violations } = evaluateAudit(readAuditReport(), config.exceptions ?? []);
  const allViolations = [...validateExceptions(config), ...violations];

  for (const { advisory, exception } of accepted) {
    console.log(
      `accepted ${advisory.severity} ${advisory.id} (${advisory.name}) -- ${exception.issue}`,
    );
  }

  if (allViolations.length === 0) {
    console.log('Dependency audit passed: no unreviewed high or critical advisories.');
    return;
  }

  console.error('Dependency audit failed:');
  for (const violation of allViolations) {
    console.error(`  ${violation}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
