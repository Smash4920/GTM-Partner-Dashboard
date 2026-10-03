import { expect, test, type Page } from '@playwright/test';

const DIGEST_FAILURE = 'getRegistrationSlaAlerts:1:1';
const ROSTER_FAILURE = 'getTeamRoster:1:1';

async function openRemoteQueue(page: Page, plan: string) {
  const errors: string[] = [];
  const requests: { url: string; method: string }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  await page.goto(`/?remoteFailMethods=${plan}`);
  // Navigate before committing remote so the first roster/digest answers
  // belong to this route, not to a landing-page request that consumes a skip.
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name: 'Data Connections', exact: true })
    .click();
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();

  const queue = page.getByRole('group', { name: 'The SLA alert queue', exact: true });
  const roster = page.getByRole('group', { name: 'The team roster', exact: true });
  const composer = page.getByRole('group', { name: 'The notification composer', exact: true });
  const batch = queue.getByRole('button', { name: /^Notify all \d+ owners$/ });
  await expect(batch).toBeEnabled();
  await expect(roster.getByRole('button', { name: 'Pause notifications' }).first()).toBeVisible();
  await expect(composer.getByLabel('Subject')).toBeVisible();

  // The digest and rendered table share the same eight-row bound. Derive
  // the recipient from real routed evidence rather than a hard-coded name.
  const alertRows = queue.locator('tbody tr');
  await expect(alertRows).toHaveCount(8);
  const owners = await alertRows.locator('td:nth-child(2)').allTextContents();
  const ownerNames = owners.map((name) => name.trim());
  const pausedName = ownerNames.find((name) => name !== 'No owner — add one');
  if (!pausedName) throw new Error('Expected an active routed owner in the seeded digest');
  const teamRow = roster.getByRole('row').filter({
    has: page.getByText(pausedName, { exact: true }),
  });
  await expect(teamRow).toHaveCount(1);
  const pause = teamRow.getByRole('button', { name: 'Pause notifications', exact: true });
  await expect(pause).toBeEnabled();

  const initialCount = Number((await batch.innerText()).match(/\d+/)?.[0]);
  const pausedCount = ownerNames.filter((name) => name === pausedName).length;
  expect(initialCount).toBe(ownerNames.filter((name) => name !== 'No owner — add one').length);
  const eligibleCount = initialCount - pausedCount;
  expect(eligibleCount).toBeGreaterThan(0);
  await expect(queue.getByText('Sent this session · 0', { exact: true })).toBeVisible();

  return {
    queue,
    roster,
    composer,
    batch,
    pause,
    teamRow,
    pausedName,
    eligibleCount,
    ownerNames,
    errors,
    requests,
  };
}

type QueueContext = Awaited<ReturnType<typeof openRemoteQueue>>;

async function expectOnlyEligibleBatch(context: QueueContext) {
  const { queue, pausedName, eligibleCount } = context;
  // The log shows only its latest five rows. Its uncapped total is essential:
  // checking visible names alone could miss an earlier suspended-user save.
  await expect(
    queue.getByText(`Sent this session · ${eligibleCount}`, { exact: true }),
  ).toBeVisible();
  const log = queue.locator('ul');
  await expect(log.getByText(pausedName, { exact: true })).toHaveCount(0);
  await expect(log.locator('li').first()).toBeVisible();
  await expect(
    queue.getByText(
      'Simulated / local only — recorded for this session, never delivered. Refresh clears them.',
      { exact: true },
    ),
  ).toBeVisible();
}

function expectLocalOnly(page: Page, context: QueueContext) {
  expect(context.errors).toEqual([]);
  const origin = new URL(page.url()).origin;
  expect(
    context.requests.every(({ url, method }) => new URL(url).origin === origin && method === 'GET'),
  ).toBe(true);
  expect(context.requests.some(({ url }) => url.includes('/@vite/client'))).toBe(false);
}

test('VAL-ACT-016: a failed digest refresh retains its evidence but excludes the newly paused batch recipient', async ({
  page,
}) => {
  const context = await openRemoteQueue(page, DIGEST_FAILURE);
  const { queue, roster, batch, pause, teamRow, ownerNames } = context;
  await pause.click();
  await expect(queue.getByText('Failed to load the registration SLA alerts')).toBeVisible();
  await expect(queue.getByRole('button', { name: 'Retry The SLA alert queue' })).toBeVisible();
  await expect(teamRow.getByRole('button', { name: 'Resume notifications' })).toBeVisible();
  await expect(roster.getByText('Latest refresh failed:')).toHaveCount(0);
  expect(
    (await queue.locator('tbody tr td:nth-child(2)').allTextContents()).map((name) => name.trim()),
  ).toEqual(ownerNames);

  await batch.click();
  await expectOnlyEligibleBatch(context);
  // Saving must not erase or silently heal the failed evidence query.
  await expect(queue.getByText('Failed to load the registration SLA alerts')).toBeVisible();
  await queue.getByRole('button', { name: 'Retry The SLA alert queue' }).click();
  await expect(queue.getByText('Latest refresh failed:')).toHaveCount(0);
  await expect(teamRow.getByRole('button', { name: 'Resume notifications' })).toBeVisible();
  expectLocalOnly(page, context);
});

test('VAL-ACT-016: failed digest and roster refreshes cannot save an old composer recipient and retain independent retries', async ({
  page,
}) => {
  const context = await openRemoteQueue(page, `${DIGEST_FAILURE},${ROSTER_FAILURE}`);
  const { queue, roster, composer, batch, pause, pausedName, teamRow } = context;
  const alertRow = queue
    .getByRole('row')
    .filter({
      has: page.getByText(pausedName, { exact: true }),
    })
    .first();
  await alertRow.getByRole('button', { name: 'Notify owner', exact: true }).click();
  const send = composer.getByRole('button', { name: `Send to ${pausedName}`, exact: true });
  await expect(send).toBeEnabled();
  const subject = await composer.getByLabel('Subject').inputValue();
  await pause.click();

  await expect(queue.getByText('Failed to load the registration SLA alerts')).toBeVisible();
  await expect(roster.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(composer.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(composer.getByLabel('Subject')).toHaveValue(subject);
  // The retained roster still renders the previously active recipient. Exercise
  // the real enabled control: current session status must win at save time.
  await expect(send).toBeEnabled();
  await send.click();
  await expect(queue.getByText('Sent this session · 0', { exact: true })).toBeVisible();
  await expect(composer.getByText(/Simulated \/ local only · \d/)).toHaveCount(0);

  await batch.click();
  await expectOnlyEligibleBatch(context);
  await queue.getByRole('button', { name: 'Retry The SLA alert queue' }).click();
  await expect(queue.getByText('Latest refresh failed:')).toHaveCount(0);
  await expect(roster.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(composer.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(queue.locator('tbody').getByText(pausedName, { exact: true })).toHaveCount(0);

  await roster.getByRole('button', { name: 'Retry The team roster' }).click();
  await expect(roster.getByText('Latest refresh failed:')).toHaveCount(0);
  await expect(composer.getByText('Latest refresh failed:')).toHaveCount(0);
  await expect(teamRow.getByRole('button', { name: 'Resume notifications' })).toBeVisible();
  await expectOnlyEligibleBatch(context);
  expectLocalOnly(page, context);
});

test('VAL-ACT-016: immediate batch clicks during pending recipient refresh exclude paused users and provider commit resets the session', async ({
  page,
}) => {
  const context = await openRemoteQueue(page, `${DIGEST_FAILURE},${ROSTER_FAILURE}`);
  const { queue, roster, batch, pause, pausedName, eligibleCount } = context;
  const pauseHandle = await pause.elementHandle();
  const batchHandle = await batch.elementHandle();
  if (!pauseHandle || !batchHandle) throw new Error('Expected live pause and batch controls');

  // Both native clicks run in one browser turn, before the ~250 ms simulated
  // refresh can answer; no Playwright auto-wait or sleep can consume the race.
  await page.evaluate(
    ({ pauseButton, batchButton }) => {
      if (!(pauseButton instanceof HTMLButtonElement)) throw new Error('Missing pause button');
      if (!(batchButton instanceof HTMLButtonElement)) throw new Error('Missing batch button');
      pauseButton.click();
      batchButton.click();
    },
    { pauseButton: pauseHandle, batchButton: batchHandle },
  );
  await expectOnlyEligibleBatch(context);
  await expect(queue.getByText('Failed to load the registration SLA alerts')).toBeVisible();
  await expect(roster.getByText('Failed to load the notification roster')).toBeVisible();
  await expect(
    queue.getByText(`Sent this session · ${eligibleCount}`, { exact: true }),
  ).toBeVisible();

  // A committed provider change starts a fresh session, not an everlasting
  // recipient denylist or a replay of records from the previous generation.
  await page.getByLabel('Data provider').selectOption('local');
  await expect(page.getByLabel('Data provider')).toHaveValue('local');
  await expect(queue.getByText('Sent this session · 0', { exact: true })).toBeVisible();
  await expect(queue.getByText('Latest refresh failed:')).toHaveCount(0);
  await expect(roster.getByText('Latest refresh failed:')).toHaveCount(0);
  const restoredRow = queue
    .getByRole('row')
    .filter({
      has: page.getByText(pausedName, { exact: true }),
    })
    .first();
  await restoredRow.getByRole('button', { name: 'Notify owner', exact: true }).click();
  await page.getByRole('button', { name: `Send to ${pausedName}`, exact: true }).click();
  await expect(queue.getByText('Sent this session · 1', { exact: true })).toBeVisible();
  await expect(queue.locator('ul').getByText(pausedName, { exact: true })).toBeVisible();
  expectLocalOnly(page, context);
});
