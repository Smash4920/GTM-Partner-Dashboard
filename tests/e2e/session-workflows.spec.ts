import { expect, test, type Locator, type Page } from '@playwright/test';

const PRIVACY_SENTINEL = 'PRIVATE-workflow-reason-VAL-ACT-019';
const EMPTY_COUNTS = 'Registration decisions: 0 · Conflict dispositions: 0 · Forecast reviews: 0';
const ACTOR_LABEL = 'Demo actor (not authenticated)';

function observe(page: Page) {
  const requests: { url: string; method: string; body: string | null }[] = [];
  const consoleMessages: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  );
  page.on('console', (message) => {
    consoleMessages.push(message.text());
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return async () => {
    expect(errors).toEqual([]);
    expect(consoleMessages.join('\n')).not.toContain(PRIVACY_SENTINEL);
    expect(JSON.stringify(requests)).not.toContain(PRIVACY_SENTINEL);
    expect(
      requests.filter(
        ({ url, method }) => new URL(url).origin !== new URL(page.url()).origin || method !== 'GET',
      ),
    ).toEqual([]);
    expect(requests.some(({ url }) => url.includes('/@vite/client'))).toBe(false);
    await expectEmptyStores(page);
  };
}

async function expectEmptyStores(page: Page) {
  expect(
    await page.evaluate(async () => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
      databases: await indexedDB.databases(),
    })),
  ).toEqual({ local: [], session: [], databases: [] });
  expect(await page.context().cookies()).toEqual([]);
}

async function isolateWorkflowStorage(page: Page) {
  // The pre-existing flag rollout identity is unrelated to workflow state.
  // Remove only that known key, never workflow keys or either entire store.
  await page.evaluate(() => localStorage.removeItem('gtm.feature-flags.subject.v1'));
  await expectEmptyStores(page);
}

async function boot(page: Page, query = '') {
  await page.goto('/');
  if (query) await page.goto(`${page.url()}${query}`);
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview', level: 1 }),
  ).toBeVisible();
  await isolateWorkflowStorage(page);
}

async function navigate(page: Page, name: string) {
  const button = page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('button', { name, exact: true });
  if (!(await button.isVisible())) {
    await page.getByRole('button', { name: /Collapse sidebar|Expand sidebar/ }).click();
  }
  await button.click();
}

function card(page: Page, title: string) {
  return page
    .getByRole('heading', { name: title, exact: true })
    .locator('xpath=ancestor::*[contains(@class,"rounded-card")][1]');
}

function metric(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..').locator('p').nth(1);
}

function records(page: Page) {
  return page.getByRole('list', { name: 'Session workflow records', exact: true });
}

function changes(page: Page) {
  return page.getByRole('list', { name: 'Current-session forecast changes', exact: true });
}

async function invalidBlankSubmission(dialog: Locator, options: string[]) {
  const actor = dialog.getByLabel(ACTOR_LABEL, { exact: true });
  await expect(actor).toBeVisible();
  await expect(actor).toHaveValue('');
  await expect(dialog.getByLabel('Outcome', { exact: true }).locator('option')).toHaveText([
    'Select outcome',
    ...options,
  ]);
  await dialog.getByRole('button', { name: 'Record session outcome' }).click();
  await expect(actor).toBeFocused();
  for (const label of [ACTOR_LABEL, 'Outcome', 'Reason']) {
    const control = dialog.getByLabel(label, { exact: true });
    await expect(control).toHaveAttribute('aria-invalid', 'true');
    const description = await control.getAttribute('aria-describedby');
    expect(description).toBeTruthy();
    await expect(dialog.locator(`[id="${description}"]`)).toBeVisible();
  }
  // The on-demand internal roster includes active actors, not the invited analyst.
  await expect(actor.locator('option')).toHaveCount(8);
  await expect(actor).not.toContainText('Sam Whitaker');
  await expect(actor.locator('option[value="user-01"]')).toHaveText('Alex Morgan · user-01');
  await actor.selectOption('user-01');
  await dialog.getByRole('button', { name: 'Record session outcome' }).click();
  await expect(dialog.getByLabel('Outcome', { exact: true })).toBeFocused();
  await dialog.getByLabel('Outcome', { exact: true }).selectOption(options[0]);
  await dialog.getByLabel('Reason', { exact: true }).fill('   ');
  await dialog.getByRole('button', { name: 'Record session outcome' }).click();
  await expect(dialog.getByLabel('Reason', { exact: true })).toBeFocused();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );
}

async function saveOutcome(
  page: Page,
  dialog: Locator,
  kind: string,
  ids: string[],
  outcome: string,
  reason = PRIVACY_SENTINEL,
  changeId?: string,
) {
  await dialog.getByLabel(ACTOR_LABEL, { exact: true }).selectOption('user-01');
  await dialog.getByLabel('Outcome', { exact: true }).selectOption(outcome);
  await dialog.getByLabel('Reason', { exact: true }).fill(`  ${reason}  `);
  const before = await page.evaluate(() => Date.now());
  await dialog.getByRole('button', { name: 'Record session outcome' }).click();
  const saved = page.getByRole('dialog', { name: 'Session outcome recorded', exact: true });
  await expect(saved).toBeVisible();
  const after = await page.evaluate(() => Date.now());
  const time = await saved.locator('time').getAttribute('datetime');
  expect(time).toBeTruthy();
  expect(new Date(time!).toISOString()).toBe(time);
  expect(Date.parse(time!)).toBeGreaterThanOrEqual(before);
  expect(Date.parse(time!)).toBeLessThanOrEqual(after);
  const detail = `${kind}: ${ids.join(', ')}${changeId ? ` · ${changeId}` : ''} · outcome ${outcome} · actor user-01 (not authenticated) · reason: ${reason} · time ${time} · simulated/local-only`;
  await expect(saved.locator('p:has(time)')).toHaveText(detail);
  await saved.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(records(page).getByRole('listitem').first()).toHaveText(detail);
}

async function editRevenue(page: Page, value = '987654321') {
  const table = page.getByRole('region', { name: 'In-quarter opportunities, scrollable' });
  const openOpportunity = table
    .getByRole('button', { name: /^Edit forecast category for / })
    .first();
  const rowIndex = await openOpportunity.evaluate(
    (element) => (element.closest('tr') as HTMLTableRowElement).rowIndex,
  );
  // Editors unmount their opener; anchor the row independently of that button.
  const row = table.getByRole('row').nth(rowIndex);
  const opener = row.getByRole('button', { name: /^Edit revenue forecast for / });
  await opener.click();
  await row.getByRole('textbox', { name: /^Revenue forecast for / }).fill(value);
  await row.getByRole('button', { name: 'Save revenue', exact: true }).click();
  const change = changes(page).getByRole('listitem').last();
  await expect(change).toContainText(` · revenue: ${value}`);
  const id = (await change.locator('span').innerText()).split(' · ')[1];
  expect(id).toMatch(/^opp-/);
  const editedRow = table
    .getByRole('row')
    .filter({ hasText: `$${Number(value).toLocaleString('en-US')}` });
  await expect(editedRow).toHaveCount(1);
  return { id, row: editedRow };
}

async function pendingRegistration(page: Page) {
  const opener = card(page, 'Registrations awaiting review')
    .getByRole('button', { name: /^Decide reg-/ })
    .first();
  await expect(opener).toBeVisible();
  return { opener, id: (await opener.getAttribute('aria-label'))!.replace('Decide ', '') };
}

async function conflictTarget(page: Page) {
  const opener = card(page, 'Duplicate & conflicting registrations')
    .getByRole('button', { name: /^Disposition reg-/ })
    .first();
  await expect(opener).toHaveText('Record conflict disposition');
  const ids = (await opener.getAttribute('aria-label'))!.replace('Disposition ', '').split(', ');
  expect(ids.length).toBeGreaterThanOrEqual(2);
  return { opener, ids };
}

test('VAL-ACT-017: required registration decisions are session projections from both entry points', async ({
  page,
}) => {
  const audit = observe(page);
  await boot(page);
  await navigate(page, 'Action Center');
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  await expect(page.getByText(EMPTY_COUNTS, { exact: true })).toBeVisible();
  await expect(page.getByLabel(ACTOR_LABEL, { exact: true })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Registration SLA', exact: true }).check();
  const row = page.getByTestId('action-item').first();
  await expect(row).toContainText('Registration SLA');
  const queueBefore = await row.innerText();
  const opener = row.getByRole('button', { name: 'Record registration decision', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Registration decision', exact: true });
  const id = (await dialog.innerText()).match(/\breg-[\w-]+\b/)?.[0];
  expect(id).toBeTruthy();
  await invalidBlankSubmission(dialog, ['approved', 'rejected']);
  await expect(records(page).getByRole('listitem')).toHaveCount(0);
  await saveOutcome(page, dialog, 'registration', [id!], 'approved');
  await expect(opener).toBeFocused();
  await expect(row).toHaveText(queueBefore);
  await expect(
    page.getByText(/Registration decisions: 1 · Conflict dispositions: 0/),
  ).toBeVisible();

  await navigate(page, 'Deal Reg Ops');
  const queue = card(page, 'Registrations awaiting review');
  await expect(queue.getByText('Showing 10 of 18 pending', { exact: true })).toBeVisible();
  const sourceBefore = await queue.innerText();
  const pending = await pendingRegistration(page);
  await pending.opener.click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Registration decision', exact: true }),
    'registration',
    [pending.id],
    'rejected',
  );
  await expect(pending.opener).toBeFocused();
  await expect(queue).toHaveText(sourceBefore);
  await expect(records(page).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByText('Pending past SLA', { exact: true }).locator('..')).toContainText(
    '14',
  );
  await audit();
});

test('VAL-ACT-017: a validated conflict disposition records every contender without changing claims', async ({
  page,
}) => {
  const audit = observe(page);
  await boot(page);
  await navigate(page, 'Deal Reg Ops');
  const duplicates = card(page, 'Duplicate & conflicting registrations');
  await expect(
    duplicates.getByText(/12 clients registered by more than one partner/),
  ).toBeVisible();
  const sourceBefore = await duplicates.innerText();
  const target = await conflictTarget(page);
  await target.opener.click();
  const dialog = page.getByRole('dialog', { name: 'Partner-conflict disposition', exact: true });
  await invalidBlankSubmission(dialog, ['uphold-first', 'share-credit', 'escalate']);
  await saveOutcome(page, dialog, 'conflict', target.ids, 'share-credit');
  await expect(target.opener).toBeFocused();
  await expect(duplicates).toHaveText(sourceBefore);
  await expect(
    page.getByText('Registration decisions: 0 · Conflict dispositions: 1 · Forecast reviews: 0'),
  ).toBeVisible();
  await audit();
});

test('VAL-ACT-018 VAL-ACT-019: all workflow, policy, notification and forecast effects stay private and reload away', async ({
  page,
}) => {
  const audit = observe(page);
  await boot(page);
  await navigate(page, 'Action Center');
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  await page.getByLabel('Stale days (calendar)').fill('1');
  await page.getByRole('button', { name: 'Apply demo policy', exact: true }).click();
  await expect(page.getByText('85 unique items', { exact: true })).toHaveCount(0);
  const action = page.getByTestId('action-item').first();
  const actionId = await action.getAttribute('data-action-id');
  await action.getByRole('button', { name: 'Notify owner', exact: true }).click();
  const composer = page.getByRole('region', { name: `Notification for ${actionId}` });
  await composer.getByLabel('Subject', { exact: true }).fill(PRIVACY_SENTINEL);
  await composer.getByLabel('Message', { exact: true }).fill(PRIVACY_SENTINEL);
  for (const checkbox of await composer.getByRole('checkbox').all()) await checkbox.uncheck();
  await composer.getByRole('checkbox', { name: 'Use Email', exact: true }).check();
  await composer.getByRole('button', { name: /Send to/ }).click();
  await expect(composer.getByText(/^Simulated \/ local only ·/)).toBeVisible();
  await action.getByRole('button', { name: 'Close notification', exact: true }).click();

  await navigate(page, 'Deal Reg Ops');
  const pending = await pendingRegistration(page);
  await pending.opener.click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Registration decision', exact: true }),
    'registration',
    [pending.id],
    'approved',
  );
  const conflict = await conflictTarget(page);
  await conflict.opener.click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Partner-conflict disposition', exact: true }),
    'conflict',
    conflict.ids,
    'escalate',
  );

  await navigate(page, 'Forecasting');
  const pipeline = metric(page, 'Partner sourced pipeline');
  const weighted = metric(page, 'Weighted forecast');
  await expect(pipeline).toContainText('$');
  const originalPipeline = await pipeline.innerText();
  const originalWeighted = await weighted.innerText();
  const edited = await editRevenue(page);
  await expect(pipeline).not.toHaveText(originalPipeline);
  await expect(changes(page).getByRole('listitem')).toHaveCount(1);
  await expect(changes(page).getByRole('listitem').first()).toContainText('change-1');
  await edited.row.getByRole('button', { name: /^Edit forecast category for / }).click();
  const category = edited.row.getByRole('combobox', { name: /^Forecast category for / });
  const nextCategory = (await category.inputValue()) === 'commit' ? 'long-shot' : 'commit';
  await category.selectOption(nextCategory);
  await expect(changes(page).getByRole('listitem')).toHaveCount(2);
  await expect(changes(page).getByRole('listitem').first()).toContainText(
    `change-2 · ${edited.id} · category: ${nextCategory}`,
  );
  const editedPipeline = await pipeline.innerText();
  const editedWeighted = await weighted.innerText();
  const review = page.getByRole('button', { name: 'Review change-1', exact: true });
  await review.click();
  const dialog = page.getByRole('dialog', { name: 'Forecast-change review', exact: true });
  await invalidBlankSubmission(dialog, ['accepted', 'needs-revision']);
  await saveOutcome(
    page,
    dialog,
    'forecast',
    [edited.id],
    'accepted',
    PRIVACY_SENTINEL,
    'change-1',
  );
  await expect(review).toBeFocused();
  await page.getByRole('button', { name: 'Review change-2', exact: true }).click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Forecast-change review', exact: true }),
    'forecast',
    [edited.id],
    'needs-revision',
    PRIVACY_SENTINEL,
    'change-2',
  );
  await expect(pipeline).toHaveText(editedPipeline);
  await expect(weighted).toHaveText(editedWeighted);
  await expect(
    page.getByText('Registration decisions: 1 · Conflict dispositions: 1 · Forecast reviews: 2'),
  ).toBeVisible();
  const workflows = card(page, 'Session workflows');
  await expect(workflows).toContainText('Session-only · simulated/local-only');
  await expect(workflows).toContainText('Selected demo actor is not authenticated');
  await expect(workflows).toContainText('Refresh loses these records');
  await expect(workflows).toContainText('No approver enforcement, delivery or write-back');
  await expect(workflows).toContainText('Source queues, metrics and fixtures stay unchanged');
  await expect(workflows).toContainText(
    'Current-session forecast edits, not source history or manager/partner trends',
  );
  await navigate(page, 'Data Connections');
  await expect(page.getByText('Sent this session · 1', { exact: true })).toBeVisible();
  await expect(page.getByText(PRIVACY_SENTINEL, { exact: true }).first()).toBeVisible();
  await audit();

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Partner Performance Overview' })).toBeVisible();
  await isolateWorkflowStorage(page);
  await navigate(page, 'Action Center');
  await expect(page.getByLabel('Stale days (calendar)')).toHaveValue('14');
  await expect(page.getByLabel('High value (USD)')).toHaveValue('400000');
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  await expect(page.getByText(EMPTY_COUNTS, { exact: true })).toBeVisible();
  await expect(records(page).getByRole('listitem')).toHaveCount(0);
  await expect(changes(page).getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText(PRIVACY_SENTINEL)).toHaveCount(0);
  await navigate(page, 'Deal Reg Ops');
  await expect(card(page, 'Registrations awaiting review')).toContainText(
    'Showing 10 of 18 pending',
  );
  await expect(card(page, 'Duplicate & conflicting registrations')).toContainText(
    '12 clients registered by more than one partner',
  );
  await navigate(page, 'Forecasting');
  await expect(pipeline).toHaveText(originalPipeline);
  await expect(weighted).toHaveText(originalWeighted);
  await expect(page.getByText('$987,654,321', { exact: true })).toHaveCount(0);
  await navigate(page, 'Data Connections');
  await expect(page.getByText('Sent this session · 0', { exact: true })).toBeVisible();
  await expect(page.getByText(PRIVACY_SENTINEL)).toHaveCount(0);
  await audit();
});

test('VAL-CROSS-005: mobile native workflows trap focus, guard dirty dismissal and restore the opener', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = observe(page);
  await boot(page);
  await navigate(page, 'Deal Reg Ops');
  const pending = await pendingRegistration(page);
  await pending.opener.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Registration decision', exact: true });
  await expect(
    dialog.getByRole('heading', { name: 'Registration decision', exact: true }),
  ).toBeFocused();
  await expect(dialog.getByLabel(ACTOR_LABEL)).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches('dialog:modal'))).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  const actor = dialog.getByLabel(ACTOR_LABEL, { exact: true });
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await actor.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(actor).toBeFocused();
  // A native modal makes even programmatic background focus ineffective.
  await page.getByLabel('Data provider').evaluate((element: HTMLSelectElement) => element.focus());
  await expect(actor).toBeFocused();
  await actor.selectOption('user-01');
  await dialog.getByLabel('Reason', { exact: true }).fill(PRIVACY_SENTINEL);
  await cancel.click();
  const discard = page.getByRole('dialog', { name: 'Discard unsaved workflow?', exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(dialog.getByLabel('Reason', { exact: true })).toHaveValue(PRIVACY_SENTINEL);
  await page.keyboard.press('Escape');
  await expect(discard).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel(ACTOR_LABEL)).toHaveValue('user-01');
  await page.keyboard.press('Escape');
  await discard.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(pending.opener).toBeFocused();
  await expect(records(page).getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText(EMPTY_COUNTS, { exact: true })).toBeVisible();
  await pending.opener.click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Registration decision', exact: true }),
    'registration',
    [pending.id],
    'approved',
  );
  await expect(pending.opener).toBeFocused();
  await audit();
});

test('VAL-CROSS-002: committed provider changes clear workflow history and forecast edits together', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const audit = observe(page);
  // An explicitly empty named plan disables random failures without causing
  // an expected console error; provider readiness and real commits still run.
  await boot(page, '?remoteFailMethods=');
  await navigate(page, 'Deal Reg Ops');
  const pending = await pendingRegistration(page);
  await pending.opener.click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Registration decision', exact: true }),
    'registration',
    [pending.id],
    'approved',
  );
  const conflict = await conflictTarget(page);
  await conflict.opener.click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Partner-conflict disposition', exact: true }),
    'conflict',
    conflict.ids,
    'uphold-first',
  );
  await navigate(page, 'Forecasting');
  const pipeline = metric(page, 'Partner sourced pipeline');
  await expect(pipeline).toContainText('$');
  const originalPipeline = await pipeline.innerText();
  const edited = await editRevenue(page);
  await page.getByRole('button', { name: 'Review change-1', exact: true }).click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Forecast-change review', exact: true }),
    'forecast',
    [edited.id],
    'accepted',
    PRIVACY_SENTINEL,
    'change-1',
  );
  await expect(records(page).getByRole('listitem')).toHaveCount(3);
  await expect(pipeline).not.toHaveText(originalPipeline);
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();
  await expect(pipeline).toHaveText(originalPipeline);
  await expect(page.getByText(EMPTY_COUNTS, { exact: true })).toBeVisible();
  await expect(records(page).getByRole('listitem')).toHaveCount(0);
  await expect(changes(page).getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('$987,654,321', { exact: true })).toHaveCount(0);
  await expect(page.getByText(PRIVACY_SENTINEL)).toHaveCount(0);

  const remoteEdit = await editRevenue(page, '123456789');
  await expect(changes(page).getByRole('listitem').first()).toContainText('change-1');
  await page.getByRole('button', { name: 'Review change-1', exact: true }).click();
  await saveOutcome(
    page,
    page.getByRole('dialog', { name: 'Forecast-change review', exact: true }),
    'forecast',
    [remoteEdit.id],
    'needs-revision',
    PRIVACY_SENTINEL,
    'change-1',
  );
  await page.getByLabel('Data provider').selectOption('local');
  await expect(page.getByLabel('Data provider')).toHaveValue('local');
  await expect(pipeline).toHaveText(originalPipeline);
  await expect(page.getByText(EMPTY_COUNTS, { exact: true })).toBeVisible();
  await expect(records(page).getByRole('listitem')).toHaveCount(0);
  await expect(changes(page).getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('$123,456,789', { exact: true })).toHaveCount(0);
  await audit();
});
