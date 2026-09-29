import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildGitHubIssue, readConfig, syncSentryIssues } from './sync-sentry-issues.mjs';

const SENTRY_ISSUE = {
  id: '12345',
  shortId: 'GTM-42',
  title: 'TypeError: Cannot read properties of undefined',
  permalink: 'https://example.sentry.io/issues/12345/',
  level: 'error',
  count: '17',
  userCount: 4,
  firstSeen: '2026-09-28T10:00:00Z',
  lastSeen: '2026-09-29T12:00:00Z',
};

const CONFIG = {
  sentryOrg: 'example',
  sentryProject: 'dashboard',
  sentryToken: 'sentry-token',
  githubToken: 'github-token',
  repository: 'example/dashboard',
  query: 'is:unresolved',
  maxNewIssues: 10,
  dryRun: false,
};

function response(body, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function harness({ githubIssues = [], sentryIssues = [SENTRY_ISSUE], missingLabels = false } = {}) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : null });

    if (url.hostname === 'sentry.io') return response(sentryIssues);
    if (url.pathname.endsWith('/issues') && method === 'GET') return response(githubIssues);
    if (url.pathname.includes('/labels/') && method === 'GET') {
      return missingLabels ? response(null, 404) : response({ name: 'label' });
    }
    if (url.pathname.endsWith('/labels') && method === 'POST') return response(init.body, 201);
    if (url.pathname.endsWith('/issues') && method === 'POST') return response({ number: 99 }, 201);
    if (url.pathname.endsWith('/comments') && method === 'POST') return response({ id: 1 }, 201);
    if (method === 'PATCH') return response({ state: 'open' });
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  return { calls, fetchImpl };
}

describe('configuration', () => {
  it('requires both providers and applies safe defaults', () => {
    assert.deepEqual(
      readConfig({
        SENTRY_ORG: 'org',
        SENTRY_PROJECT: 'project',
        SENTRY_AUTH_TOKEN: 'sentry',
        GITHUB_TOKEN: 'github',
        GITHUB_REPOSITORY: 'org/repository',
      }),
      {
        sentryOrg: 'org',
        sentryProject: 'project',
        sentryToken: 'sentry',
        githubToken: 'github',
        repository: 'org/repository',
        query: 'is:unresolved level:[error,fatal]',
        maxNewIssues: 10,
        dryRun: false,
      },
    );
    assert.throws(() => readConfig({}), /SENTRY_ORG is required/);
    assert.throws(
      () =>
        readConfig({
          SENTRY_ORG: 'org',
          SENTRY_PROJECT: 'project',
          SENTRY_AUTH_TOKEN: 'sentry',
          GITHUB_TOKEN: 'github',
          GITHUB_REPOSITORY: 'org/repository',
          SENTRY_MAX_NEW_ISSUES: '0',
        }),
      /positive integer/,
    );
  });
});

describe('GitHub issue rendering', () => {
  it('includes a stable deduplication marker, source link, impact, and triage steps', () => {
    const issue = buildGitHubIssue(SENTRY_ISSUE);

    assert.equal(issue.title, '[Sentry] GTM-42: TypeError: Cannot read properties of undefined');
    assert.match(issue.body, /<!-- sentry-issue:12345 -->/);
    assert.match(issue.body, /\[Open the error in Sentry\]/);
    assert.match(issue.body, /\| Events \| 17 \|/);
    assert.match(
      issue.body,
      /Review the latest event, stack trace, breadcrumbs, and trace context/,
    );
    assert.deepEqual(issue.labels, ['sentry', 'bug', 'needs-triage']);
  });
});

describe('Sentry issue synchronization', () => {
  it('creates one actionable GitHub issue for a new unresolved Sentry error', async () => {
    const { calls, fetchImpl } = harness();

    const result = await syncSentryIssues(CONFIG, { fetchImpl, log: () => {} });

    assert.deepEqual(result, {
      discovered: 1,
      created: 1,
      reopened: 0,
      existing: 0,
      deferred: 0,
    });
    const create = calls.find(
      (call) => call.method === 'POST' && call.url.pathname.endsWith('/issues'),
    );
    assert.equal(create.body.title, buildGitHubIssue(SENTRY_ISSUE).title);
    assert.match(create.body.body, /sentry-issue:12345/);
  });

  it('creates the workflow labels when the repository does not have them yet', async () => {
    const { calls, fetchImpl } = harness({ missingLabels: true });

    await syncSentryIssues(CONFIG, { fetchImpl, log: () => {} });

    const labels = calls.filter(
      (call) => call.method === 'POST' && call.url.pathname.endsWith('/labels'),
    );
    assert.deepEqual(
      labels.map((call) => call.body.name),
      ['sentry', 'bug', 'needs-triage'],
    );
  });

  it('deduplicates open issues and reopens closed issues when Sentry regresses', async () => {
    const openHarness = harness({
      githubIssues: [{ number: 7, state: 'open', body: '<!-- sentry-issue:12345 -->' }],
    });
    const openResult = await syncSentryIssues(CONFIG, {
      fetchImpl: openHarness.fetchImpl,
      log: () => {},
    });
    assert.equal(openResult.existing, 1);
    assert.equal(openHarness.calls.filter((call) => call.method !== 'GET').length, 0);

    const closedHarness = harness({
      githubIssues: [{ number: 7, state: 'closed', body: '<!-- sentry-issue:12345 -->' }],
    });
    const closedResult = await syncSentryIssues(CONFIG, {
      fetchImpl: closedHarness.fetchImpl,
      log: () => {},
    });
    assert.equal(closedResult.reopened, 1);
    assert.deepEqual(
      closedHarness.calls.filter((call) => call.method !== 'GET').map((call) => call.method),
      ['PATCH', 'POST'],
    );
  });

  it('honors dry-run and creation limits without mutating GitHub', async () => {
    const sentryIssues = [SENTRY_ISSUE, { ...SENTRY_ISSUE, id: '67890', shortId: 'GTM-43' }];
    const { calls, fetchImpl } = harness({ sentryIssues });

    const result = await syncSentryIssues(
      { ...CONFIG, dryRun: true, maxNewIssues: 1 },
      { fetchImpl, log: () => {} },
    );

    assert.equal(result.created, 1);
    assert.equal(result.deferred, 1);
    assert.equal(calls.filter((call) => call.method !== 'GET').length, 0);
  });
});
