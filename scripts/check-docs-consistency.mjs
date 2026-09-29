import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Documentation consistency policy (VAL-GOV-008 through VAL-GOV-011 and the
 * documentation half of VAL-QUAL-004), checked statically so the written
 * claims cannot drift away from the verified client-only product:
 *
 *   - required claims pin the facts every reader must find: the client-only
 *     boundary, the Demo versus Production status axes, the partner picker
 *     limitation (an untrusted demo presentation selector; client filtering
 *     is not authorization; external use needs trusted sign-in and
 *     server-enforced row access), the deferred Forecast Quality trend
 *     prerequisites, session-only simulated roster/notification behavior,
 *     local non-authoritative flag lifecycle and fallback, telemetry
 *     defaults, and the ordered production continuation;
 *   - prohibited claims reject the known overstatements: roster
 *     "authorization" language, "24 hours" SLA phrasing (the SLA is five
 *     business days with a one-business-day warning), webhook delivery
 *     endpoints, credential-shaped environment variables, and any assertion
 *     that authentication, server enforcement, durable delivery, a remote
 *     flag plane, or Forecast Quality history exists today;
 *   - `.env.example` must document every `VITE_*` variable the source reads
 *     and must not request secret-shaped values.
 *
 * Fixtures name exact phrases so a paraphrase that drops a fact fails the
 * check; keep the patterns synchronized with the documents in the same
 * change, like the generated docs.
 */

/** The prose documents a reader can act on. Generated pages are excluded. */
export const DOCUMENTED_FILES = [
  'README.md',
  '.env.example',
  'docs/migration-plan.md',
  'docs/security.md',
  'docs/runbooks/README.md',
  'docs/runbooks/deployment.md',
  'docs/runbooks/rollback.md',
  'docs/runbooks/incident-response.md',
  'docs/runbooks/ci-failure.md',
];

const README = 'README.md';
const MIGRATION = 'docs/migration-plan.md';
const SECURITY = 'docs/security.md';
const ENV_EXAMPLE = '.env.example';
const RUNBOOKS = [
  'docs/runbooks/README.md',
  'docs/runbooks/deployment.md',
  'docs/runbooks/rollback.md',
  'docs/runbooks/incident-response.md',
  'docs/runbooks/ci-failure.md',
];
const PRODUCT_DOCS = [README, MIGRATION, SECURITY];

export const REQUIRED_CLAIMS = [
  {
    id: 'client-only-boundary',
    files: [...PRODUCT_DOCS, 'docs/runbooks/README.md'],
    pattern: /client-only/,
    description: 'states the client-only boundary',
  },
  {
    id: 'demo-status-axis',
    files: PRODUCT_DOCS,
    pattern: /Demo status/,
    description: 'explains the Demo status axis (Complete, WIP, Pending)',
  },
  {
    id: 'prod-only-axis',
    files: PRODUCT_DOCS,
    pattern: /Prod Only/,
    description: 'explains the Production: Prod Only status for paused dependencies',
  },
  {
    id: 'picker-untrusted-selector',
    files: PRODUCT_DOCS,
    pattern: /untrusted\s+demo\s+presentation\s+selector/,
    description: 'identifies the Partner View picker as an untrusted demo presentation selector',
  },
  {
    id: 'picker-not-authorization',
    files: PRODUCT_DOCS,
    pattern: /filtering\s+is\s+not\s+authorization/,
    description: 'states client filtering is not authorization',
  },
  {
    id: 'picker-production-prerequisites',
    files: PRODUCT_DOCS,
    pattern: /trusted\s+sign-in\s+and\s+server-enforced\s+row\s+access/,
    description: 'requires trusted sign-in and server-enforced row access for external use',
  },
  {
    id: 'trend-ownership-prerequisite',
    files: PRODUCT_DOCS,
    pattern: /immutable\s+historical/,
    description: 'names immutable historical ownership as a Forecast Quality trend prerequisite',
  },
  {
    id: 'trend-stage-event-prerequisite',
    files: PRODUCT_DOCS,
    pattern: /authoritative\s+stage-entry\s+events/,
    description: 'names authoritative stage-entry events as a Forecast Quality trend prerequisite',
  },
  {
    id: 'session-only-simulation',
    files: [README, SECURITY],
    pattern: /session-only/,
    description: 'labels roster, notification, and edit behavior session-only',
  },
  {
    id: 'simulated-delivery',
    files: [README, SECURITY],
    pattern: /simulated\s*\/\s*local\s+only|simulated,\s+local-only/i,
    description: 'labels notification delivery simulated / local only',
  },
  {
    id: 'flags-non-authoritative',
    files: [README, SECURITY],
    pattern: /non-authoritative/,
    description: 'states feature flags are local and non-authoritative',
  },
  {
    id: 'flags-safe-default',
    files: [README, SECURITY],
    pattern: /safe default/,
    description: 'documents the flag fail-safe fallback to the registry safe default',
  },
  {
    id: 'ordered-production-continuation',
    files: PRODUCT_DOCS,
    pattern: /production\s+continuation/i,
    description:
      'states the ordered production continuation (identity, warehouse/API, ingestion, writes, operations)',
  },
  {
    id: 'telemetry-default-off',
    files: [README, SECURITY],
    pattern: /off by default/,
    description: 'documents telemetry/analytics defaults and the local-only fallback',
  },
  {
    id: 'telemetry-master-switch',
    files: [README, ENV_EXAMPLE],
    pattern: /VITE_FLAG_TELEMETRY_ENABLED/,
    description: 'documents the telemetry master switch variable',
  },
  {
    id: 'runbook-session-reset',
    files: ['docs/runbooks/README.md'],
    pattern: /session only/,
    description: 'tells operators session state is lost on reload by design',
  },
];

export const PROHIBITED_CLAIMS = [
  {
    id: 'roster-authorization-language',
    files: [README],
    pattern:
      /awaiting\s+authorization|authorizing\s+is\s+a|Access\s+can\s+be\s+revoked\s+and\s+restored|authorized\s+Partner\s+Manager\s+user/i,
    reason:
      'roster actions are a session-only notification-routing simulation; they never authorize sign-in or access',
  },
  {
    id: 'sla-calendar-hours',
    files: [README],
    pattern: /\b24[ -]?hours?\b|\b24h\b/i,
    reason:
      'the registration SLA is five business days with a one-business-day warning; quoting hours contradicts the business-day unit',
  },
  {
    id: 'any-http-collector',
    files: [README],
    pattern: /any\s+HTTP\s+metrics\s+collector/i,
    reason:
      'telemetry endpoints must be HTTPS on an approved host and fail closed otherwise; "any HTTP collector" overstates the supported configuration',
  },
  {
    id: 'webhook-endpoint',
    files: [ENV_EXAMPLE, ...RUNBOOKS],
    pattern: /VITE_ALERT_ENDPOINT|hooks\.slack\.com|discord(?:app)?\.com\/api\/webhooks/i,
    reason:
      'browser webhook delivery was removed; configuration and runbooks must not reference it',
  },
  {
    id: 'secret-env-assignment',
    files: [ENV_EXAMPLE],
    pattern: /^[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|CREDENTIAL|API_?KEY|PRIVATE_?KEY)[A-Z0-9_]*\s*=/m,
    reason: 'client environment variables are public by design and must never request secrets',
  },
  {
    id: 'authentication-claim',
    files: PRODUCT_DOCS,
    pattern: /authentication\s+(?:is|has\s+been)\s+(?:built|implemented|enabled|enforced)/i,
    reason: 'the demo has no authentication layer; claiming one overstates the product',
  },
  {
    id: 'server-enforcement-claim',
    files: PRODUCT_DOCS,
    pattern:
      /row-level\s+authorization\s+is\s+(?:enforced|live|implemented)|server-side\s+row\s+(?:filtering|authorization)\s+is\s+(?:in\s+place|active)/i,
    reason: 'row-level authorization is a Prod Only dependency, not a shipped capability',
  },
  {
    id: 'delivery-claim',
    files: PRODUCT_DOCS,
    pattern: /notifications\s+are\s+delivered|alerts\s+are\s+delivered/i,
    reason: 'notifications are simulated/local-only session records; nothing is delivered',
  },
  {
    id: 'durable-edit-claim',
    files: PRODUCT_DOCS,
    pattern: /edits\s+are\s+persisted|persisted\s+across\s+reloads/i,
    reason: 'in-app edits are session-only React state and are lost on reload',
  },
  {
    id: 'remote-flag-claim',
    files: PRODUCT_DOCS,
    pattern: /flag\s+(?:service|control\s+plane)\s+is\s+(?:live|available|connected|built)/i,
    reason: 'there is no remote flag service; the authenticated control plane is Prod Only',
  },
  {
    id: 'trend-complete-claim',
    files: PRODUCT_DOCS,
    pattern:
      /forecast[-\s]quality\s+(?:history|trend)[^\n]{0,80}\b(?:complete|landed|shipped|available)\b/i,
    reason:
      'the per-manager/per-partner Forecast Quality trend stays Pending until immutable historical ownership and authoritative stage-entry events exist',
  },
  {
    id: 'production-ready-claim',
    files: PRODUCT_DOCS,
    pattern: /production-ready/i,
    reason: 'the demo is production-shaped, not production-ready; the Prod Only rows say why',
  },
];

/**
 * Pure check so the policy is unit-testable without a filesystem.
 *
 *   - `files`: `{ path, text }` for every entry of DOCUMENTED_FILES;
 *   - `sourceEnvKeys`: every `VITE_*` name referenced by production source.
 *
 * Returns `{ path, id, detail }` violations.
 */
export function checkDocsConsistency({ files, sourceEnvKeys }) {
  const violations = [];
  const byPath = new Map(files.map((file) => [file.path, file.text]));

  for (const documented of DOCUMENTED_FILES) {
    if (!byPath.has(documented)) {
      violations.push({ path: documented, id: 'missing-document', detail: 'file is missing' });
    }
  }

  for (const { id, files: paths, pattern, description } of REQUIRED_CLAIMS) {
    for (const path of paths) {
      const text = byPath.get(path);
      if (text !== undefined && !pattern.test(text)) {
        violations.push({ path, id, detail: `must ${description} (missing ${pattern})` });
      }
    }
  }

  for (const { id, files: paths, pattern, reason } of PROHIBITED_CLAIMS) {
    for (const path of paths) {
      const text = byPath.get(path);
      if (text !== undefined && pattern.test(text)) {
        violations.push({ path, id, detail: reason });
      }
    }
  }

  const envTemplate = byPath.get(ENV_EXAMPLE) ?? '';
  for (const key of sourceEnvKeys) {
    if (!envTemplate.includes(key)) {
      violations.push({
        path: ENV_EXAMPLE,
        id: 'undocumented-env',
        detail: `${key} is read by the source but not documented in .env.example`,
      });
    }
  }

  return violations;
}

function collectSourceEnvKeys(repositoryRoot) {
  const keys = new Set();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (/\.[jt]sx?$/.test(entry.name) && !/\.test\.[jt]sx?$/.test(entry.name)) {
        const text = readFileSync(entryPath, 'utf8');
        for (const match of text.matchAll(/VITE_[A-Z0-9_]+/g)) {
          keys.add(match[0]);
        }
      }
    }
  };
  visit(resolve(repositoryRoot, 'src'));
  return [...keys].sort();
}

function run() {
  const repositoryRoot = process.cwd();
  const files = DOCUMENTED_FILES.filter((path) => existsSync(resolve(repositoryRoot, path))).map(
    (path) => ({ path, text: readFileSync(resolve(repositoryRoot, path), 'utf8') }),
  );

  // Relative-path stability for unit tests that run this collector's shape.
  const sourceEnvKeys = collectSourceEnvKeys(repositoryRoot);
  const violations = checkDocsConsistency({ files, sourceEnvKeys });

  if (violations.length === 0) {
    console.log(
      `Documentation consistency check passed: ${files.length} documents agree with the client-only product and cover ${sourceEnvKeys.length} environment variables.`,
    );
    return;
  }

  console.error('Documentation consistency check failed:');
  for (const violation of violations) {
    console.error(`- ${violation.path}: ${violation.detail} [${violation.id}]`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
