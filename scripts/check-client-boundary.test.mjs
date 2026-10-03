import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  ALLOWED_EGRESS,
  ALLOWED_STORAGE,
  checkClientBoundary,
  collectLayoutPaths,
  collectShellFiles,
} from './check-client-boundary.mjs';

/** A throwaway repository root for the filesystem collectors. */
function withTempRoot(structure, run) {
  const root = mkdtempSync(join(tmpdir(), 'client-boundary-'));
  try {
    for (const [path, text] of Object.entries(structure)) {
      const absolute = join(root, path);
      mkdirSync(join(absolute, '..'), { recursive: true });
      writeFileSync(absolute, text);
    }
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Every allowed-module inventory entry must keep matching the real source, so
 * these fixtures mirror the reviewed usage instead of inventing a parallel
 * allowlist that could drift from it.
 */
const TELEMETRY_TRANSPORT = {
  path: 'src/lib/telemetry/transport.ts',
  text: 'const fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));',
};
const PERFORMANCE_TELEMETRY = {
  path: 'src/lib/performanceTelemetry.ts',
  text: 'sendBeacon: navigator.sendBeacon?.bind(navigator); dependencies.fetch(endpoint);',
};
const FLAG_MODULE = {
  path: 'src/lib/featureFlags.ts',
  text: 'storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,',
};
const PLAIN_MODULE = {
  path: 'src/lib/metrics.ts',
  text: 'export const total = (xs) => xs.length;',
};

const CLEAN_WORKFLOW = {
  path: '.github/workflows/ci.yml',
  text: 'jobs:\n  verify:\n    steps: []',
};
const CLEAN_SHELL = { path: 'index.html', text: '<html><head><title>x</title></head></html>' };
const CLEAN_DEPENDENCIES = ['react', 'react-dom', 'vite', 'vitest'];

function scan({
  dependencies = CLEAN_DEPENDENCIES,
  sources = [TELEMETRY_TRANSPORT, PERFORMANCE_TELEMETRY, FLAG_MODULE, PLAIN_MODULE],
  workflows = [CLEAN_WORKFLOW],
  shellFiles = [CLEAN_SHELL],
  paths = ['src/lib/metrics.ts'],
} = {}) {
  return checkClientBoundary({ dependencies, sources, workflows, shellFiles, paths });
}

describe('checkClientBoundary dependency rules', () => {
  it('passes a clean client-only inventory', () => {
    assert.deepEqual(scan(), []);
  });

  for (const [name, id] of [
    ['express', 'server-framework'],
    ['fastify', 'server-framework'],
    ['next', 'server-framework'],
    ['pg', 'database-client'],
    ['mongodb', 'database-client'],
    ['better-sqlite3', 'database-client'],
    ['@prisma/client', 'database-client'],
    ['drizzle-orm', 'database-client'],
    ['jsonwebtoken', 'authentication'],
    ['@auth/core', 'authentication'],
    ['@supabase/supabase-js', 'authentication'],
    ['openid-client', 'authentication'],
    ['snowflake-sdk', 'warehouse-or-cloud-data'],
    ['@google-cloud/bigquery', 'warehouse-or-cloud-data'],
    ['@aws-sdk/client-s3', 'warehouse-or-cloud-data'],
    ['axios', 'live-connector'],
    ['got', 'live-connector'],
    ['jsforce', 'live-connector'],
    ['@hubspot/api-client', 'live-connector'],
    ['@slack/webhook', 'notification-sender'],
    ['nodemailer', 'notification-sender'],
    ['twilio', 'notification-sender'],
    ['localforage', 'durable-store'],
    ['dexie', 'durable-store'],
    ['ws', 'realtime-channel'],
    ['socket.io-client', 'realtime-channel'],
  ]) {
    it(`rejects the ${name} dependency`, () => {
      const violations = scan({ dependencies: [...CLEAN_DEPENDENCIES, name] });
      assert.equal(violations.length, 1, name);
      assert.equal(violations[0].id, `${id}:${name}`);
      assert.equal(violations[0].path, 'package.json');
    });
  }

  it('tolerates names that merely resemble prohibited ones', () => {
    // Exact-name matching only: a lookalike dev tool is not a server runtime.
    assert.deepEqual(scan({ dependencies: ['express-validator-zz', 'webpack', 'react-dom'] }), []);
  });
});

describe('checkClientBoundary source egress rules', () => {
  it('rejects fetch outside the reviewed telemetry modules', () => {
    const violations = scan({
      sources: [
        TELEMETRY_TRANSPORT,
        PERFORMANCE_TELEMETRY,
        FLAG_MODULE,
        {
          path: 'src/data/providers.ts',
          text: 'export const load = () => fetch("/api/partners");',
        },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].path, 'src/data/providers.ts');
    assert.equal(violations[0].id, 'fetch');
  });

  it('rejects WebSocket, EventSource, and XHR anywhere in source', () => {
    const violations = scan({
      sources: [
        TELEMETRY_TRANSPORT,
        PERFORMANCE_TELEMETRY,
        FLAG_MODULE,
        { path: 'src/lib/live.ts', text: 'new WebSocket("wss://x")' },
        { path: 'src/lib/stream.ts', text: 'new EventSource("/events")' },
        { path: 'src/lib/legacy.ts', text: 'new XMLHttpRequest()' },
      ],
    });
    assert.deepEqual(
      violations.map((violation) => violation.id),
      ['websocket', 'eventsource', 'xhr'],
    );
  });

  it('rejects durable storage outside the reviewed flag-cohort module', () => {
    const violations = scan({
      sources: [
        TELEMETRY_TRANSPORT,
        PERFORMANCE_TELEMETRY,
        FLAG_MODULE,
        { path: 'src/App.tsx', text: 'sessionStorage.setItem("edits", json);' },
        { path: 'src/data/cache.ts', text: 'indexedDB.open("gtm");' },
        { path: 'src/lib/prefs.ts', text: 'document.cookie = "theme=dark";' },
      ],
    });
    assert.deepEqual(
      violations.map((violation) => violation.id),
      ['web-storage', 'indexeddb', 'cookie'],
    );
  });

  it('rejects Node runtime APIs in browser source', () => {
    const violations = scan({
      sources: [
        TELEMETRY_TRANSPORT,
        PERFORMANCE_TELEMETRY,
        FLAG_MODULE,
        { path: 'src/lib/secrets.ts', text: 'const key = process.env.API_KEY;' },
        { path: 'src/server.ts', text: 'app.listen(8080);' },
        { path: 'src/lib/fs.ts', text: 'import fs from "node:fs";' },
      ],
    });
    assert.deepEqual(
      violations.map((violation) => violation.id),
      ['process-env', 'listen', 'node-builtin'],
    );
  });

  it('fails when an allowlisted module drops the usage it was reviewed for', () => {
    const violations = scan({
      sources: [
        { path: 'src/lib/telemetry/transport.ts', text: 'export const noop = true;' },
        PERFORMANCE_TELEMETRY,
        FLAG_MODULE,
      ],
    });
    assert.deepEqual(violations, [
      {
        path: 'src/lib/telemetry/transport.ts',
        id: 'stale-allowlist',
        reason: 'allowlisted fetch usage no longer exists',
      },
    ]);
  });

  it('fails when an allowlisted module no longer exists', () => {
    const violations = scan({ sources: [PERFORMANCE_TELEMETRY, FLAG_MODULE] });
    assert.ok(
      violations.some(
        (violation) =>
          violation.path === 'src/lib/telemetry/transport.ts' && violation.id === 'stale-allowlist',
      ),
    );
  });

  it('keeps the reviewed allowlists pointed at the intended modules', () => {
    assert.deepEqual(Object.keys(ALLOWED_EGRESS).sort(), [
      'src/lib/performanceTelemetry.ts',
      'src/lib/telemetry/transport.ts',
    ]);
    assert.deepEqual(Object.keys(ALLOWED_STORAGE), ['src/lib/featureFlags.ts']);
  });
});

describe('checkClientBoundary workflow, shell, and layout rules', () => {
  it('rejects a workflow services container', () => {
    const violations = scan({
      workflows: [
        {
          path: '.github/workflows/ci.yml',
          text: 'jobs:\n  verify:\n    services:\n      postgres:\n        image: postgres',
        },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].id, 'workflow-services');
  });

  it('rejects external assets in the static shell but tolerates the SVG namespace', () => {
    const violations = scan({
      shellFiles: [
        { path: 'index.html', text: '<script src="https://cdn.example.com/app.js"></script>' },
        { path: 'public/favicon.svg', text: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
      ],
    });
    assert.deepEqual(
      violations.map((violation) => violation.path),
      ['index.html'],
    );
  });

  it('rejects server-shaped repository layout', () => {
    const violations = scan({
      paths: ['server.ts', 'api/partners.ts', 'src/server/index.ts', 'netlify/functions/sync.ts'],
    });
    assert.deepEqual(
      violations.map((violation) => violation.id),
      ['server-entry', 'api-directory', 'src-server', 'functions-directory'],
    );
  });

  it('collects root-level layout paths so the root rules can fire in a live run', () => {
    // The src/workflow/shell collectors never visit the repository root, so
    // without this probe server.ts or api/ would pass unnoticed.
    withTempRoot(
      {
        'package.json': '{}',
        'server.ts': 'app.listen(8080);',
        'api/partners.ts': 'export {};',
        'pages/api/checkout.ts': 'export {};',
        'netlify/functions/sync.ts': 'export {};',
        'docs/notes.md': '# not probed',
      },
      (root) => {
        const paths = collectLayoutPaths(root);
        assert.ok(paths.includes('server.ts'));
        assert.ok(paths.includes('api/'));
        assert.ok(paths.includes('api/partners.ts'));
        assert.ok(paths.includes('pages/api/'));
        assert.ok(paths.includes('pages/api/checkout.ts'));
        assert.ok(paths.includes('netlify/functions/'));
        // Unrelated directories stay out of the probe.
        assert.ok(!paths.some((path) => path.startsWith('docs/')));

        // Directory and contained-file paths each match their rule, so assert
        // on the set of violated rule ids rather than the raw list.
        const violations = scan({ paths });
        assert.deepEqual([...new Set(violations.map((violation) => violation.id))].sort(), [
          'api-directory',
          'functions-directory',
          'pages-api',
          'server-entry',
        ]);
      },
    );
  });

  it('collects shell files from public/ subdirectories, not just the top level', () => {
    withTempRoot(
      {
        'index.html': '<html></html>',
        'public/favicon.svg': '<svg></svg>',
        'public/assets/logo.svg': '<svg></svg>',
        'public/assets/nested/deep.svg': '<svg></svg>',
        'public/assets/readme.txt': 'not a shell asset',
      },
      (root) => {
        // Sort: readdirSync order is filesystem-dependent.
        assert.deepEqual(collectShellFiles(root).sort(), [
          'index.html',
          'public/assets/logo.svg',
          'public/assets/nested/deep.svg',
          'public/favicon.svg',
        ]);
      },
    );
  });
});
