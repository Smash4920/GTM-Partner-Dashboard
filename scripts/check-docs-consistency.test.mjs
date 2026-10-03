import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DOCUMENTED_FILES,
  PROHIBITED_CLAIMS,
  REQUIRED_CLAIMS,
  checkDocsConsistency,
} from './check-docs-consistency.mjs';

/**
 * A minimal document set that satisfies every required claim, so each test
 * can break exactly one fact and watch exactly one violation come back.
 */
// Keep every pinned phrase on one line: the checker matches within the raw
// text, and Prettier wraps prose at 80 columns in the real documents.
const CLAIMS_PARAGRAPH = [
  'This client-only demo stamps every roadmap row with a Demo status and,',
  'where a dependency is paused, a Production: Prod Only status.',
  'The Partner View picker is an untrusted demo presentation selector and',
  'client-side filtering is not authorization; external use requires',
  'trusted sign-in and server-enforced row access.',
  'The forecast trend waits on immutable historical ownership and',
  'authoritative stage-entry events.',
  'Roster and notification behavior is session-only and simulated / local only.',
  'Flags are local and non-authoritative with a safe default fallback.',
  'The production continuation runs in a fixed order.',
  'Analytics is off by default, and VITE_FLAG_TELEMETRY_ENABLED is the master switch.',
  'Action Center includes Stale high-value deal, Missing next step, Slipping close date,',
  'Registration SLA, and Partner-health deterioration.',
  'Workflow actors are not authenticated; refresh loses every session record.',
  'Browser tests use production preview with BASE_PATH=/ and no HMR.',
  'Axe checks the route and modal-state inventories; this is not WCAG certification.',
].join('\n');

const RUNBOOK_PARAGRAPH = 'The app is client-only. State lives for the session only.';

function completeFiles() {
  return DOCUMENTED_FILES.map((path) => ({
    path,
    text: path.startsWith('docs/runbooks/')
      ? `${CLAIMS_PARAGRAPH}\n${RUNBOOK_PARAGRAPH}`
      : CLAIMS_PARAGRAPH,
  }));
}

function scan({ files = completeFiles(), sourceEnvKeys = [] } = {}) {
  return checkDocsConsistency({ files, sourceEnvKeys });
}

describe('checkDocsConsistency required claims', () => {
  it('passes a document set that states every required fact', () => {
    assert.deepEqual(scan(), []);
  });

  it('fails when a documented file is missing entirely', () => {
    const violations = scan({
      files: completeFiles().filter((file) => file.path !== 'docs/security.md'),
    });
    assert.ok(
      violations.some(
        (violation) => violation.path === 'docs/security.md' && violation.id === 'missing-document',
      ),
    );
  });

  it('fails when the picker limitation drops out of a product document', () => {
    const files = completeFiles().map((file) =>
      file.path === 'README.md'
        ? { ...file, text: file.text.replace('untrusted demo presentation selector', 'selector') }
        : file,
    );
    const violations = scan({ files });
    assert.deepEqual(
      violations.map((violation) => violation.id),
      ['picker-untrusted-selector'],
    );
    assert.equal(violations[0].path, 'README.md');
  });

  it('requires the fact in every product document, not just one', () => {
    const files = completeFiles().map((file) =>
      file.path.startsWith('docs/') && !file.path.startsWith('docs/runbooks/')
        ? { ...file, text: file.text.replace('filtering is not authorization', 'filtering') }
        : file,
    );
    const violations = scan({ files });
    assert.deepEqual(
      violations.map((violation) => `${violation.path}#${violation.id}`),
      [
        'docs/migration-plan.md#picker-not-authorization',
        'docs/security.md#picker-not-authorization',
      ],
    );
  });

  it('fails when the deferred-trend prerequisites are dropped', () => {
    const files = completeFiles().map((file) =>
      file.path === 'docs/migration-plan.md'
        ? { ...file, text: file.text.replace('authoritative stage-entry events', 'stage events') }
        : file,
    );
    const violations = scan({ files });
    assert.deepEqual(
      violations.map((violation) => violation.id),
      ['trend-stage-event-prerequisite'],
    );
  });

  it('requires every named Action Center category and final browser-testing fact', () => {
    const cases = [
      ['Stale high-value deal', 'action-stale-category'],
      ['Missing next step', 'action-next-step-category'],
      ['Slipping close date', 'action-slip-category'],
      ['Registration SLA', 'action-registration-category'],
      ['Partner-health deterioration', 'action-health-category'],
      ['not authenticated', 'workflow-actor-boundary'],
      ['production preview', 'production-preview-testing'],
      ['BASE_PATH=/', 'browser-base-path'],
      ['no HMR', 'no-hmr-testing'],
      ['route and modal-state inventories', 'accessibility-inventories'],
    ];
    for (const [phrase, id] of cases) {
      const files = completeFiles().map((file) =>
        file.path === 'README.md' ? { ...file, text: file.text.replace(phrase, 'omitted') } : file,
      );
      assert.ok(
        scan({ files }).some((violation) => violation.id === id),
        id,
      );
    }
  });

  it('requires every VITE_* key the source reads to be documented', () => {
    const violations = scan({
      sourceEnvKeys: ['VITE_FLAG_TELEMETRY_ENABLED', 'VITE_NEW_UNDOCUMENTED'],
    });
    assert.deepEqual(violations, [
      {
        path: '.env.example',
        id: 'undocumented-env',
        detail: 'VITE_NEW_UNDOCUMENTED is read by the source but not documented in .env.example',
      },
    ]);
  });
});

describe('checkDocsConsistency prohibited claims', () => {
  const withClaim = (path, claim) =>
    completeFiles().map((file) =>
      file.path === path ? { ...file, text: `${file.text}\n${claim}` } : file,
    );

  it('rejects roster authorization language in the README', () => {
    for (const claim of [
      'Adding a person puts them on the roster awaiting authorization.',
      'Access can be revoked and restored.',
    ]) {
      const violations = scan({ files: withClaim('README.md', claim) });
      assert.ok(
        violations.some((violation) => violation.id === 'roster-authorization-language'),
        claim,
      );
    }
  });

  it('rejects calendar-hour SLA phrasing in the README', () => {
    for (const claim of ['one business day (24 hours) before the deadline', 'the 24h warning']) {
      const violations = scan({ files: withClaim('README.md', claim) });
      assert.ok(
        violations.some((violation) => violation.id === 'sla-calendar-hours'),
        claim,
      );
    }
  });

  it('rejects webhook configuration in the environment template and runbooks', () => {
    const violations = scan({
      files: withClaim('.env.example', 'VITE_ALERT_ENDPOINT=https://hooks.slack.com/x'),
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].id, 'webhook-endpoint');

    const runbookViolations = scan({
      files: withClaim('docs/runbooks/deployment.md', 'Set VITE_ALERT_ENDPOINT to page the team.'),
    });
    assert.equal(runbookViolations.length, 1);
    assert.equal(runbookViolations[0].id, 'webhook-endpoint');
  });

  it('rejects secret-shaped variables in the environment template', () => {
    const violations = scan({
      files: withClaim('.env.example', 'VITE_SALESFORCE_CLIENT_SECRET='),
    });
    assert.ok(violations.some((violation) => violation.id === 'secret-env-assignment'));
  });

  it('rejects production-capability overclaims in product documents', () => {
    const cases = [
      ['authentication is enforced', 'authentication-claim'],
      ['row-level authorization is enforced', 'server-enforcement-claim'],
      ['notifications are delivered to Slack', 'delivery-claim'],
      ['edits are persisted across reloads', 'durable-edit-claim'],
      ['the flag control plane is available', 'remote-flag-claim'],
      ['the forecast-quality trend is now complete', 'trend-complete-claim'],
      ['the dashboard is production-ready', 'production-ready-claim'],
      ['the dashboard is WCAG certified', 'accessibility-certification-claim'],
    ];
    for (const [claim, id] of cases) {
      const violations = scan({ files: withClaim('docs/security.md', claim) });
      assert.ok(
        violations.some((violation) => violation.id === id),
        `${claim} should trip ${id}`,
      );
    }
  });

  it('rejects runbook advice to widen performance or bundle budgets', () => {
    for (const phrase of [
      'raise the budget with a written reason',
      'raise the limit with a reason',
    ]) {
      const violations = scan({
        files: withClaim('docs/runbooks/ci-failure.md', phrase),
      });
      assert.ok(violations.some((violation) => violation.id === 'ratchet-weakening-advice'));
    }
  });

  it('scopes README-only prohibitions so other documents keep the vocabulary', () => {
    // Runbooks legitimately discuss authorization as a future, Prod Only
    // concern; only the README's stale roster phrasing is prohibited.
    const violations = scan({
      files: withClaim('docs/runbooks/incident-response.md', "exposes another partner's data"),
    });
    assert.deepEqual(violations, []);
  });
});

describe('documentation fixtures', () => {
  it('keeps required and prohibited ids unique', () => {
    const ids = [
      ...REQUIRED_CLAIMS.map((claim) => claim.id),
      ...PROHIBITED_CLAIMS.map((claim) => claim.id),
    ];
    assert.equal(new Set(ids).size, ids.length);
  });

  it('references only documented files', () => {
    for (const claim of [...REQUIRED_CLAIMS, ...PROHIBITED_CLAIMS]) {
      for (const path of claim.files) {
        assert.ok(
          DOCUMENTED_FILES.includes(path),
          `${claim.id} references undocumented file ${path}`,
        );
      }
    }
  });
});
