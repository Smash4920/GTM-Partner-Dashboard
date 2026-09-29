import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTRY_API = 'https://sentry.io/api/0';
const DEFAULT_QUERY = 'is:unresolved level:[error,fatal]';
const DEFAULT_MAX_NEW_ISSUES = 10;
const LABELS = [
  { name: 'sentry', color: '362d59', description: 'Created from an unresolved Sentry error' },
  { name: 'bug', color: 'd73a4a', description: "Something isn't working" },
  {
    name: 'needs-triage',
    color: 'fbca04',
    description: 'Requires investigation and prioritization',
  },
];

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(value, fallback) {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('SENTRY_MAX_NEW_ISSUES must be a positive integer');
  }
  return parsed;
}

export function readConfig(environment = process.env) {
  return {
    sentryOrg: required(environment, 'SENTRY_ORG'),
    sentryProject: required(environment, 'SENTRY_PROJECT'),
    sentryToken: required(environment, 'SENTRY_AUTH_TOKEN'),
    githubToken: required(environment, 'GITHUB_TOKEN'),
    repository: required(environment, 'GITHUB_REPOSITORY'),
    query: environment.SENTRY_ISSUE_QUERY?.trim() || DEFAULT_QUERY,
    maxNewIssues: positiveInteger(environment.SENTRY_MAX_NEW_ISSUES, DEFAULT_MAX_NEW_ISSUES),
    dryRun: environment.DRY_RUN === 'true',
  };
}

async function request(fetchImpl, url, options) {
  const response = await fetchImpl(url, options);
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(
      `${options.method ?? 'GET'} ${new URL(url).pathname} failed (${response.status}): ${detail}`,
    );
  }
  return response.status === 204 ? null : response.json();
}

function sentryMarker(issueId) {
  return `<!-- sentry-issue:${issueId} -->`;
}

function display(value, fallback = 'Unknown') {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

export function buildGitHubIssue(sentryIssue) {
  const title = `[Sentry] ${display(sentryIssue.shortId, sentryIssue.id)}: ${display(sentryIssue.title, 'Unhandled error')}`;
  const body = [
    sentryMarker(sentryIssue.id),
    '## Sentry error',
    '',
    `[Open the error in Sentry](${sentryIssue.permalink})`,
    '',
    '| Signal | Value |',
    '| --- | --- |',
    `| Sentry ID | \`${display(sentryIssue.shortId, sentryIssue.id)}\` |`,
    `| Level | ${display(sentryIssue.level)} |`,
    `| Events | ${display(sentryIssue.count, '0')} |`,
    `| Users affected | ${display(sentryIssue.userCount, '0')} |`,
    `| First seen | ${display(sentryIssue.firstSeen)} |`,
    `| Last seen | ${display(sentryIssue.lastSeen)} |`,
    '',
    '### Triage checklist',
    '',
    '- [ ] Confirm the affected release and environment in Sentry',
    '- [ ] Review the latest event, stack trace, breadcrumbs, and trace context',
    '- [ ] Identify the owner and impact',
    '- [ ] Add or update a regression test',
    '- [ ] Resolve this issue and the linked Sentry issue after the fix is deployed',
    '',
    '_This issue is maintained by `.github/workflows/error-to-insight.yml`. Closing it while the Sentry issue remains unresolved causes it to reopen on the next sync._',
  ].join('\n');

  return {
    title: title.slice(0, 256),
    body,
    labels: LABELS.map((label) => label.name),
  };
}

function markerFromBody(body) {
  return /<!-- sentry-issue:(\d+) -->/.exec(body ?? '')?.[1] ?? null;
}

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'x-github-api-version': '2022-11-28',
  };
}

async function loadSentryIssues(config, fetchImpl) {
  const path = `/projects/${encodeURIComponent(config.sentryOrg)}/${encodeURIComponent(config.sentryProject)}/issues/`;
  const url = new URL(`${SENTRY_API}${path}`);
  url.searchParams.set('query', config.query);
  url.searchParams.set('sort', 'freq');
  url.searchParams.set('statsPeriod', '14d');
  url.searchParams.set('limit', '100');
  return request(fetchImpl, url, {
    headers: { authorization: `Bearer ${config.sentryToken}` },
  });
}

async function loadLinkedGitHubIssues(config, fetchImpl) {
  const url = new URL(`https://api.github.com/repos/${config.repository}/issues`);
  url.searchParams.set('state', 'all');
  url.searchParams.set('labels', 'sentry');
  url.searchParams.set('per_page', '100');
  const issues = await request(fetchImpl, url, {
    headers: githubHeaders(config.githubToken),
  });
  return new Map(
    issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => [markerFromBody(issue.body), issue])
      .filter(([marker]) => marker !== null),
  );
}

async function ensureLabels(config, fetchImpl) {
  for (const label of LABELS) {
    const labelUrl = `https://api.github.com/repos/${config.repository}/labels/${encodeURIComponent(label.name)}`;
    const response = await fetchImpl(labelUrl, { headers: githubHeaders(config.githubToken) });
    if (response.ok) continue;
    if (response.status !== 404) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`GET ${new URL(labelUrl).pathname} failed (${response.status}): ${detail}`);
    }
    await request(fetchImpl, `https://api.github.com/repos/${config.repository}/labels`, {
      method: 'POST',
      headers: githubHeaders(config.githubToken),
      body: JSON.stringify(label),
    });
  }
}

export async function syncSentryIssues(config, { fetchImpl = fetch, log = console.log } = {}) {
  const [sentryIssues, linkedIssues] = await Promise.all([
    loadSentryIssues(config, fetchImpl),
    loadLinkedGitHubIssues(config, fetchImpl),
  ]);
  const result = {
    discovered: sentryIssues.length,
    created: 0,
    reopened: 0,
    existing: 0,
    deferred: 0,
  };

  if (!config.dryRun && sentryIssues.some((issue) => !linkedIssues.has(String(issue.id)))) {
    await ensureLabels(config, fetchImpl);
  }

  for (const sentryIssue of sentryIssues) {
    const existing = linkedIssues.get(String(sentryIssue.id));
    if (existing) {
      if (existing.state === 'closed') {
        log(
          `${config.dryRun ? 'Would reopen' : 'Reopening'} #${existing.number} for Sentry ${sentryIssue.id}`,
        );
        if (!config.dryRun) {
          await request(
            fetchImpl,
            `https://api.github.com/repos/${config.repository}/issues/${existing.number}`,
            {
              method: 'PATCH',
              headers: githubHeaders(config.githubToken),
              body: JSON.stringify({ state: 'open' }),
            },
          );
          await request(
            fetchImpl,
            `https://api.github.com/repos/${config.repository}/issues/${existing.number}/comments`,
            {
              method: 'POST',
              headers: githubHeaders(config.githubToken),
              body: JSON.stringify({
                body: `Reopened automatically because [Sentry ${display(sentryIssue.shortId, sentryIssue.id)}](${sentryIssue.permalink}) is unresolved again.`,
              }),
            },
          );
        }
        result.reopened += 1;
      } else {
        result.existing += 1;
      }
      continue;
    }

    if (result.created >= config.maxNewIssues) {
      result.deferred += 1;
      continue;
    }
    log(`${config.dryRun ? 'Would create' : 'Creating'} GitHub issue for Sentry ${sentryIssue.id}`);
    if (!config.dryRun) {
      await request(fetchImpl, `https://api.github.com/repos/${config.repository}/issues`, {
        method: 'POST',
        headers: githubHeaders(config.githubToken),
        body: JSON.stringify(buildGitHubIssue(sentryIssue)),
      });
    }
    result.created += 1;
  }

  return result;
}

function summary(result, dryRun) {
  const prefix = dryRun ? 'Dry run: would process' : 'Processed';
  return `${prefix} ${result.discovered} unresolved Sentry errors: ${result.created} created, ${result.reopened} reopened, ${result.existing} already open, ${result.deferred} deferred.`;
}

export async function run(environment = process.env) {
  const config = readConfig(environment);
  const result = await syncSentryIssues(config);
  const message = summary(result, config.dryRun);
  console.log(message);
  if (environment.GITHUB_STEP_SUMMARY) {
    appendFileSync(environment.GITHUB_STEP_SUMMARY, `## Error to insight sync\n\n${message}\n`);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
