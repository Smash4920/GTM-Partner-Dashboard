import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Client-only runtime boundary policy (VAL-GOV-012), checked statically so a
 * regression fails locally and in CI instead of shipping:
 *
 *   - dependencies: no server framework, database or driver, ORM,
 *     authentication/identity library, warehouse or cloud data SDK, live
 *     source connector or generic HTTP client, notification sender, durable
 *     browser store, or realtime channel may enter the dependency graph;
 *   - source egress: `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`,
 *     and `EventSource` may appear only in the reviewed telemetry egress
 *     modules, so no live integration can start calling out unnoticed;
 *   - durable storage: `localStorage` and friends may appear only in the
 *     reviewed module that keeps the anonymous flag-rollout cohort, because
 *     session-only product state must never persist;
 *   - server/runtime APIs: production source never touches `node:*` modules,
 *     `process.env`, or a listening server;
 *   - file layout: no `server.*` entrypoint, `api/` directory, or functions
 *     directory may appear at the repository root or under `src/`;
 *   - workflows: no GitHub Actions job may declare a `services:` container
 *     (a database or broker beside the job would be a server dependency);
 *   - static shell: `index.html` and `public/` load no external asset, so
 *     the app boots without touching a third-party origin.
 *
 * The built-artifact half of the boundary (no webhook symbols, no loopback
 * collector literals, no public source maps in `dist/`) is scanned by
 * `npm run telemetry:check`, which `bundle:check` runs after every build.
 * The runtime half — a default production preview making no live integration
 * or telemetry request — is exercised by `tests/e2e/governance.spec.ts`.
 *
 * Allowlists below are reviewed inventories, like the workflow checker's:
 * they are bidirectional, so a stale entry fails the same way a violation
 * does, and an entry can only change with reviewer sign-off in the diff.
 */

/**
 * Dependency names that would put a server, datastore, identity system,
 * warehouse, live connector, sender, durable store, or realtime channel into
 * the client product. Matched against exact package names in package.json
 * (both dependency blocks); transitive packages are npm's concern, not the
 * application's runtime boundary.
 */
export const PROHIBITED_DEPENDENCIES = [
  {
    id: 'server-framework',
    pattern: /^(express|fastify|koa|hono|h3|polka|restify|next|nuxt|remix|@nestjs\/.+|@hapi\/.+)$/,
    reason: 'a server framework would add the backend this mission excludes',
  },
  {
    id: 'database-client',
    pattern:
      /^(pg|postgres|mysql2?|mariadb|mongodb|mongoose|redis|ioredis|better-sqlite3|sqlite3|sql\.js|prisma|@prisma\/.+|typeorm|drizzle-orm|knex|sequelize|kysely|@libsql\/.+|couchdb|pouchdb|level|realm)$/,
    reason: 'a database client or ORM would add the durable store this mission excludes',
  },
  {
    id: 'authentication',
    pattern:
      /^(jsonwebtoken|jose|passport|passport-.+|@auth\/.+|next-auth|lucia|@clerk\/.+|@supabase\/.+|firebase|firebase-admin|openid-client|oauth4webapi|@okta\/.+|@azure\/msal-.+|oidc-client.+)$/,
    reason:
      'an authentication or identity library would fake the trusted sign-in this mission excludes',
  },
  {
    id: 'warehouse-or-cloud-data',
    pattern:
      /^(snowflake-sdk|@google-cloud\/.+|@aws-sdk\/.+|@azure\/(identity|storage|data|cosmos).*|@clickhouse\/.+|@databricks\/.+|@confluentinc\/.+|kafkajs)$/,
    reason:
      'a warehouse or cloud data SDK would add the production data plane this mission excludes',
  },
  {
    id: 'live-connector',
    pattern:
      /^(axios|node-fetch|got|undici|request|superagent|ky|jsforce|@hubspot\/.+|@salesforce\/.+|@googleapis\/.+|@notionhq\/.+|graphql-request|@apollo\/.+|urql)$/,
    reason:
      'an HTTP client or source connector would enable the live integrations this mission excludes',
  },
  {
    id: 'notification-sender',
    pattern:
      /^(@slack\/.+|nodemailer|twilio|@sendgrid\/.+|resend|postmark|@aws\/client-ses.*|mailgun.*)$/,
    reason: 'a notification sender would fake the delivery this mission keeps simulated/local-only',
  },
  {
    id: 'durable-store',
    pattern: /^(localforage|dexie|idb|idb-keyval|redux-persist|zustand)$/,
    reason: 'a durable browser store would persist state the mission keeps session-only',
  },
  {
    id: 'realtime-channel',
    pattern: /^(ws|socket\.io|socket\.io-client|pusher(-js)?|ably|@microsoft\/signalr)$/,
    reason: 'a realtime channel would add a live connection this mission excludes',
  },
];

/**
 * Network egress primitives restricted to the reviewed telemetry boundary.
 * `files` maps a repository-relative source path to the pattern ids that
 * module is reviewed to use; any other file using any id is a violation, and
 * an entry whose file no longer uses the id is stale and fails as well.
 */
export const EGRESS_PATTERNS = [
  { id: 'fetch', pattern: /\bfetch\s*\(/ },
  { id: 'xhr', pattern: /\bXMLHttpRequest\b/ },
  { id: 'beacon', pattern: /\bsendBeacon\b/ },
  { id: 'websocket', pattern: /\bWebSocket\b/ },
  { id: 'eventsource', pattern: /\bEventSource\b/ },
];

export const ALLOWED_EGRESS = {
  // The single outbound boundary: every envelope leaves through this module.
  'src/lib/telemetry/transport.ts': ['fetch'],
  // Web Vitals delivery: sendBeacon with a keepalive fetch fallback, behind
  // the same endpoint policy and master switch as the transport.
  'src/lib/performanceTelemetry.ts': ['fetch', 'beacon'],
};

/**
 * Durable browser storage primitives. Session-only state (edits, roster,
 * notifications, decisions, policy) must never persist; the single reviewed
 * exception is the anonymous feature-flag rollout cohort key.
 */
export const STORAGE_PATTERNS = [
  { id: 'web-storage', pattern: /\blocalStorage\b|\bsessionStorage\b/ },
  { id: 'indexeddb', pattern: /\bindexedDB\b/ },
  { id: 'cookie', pattern: /\bdocument\.cookie\b/ },
  { id: 'cache-storage', pattern: /\bcaches\.open\b/ },
];

export const ALLOWED_STORAGE = {
  // Anonymous rollout cohort (`gtm.feature-flags.subject.v1`): no user or
  // partner data, documented in README.md "Feature flags".
  'src/lib/featureFlags.ts': ['web-storage'],
};

/** Server-only or Node-only APIs that production browser source must not touch. */
export const RUNTIME_PATTERNS = [
  {
    id: 'node-builtin',
    pattern:
      /(?:from\s+|require\()\s*['"]node:(?:fs|http|https|net|tls|child_process|worker_threads)['"]/,
  },
  { id: 'process-env', pattern: /\bprocess\.env\b/ },
  { id: 'listen', pattern: /\.listen\s*\(\s*\d{2,5}\b/ },
];

/**
 * Repository-relative layout that would mean a server runtime was added.
 * Matched against every tracked-style path the collector finds.
 */
export const FORBIDDEN_LAYOUT = [
  { id: 'server-entry', pattern: /^server\.(?:cjs|mjs|js|ts)$/, reason: 'a server entrypoint' },
  { id: 'api-directory', pattern: /^api\//, reason: 'a root API directory' },
  { id: 'pages-api', pattern: /^pages\/api\//, reason: 'a Next-style API routes directory' },
  { id: 'src-server', pattern: /^src\/(?:server|api)\//, reason: 'a server module under src/' },
  {
    id: 'functions-directory',
    pattern: /^(?:netlify|supabase|firebase)\/functions\//,
    reason: 'a hosted functions directory',
  },
];

const SCANNED_SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function extensionOf(name) {
  return name.slice(name.lastIndexOf('.'));
}

/**
 * Pure check over in-memory inputs so the policy is unit-testable without a
 * filesystem:
 *
 *   - `dependencies`: package names from package.json (both blocks);
 *   - `sources`: `{ path, text }` production source files (tests excluded by
 *     the collector);
 *   - `workflows`: `{ path, text }` for every `.github/workflows/*.yml`;
 *   - `shellFiles`: `{ path, text }` for `index.html` and `public/` files;
 *   - `paths`: every collected repository-relative path, for layout rules.
 *
 * Returns a list of `{ path, id, reason }` violations.
 */
export function checkClientBoundary({ dependencies, sources, workflows, shellFiles, paths }) {
  const violations = [];
  const push = (path, id, reason) => violations.push({ path, id, reason });

  for (const name of dependencies) {
    for (const { id, pattern, reason } of PROHIBITED_DEPENDENCIES) {
      if (pattern.test(name)) push('package.json', `${id}:${name}`, reason);
    }
  }

  const scanAllowlisted = (file, patterns, allowlist, label) => {
    const allowed = allowlist[file.path] ?? [];
    for (const { id, pattern } of patterns) {
      const found = pattern.test(file.text);
      if (found && !allowed.includes(id)) {
        push(
          file.path,
          id,
          `${label} is restricted to reviewed modules; allowlist it in scripts/check-client-boundary.mjs only with a reviewed reason`,
        );
      }
    }
  };

  for (const source of sources) {
    scanAllowlisted(source, EGRESS_PATTERNS, ALLOWED_EGRESS, 'network egress');
    scanAllowlisted(source, STORAGE_PATTERNS, ALLOWED_STORAGE, 'durable browser storage');
    for (const { id, pattern } of RUNTIME_PATTERNS) {
      if (pattern.test(source.text)) {
        push(source.path, id, 'server/Node runtime APIs cannot run in the client-only bundle');
      }
    }
  }

  // Bidirectional allowlists: an entry whose file or usage disappeared is
  // stale and would silently license the next addition.
  const sourcesByPath = new Map(sources.map((source) => [source.path, source.text]));
  for (const [allowlistPath, ids] of [
    ...Object.entries(ALLOWED_EGRESS).map(([path, ids]) => [path, ids, EGRESS_PATTERNS]),
    ...Object.entries(ALLOWED_STORAGE).map(([path, ids]) => [path, ids, STORAGE_PATTERNS]),
  ]) {
    const text = sourcesByPath.get(allowlistPath);
    if (text === undefined) {
      push(allowlistPath, 'stale-allowlist', 'allowlisted module no longer exists');
      continue;
    }
    for (const id of ids) {
      const pattern = [...EGRESS_PATTERNS, ...STORAGE_PATTERNS].find((entry) => entry.id === id);
      if (pattern && !pattern.pattern.test(text)) {
        push(allowlistPath, 'stale-allowlist', `allowlisted ${id} usage no longer exists`);
      }
    }
  }

  for (const workflow of workflows) {
    if (/^[ \t]+services:/m.test(workflow.text)) {
      push(
        workflow.path,
        'workflow-services',
        'a CI services container is a server/database dependency the client-only boundary excludes',
      );
    }
  }

  for (const file of shellFiles) {
    if (/["'=]https?:\/\//.test(file.text.replace(/https?:\/\/www\.w3\.org\/2000\/svg/g, ''))) {
      push(
        file.path,
        'external-asset',
        'the static shell must boot without loading any external origin',
      );
    }
  }

  for (const path of paths) {
    for (const { id, pattern, reason } of FORBIDDEN_LAYOUT) {
      if (pattern.test(path)) push(path, id, `${reason} is outside the client-only boundary`);
    }
  }

  return violations;
}

function collectSources(repositoryRoot) {
  const files = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') visit(entryPath);
      } else if (
        entry.isFile() &&
        SCANNED_SOURCE_EXTENSIONS.has(extensionOf(entry.name)) &&
        // Tests name the prohibited primitives to prove they are rejected;
        // the policy constrains production source only.
        !/\.test\.[cm]?[jt]sx?$/.test(entry.name)
      ) {
        files.push(relative(repositoryRoot, entryPath).split('\\').join('/'));
      }
    }
  };
  visit(resolve(repositoryRoot, 'src'));
  return files.sort();
}

function collectWorkflows(repositoryRoot) {
  const directory = resolve(repositoryRoot, '.github/workflows');
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/.test(entry.name))
    .map((entry) => join('.github/workflows', entry.name))
    .sort();
}

function collectShellFiles(repositoryRoot) {
  const files = [];
  const publicDirectory = resolve(repositoryRoot, 'public');
  if (existsSync(publicDirectory)) {
    for (const entry of readdirSync(publicDirectory, { withFileTypes: true })) {
      if (entry.isFile()) files.push(join('public', entry.name));
    }
  }
  return ['index.html', ...files].filter((path) => /\.(?:html|svg)$/.test(path));
}

function run() {
  const repositoryRoot = process.cwd();
  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'));
  const dependencies = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ].sort();

  const read = (path) => readFileSync(resolve(repositoryRoot, path), 'utf8');
  const sourcePaths = collectSources(repositoryRoot);
  const workflowPaths = collectWorkflows(repositoryRoot);
  const shellPaths = collectShellFiles(repositoryRoot).filter((path) =>
    existsSync(resolve(repositoryRoot, path)),
  );

  const violations = checkClientBoundary({
    dependencies,
    sources: sourcePaths.map((path) => ({ path, text: read(path) })),
    workflows: workflowPaths.map((path) => ({ path, text: read(path) })),
    shellFiles: shellPaths.map((path) => ({ path, text: read(path) })),
    paths: [...sourcePaths, ...workflowPaths, ...shellPaths],
  });

  if (violations.length === 0) {
    console.log(
      `Client-boundary check passed: ${dependencies.length} dependencies, ${sourcePaths.length} source files, ${workflowPaths.length} workflows, and ${shellPaths.length} shell files stay inside the client-only boundary.`,
    );
    return;
  }

  console.error('Client-boundary check failed:');
  for (const violation of violations) {
    console.error(`- ${violation.path}: ${violation.reason} [${violation.id}]`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
