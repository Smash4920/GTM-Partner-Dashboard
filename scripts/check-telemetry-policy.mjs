import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Telemetry egress privacy policy (VAL-SEC-005 through VAL-SEC-007), checked
 * statically so a regression fails the build instead of reaching a deploy:
 *
 *   - the browser alert-webhook transport stays removed: no
 *     `VITE_ALERT_ENDPOINT` variable, no `alertEndpoint` config field, and no
 *     webhook-posting helpers or known webhook URLs anywhere in source,
 *     configuration templates, or static assets;
 *   - production bundles carry no public source maps: no `.map` file under
 *     `dist/` and no `sourceMappingURL` comment in any emitted JavaScript or
 *     CSS;
 *   - the loopback HTTP collector exception never reaches production: no
 *     `http://127.0.0.1`, `http://localhost`, or `http://[::1]` literal in any
 *     emitted bundle (the development exception in src/lib/telemetry/config.ts
 *     is compiled out via import.meta.env.DEV).
 *
 * The behavioral half of the policy (master-switch gating, analytics dual
 * opt-in, per-envelope allowlists, fail-closed endpoint resolution) is pinned
 * by the Vitest suites in src/lib/telemetry/ and the Playwright spec
 * tests/e2e/telemetry-egress.spec.ts.
 */

/**
 * Policy scanners that must name the forbidden symbols to detect them. Each
 * entry is reviewed: a scanner is exempt, product source never is.
 */
export const POLICY_CHECKER_FILES = new Set([
  'scripts/check-telemetry-policy.mjs',
  'scripts/check-docs-consistency.mjs',
]);

/** Files scanned for forbidden source symbols, relative to the repository root. */
const SOURCE_ROOTS = ['src', 'public', 'scripts', 'config', '.github'];
const SOURCE_FILES = ['.env.example', 'vite.config.ts', 'index.html', 'package.json'];
const SCANNED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.html']);

/**
 * Symbols whose presence means browser-direct webhook delivery or an
 * environment knob for it has returned. Matched case-sensitively: these are
 * exact identifiers, and a prose mention in a comment is still a signal that
 * the removal rationale is being undone.
 */
export const FORBIDDEN_SOURCE_PATTERNS = [
  {
    id: 'alert-endpoint-env',
    pattern: /VITE_ALERT_ENDPOINT/,
    reason: 'the VITE_ALERT_ENDPOINT webhook variable was removed; alerts dispatch in-process only',
  },
  {
    id: 'alert-endpoint-field',
    pattern: /\balertEndpoint\b/,
    reason: 'the alertEndpoint config field was removed with the webhook transport',
  },
  {
    id: 'webhook-transport',
    pattern: /\b(?:postToWebhook|deliverWebhook)\b/,
    reason: 'browser-direct webhook delivery helpers were removed; alerts dispatch in-process only',
  },
  {
    id: 'webhook-url',
    pattern: /hooks\.slack\.com|discord(?:app)?\.com\/api\/webhooks/,
    reason: 'no chat webhook URL may be baked into a client bundle',
  },
];

/** Loopback HTTP collector literals that must never survive into dist/. */
export const FORBIDDEN_BUNDLE_PATTERNS = [
  {
    id: 'loopback-http',
    pattern: /http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/,
    reason:
      'the plain-HTTP loopback collector exception is development-only and must be compiled out of production bundles',
  },
];

function collectSourceFiles(repositoryRoot) {
  const files = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        // Tests name the forbidden symbols to prove the code rejects them;
        // the policy is that production source never references them.
        if (entry.name === 'node_modules') continue;
        visit(entryPath);
      } else if (entry.isFile()) {
        const path = relative(repositoryRoot, entryPath).split('\\').join('/');
        if (SCANNED_EXTENSIONS.has(entry.name.slice(entry.name.lastIndexOf('.')))) {
          files.push(path);
        }
      }
    }
  };
  for (const root of SOURCE_ROOTS) visit(resolve(repositoryRoot, root));
  for (const file of SOURCE_FILES) {
    if (existsSync(resolve(repositoryRoot, file))) files.push(file);
  }
  return files.sort();
}

/**
 * Pure check over in-memory inputs so the policy is unit-testable without a
 * filesystem. `sources` are `{ path, text }` production-source files; `dist`
 * is `{ path, text? }` where text is present for JavaScript and CSS assets.
 * Returns a list of `{ path, id, reason }` violations.
 */
export function checkTelemetryPolicy({ sources, dist }) {
  const violations = [];

  for (const { path, text } of sources) {
    // Test files deliberately name the forbidden symbols, and the policy
    // checkers necessarily spell them out in their own patterns. The policy
    // constrains product source and configuration, not the scanners.
    if (/\.test\.[cm]?[jt]sx?$/.test(path)) continue;
    if (POLICY_CHECKER_FILES.has(path)) continue;
    for (const { id, pattern, reason } of FORBIDDEN_SOURCE_PATTERNS) {
      if (pattern.test(text)) violations.push({ path, id, reason });
    }
  }

  for (const { path, text } of dist) {
    if (path.endsWith('.map')) {
      violations.push({
        path,
        id: 'source-map-file',
        reason: 'production bundles ship no public source maps',
      });
    }
    if (text === undefined) continue;
    if (/sourceMappingURL/.test(text)) {
      violations.push({
        path,
        id: 'source-map-comment',
        reason: 'emitted assets must not reference a source map',
      });
    }
    for (const { id, pattern, reason } of FORBIDDEN_BUNDLE_PATTERNS) {
      if (pattern.test(text)) violations.push({ path, id, reason });
    }
  }

  return violations;
}

function collectDistAssets(repositoryRoot) {
  const distRoot = resolve(repositoryRoot, 'dist');
  const assets = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile()) {
        const path = relative(repositoryRoot, entryPath).split('\\').join('/');
        const isTextAsset = /\.(?:js|css|html|map)$/.test(entry.name);
        assets.push({ path, text: isTextAsset ? readFileSync(entryPath, 'utf8') : undefined });
      }
    }
  };
  visit(distRoot);
  return assets;
}

function run() {
  const repositoryRoot = process.cwd();
  if (!existsSync(resolve(repositoryRoot, 'dist'))) {
    console.error(
      'Telemetry policy check failed: dist/ does not exist. Run `npm run build` first (bundle:check does).',
    );
    process.exitCode = 1;
    return;
  }

  const sources = collectSourceFiles(repositoryRoot).map((path) => ({
    path,
    text: readFileSync(resolve(repositoryRoot, path), 'utf8'),
  }));
  const violations = checkTelemetryPolicy({ sources, dist: collectDistAssets(repositoryRoot) });

  if (violations.length === 0) {
    console.log(
      `Telemetry policy check passed: ${sources.length} source files and the dist/ bundle are clean.`,
    );
    return;
  }

  console.error('Telemetry policy check failed:');
  for (const violation of violations) {
    console.error(`- ${violation.path}: ${violation.reason} [${violation.id}]`);
  }
  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run();
}
