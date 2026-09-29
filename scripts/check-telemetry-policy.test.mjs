import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkTelemetryPolicy } from './check-telemetry-policy.mjs';

const CLEAN_SOURCE = { path: 'src/lib/telemetry/alerts.ts', text: 'export function dispatch() {}' };
const CLEAN_BUNDLE = { path: 'dist/assets/index-abc.js', text: 'const a=1;' };

function scan({ sources = [CLEAN_SOURCE], dist = [CLEAN_BUNDLE] } = {}) {
  return checkTelemetryPolicy({ sources, dist });
}

describe('checkTelemetryPolicy source rules', () => {
  it('passes clean source and a clean bundle', () => {
    assert.deepEqual(scan(), []);
  });

  it('fails when the removed alert webhook variable reappears', () => {
    const violations = scan({
      sources: [
        { path: 'src/lib/telemetry/config.ts', text: 'const x = env.VITE_ALERT_ENDPOINT;' },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].id, 'alert-endpoint-env');
  });

  it('fails when the alertEndpoint field or webhook helpers reappear', () => {
    const violations = scan({
      sources: [
        { path: 'src/lib/telemetry/config.ts', text: 'export const alertEndpoint = null;' },
        { path: 'src/lib/telemetry/alerts.ts', text: 'async function postToWebhook() {}' },
        { path: 'src/lib/telemetry/alerts.ts', text: 'async function deliverWebhook() {}' },
      ],
    });
    assert.deepEqual(
      violations.map((v) => v.id),
      ['alert-endpoint-field', 'webhook-transport', 'webhook-transport'],
    );
  });

  it('fails when a chat webhook URL is baked into source', () => {
    const violations = scan({
      sources: [
        { path: 'src/lib/telemetry/alerts.ts', text: 'fetch("https://hooks.slack.com/x")' },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].id, 'webhook-url');
  });

  it('ignores test files and the checker itself, which name the symbols on purpose', () => {
    const violations = scan({
      sources: [
        { path: 'src/lib/telemetry/config.test.ts', text: 'env.VITE_ALERT_ENDPOINT' },
        { path: 'scripts/check-telemetry-policy.mjs', text: 'VITE_ALERT_ENDPOINT alertEndpoint' },
      ],
    });
    assert.deepEqual(violations, []);
  });
});

describe('checkTelemetryPolicy bundle rules', () => {
  it('fails when a source map file is emitted', () => {
    const violations = scan({
      dist: [CLEAN_BUNDLE, { path: 'dist/assets/index-abc.js.map', text: '{}' }],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].id, 'source-map-file');
  });

  it('fails when an asset references a source map', () => {
    const violations = scan({
      dist: [
        {
          path: 'dist/assets/index-abc.js',
          text: 'const a=1;\n//# sourceMappingURL=index-abc.js.map',
        },
      ],
    });
    assert.equal(violations.length, 1);
    assert.equal(violations[0].id, 'source-map-comment');
  });

  it('fails when the loopback HTTP exception leaks into the bundle', () => {
    for (const literal of ['http://127.0.0.1', 'http://localhost', 'http://[::1]']) {
      const violations = scan({
        dist: [{ path: 'dist/assets/index-abc.js', text: `fetch("${literal}:9000/ingest")` }],
      });
      assert.equal(violations.length, 1, literal);
      assert.equal(violations[0].id, 'loopback-http');
    }
  });

  it('tolerates ordinary http references that are not telemetry egress', () => {
    const violations = scan({
      dist: [
        {
          path: 'dist/assets/index-abc.js',
          text: 'createElementNS("http://www.w3.org/2000/svg","svg")',
        },
      ],
    });
    assert.deepEqual(violations, []);
  });
});
