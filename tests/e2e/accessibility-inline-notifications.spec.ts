import { writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { INTERNAL_DEMO_SCOPE } from '../../src/data/accessScope';
import { ACTION_CATEGORIES, ACTION_CATEGORY_LABELS } from '../../src/data/actionCenter';
import { NOTIFICATION_CHANNEL_META } from '../../src/data/constants';
import { MockDataProvider } from '../../src/data/mock/MockDataProvider';
import type { ActionItem } from '../../src/data/types';
import { DEFAULT_ACTION_POLICY } from '../../src/lib/actionPolicy';
import { actionEvidence } from '../../src/lib/actionEvidence';
import { NOTIFICATION_TEMPLATES } from '../../src/lib/notifications';
import { activate, noOverflow, reachable, settle } from './support/accessibility-surfaces';

// Closed inventory: INLINE-NOTIFY-ACTION / INLINE-NOTIFY-CONNECTIONS in
// library/accessibility-modal-inventory.md. These are route/form/feedback
// states, NEVER composition or confirmation dialogs. Ordinary ready states
// use the real production entry. Only unreachable deterministic branches use
// an independently built App/provider fixture, fulfilled as static GET assets
// on the approved preview origin (no extra server, source selector or sender).
test.describe.configure({ mode: 'parallel' });
test.use({ hasTouch: true });
test.beforeEach(() => test.setTimeout(180_000));
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
] as const;
const FIXTURE_PREFIX = '/__inline-notification-fixture__/';
const FIXTURE_ENTRY = 'tests/fixtures/inline-notifications/index.html';
const TIME = new Date('2026-10-01T12:34:56.000Z');
type FixtureMethod = Parameters<Window['inlineNotificationFixture']['arm']>[0];
const fixtureDir = process.env.E2E_INLINE_FIXTURE_DIR;
let actions: ActionItem[];

test.beforeAll(async () => {
  if (!fixtureDir) throw new Error('Run through npm run test:e2e to prepare immutable fixtures');
  const provider = new MockDataProvider();
  actions = [];
  let cursor: string | undefined;
  do {
    const { data } = await provider.listActionItems(
      INTERNAL_DEMO_SCOPE,
      { policy: DEFAULT_ACTION_POLICY },
      { limit: 25, cursor },
    );
    actions.push(...data.rows);
    cursor = data.nextCursor ?? undefined;
  } while (cursor);
});

async function evidence(info: TestInfo, name: string, value: unknown) {
  // File-backed artifacts survive the ordinary list reporter, including
  // passing states; attach-only in-memory bodies otherwise disappear.
  const path = info.outputPath(`${name.replace(/[^\w.-]/g, '-')}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

function monitor(page: Page) {
  const errors: string[] = [];
  const requests: { url: string; method: string }[] = [];
  const sockets: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  return async (info: TestInfo) => {
    await evidence(info, 'inline-network-console-page-errors', { errors, requests, sockets });
    expect(errors).toEqual([]);
    expect(sockets).toEqual([]);
    expect(requests.length).toBeGreaterThan(0);
    expect(
      requests.every(
        ({ url, method }) => new URL(url).origin === new URL(page.url()).origin && method === 'GET',
      ),
    ).toBe(true);
    expect(requests.some(({ url }) => /@vite|hot-update|@react-refresh|\/src\//.test(url))).toBe(
      false,
    );
    expect(requests.some(({ url }) => /\/assets\/.*-[\w-]+\.js/.test(url))).toBe(true);
  };
}

async function route(page: Page, name: 'Action Center' | 'Settings') {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  if (!(await nav.isVisible())) {
    await activate(
      page.getByRole('button', { name: 'Open navigation menu', exact: true }),
      'Enter',
    );
  }
  await activate(nav.getByRole('button', { name, exact: true }), 'Enter');
  await expect(page.getByRole('heading', { name, level: 1, exact: true })).toBeFocused();
}

async function fixture(page: Page, scenario = '') {
  await page.route(`**${FIXTURE_PREFIX}**`, async (request) => {
    const relativePath = new URL(request.request().url()).pathname.slice(FIXTURE_PREFIX.length);
    const asset = resolve(fixtureDir!, relativePath);
    if (!asset.startsWith(`${fixtureDir}${sep}`)) throw new Error('Fixture path escaped output');
    await request.fulfill({ path: asset });
  });
  await page.goto(`${FIXTURE_PREFIX}${FIXTURE_ENTRY}?scenario=${scenario}`);
  await settle(page);
}

async function checkpoint(page: Page, info: TestInfo, name: string, panel?: Locator) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  if (panel) {
    await expect(panel).toBeVisible();
    expect(
      await panel.evaluate((element) => element.closest('[inert], [aria-hidden="true"]') === null),
    ).toBe(true);
  }
  const result = await new AxeBuilder({ page }).analyze();
  await evidence(info, `axe-${name}`, {
    state: name,
    invocation: name.startsWith('action-') ? 'INLINE-NOTIFY-ACTION' : 'INLINE-NOTIFY-CONNECTIONS',
    url: page.url(),
    viewport: page.viewportSize(),
    title: await page.title(),
    dialogCount: await page.getByRole('dialog').count(),
    violations: result.violations,
  });
  // Preserve exhaustive evidence even when an unrelated state check fails.
  expect.soft(result.violations, name).toEqual([]);
  await noOverflow(page);
}

async function keyboardSelect(control: Locator, value: string) {
  await control.focus();
  // Controlled selects can initially hold an alert ID outside the bounded
  // picker. End then Home deliberately commits an actual option change.
  await control.page().keyboard.press('End');
  await control.page().keyboard.press('Home');
  const count = await control.locator('option').count();
  for (let index = 0; index < count && (await control.inputValue()) !== value; index += 1) {
    await control.page().keyboard.press('ArrowDown');
  }
  await expect(control).toHaveValue(value);
  await expect(control).toBeFocused();
}

async function type(control: Locator, value: string) {
  await control.focus();
  await control.page().keyboard.press('ControlOrMeta+A');
  await control.page().keyboard.insertText(value);
}

async function linkedError(control: Locator, text: string) {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const ids = (await control.getAttribute('aria-describedby'))?.split(/\s+/) ?? [];
  expect(ids.length).toBeGreaterThan(0);
  const messages = await Promise.all(
    ids.map((id) => control.page().locator(`[id="${id}"]`).innerText()),
  );
  expect(messages).toContain(text);
  await expect(control.page().getByText(text, { exact: true }).first()).toBeVisible();
}

async function corrected(control: Locator, previous: string | null) {
  await expect(control).not.toHaveAttribute('aria-invalid', 'true');
  if (previous) await expect(control).not.toHaveAttribute('aria-describedby', previous);
}

function composer(page: Page) {
  return page.getByRole('group', { name: 'The notification composer', exact: true });
}

function queue(page: Page) {
  return page.getByRole('group', { name: 'The SLA alert queue', exact: true });
}

function roster(page: Page) {
  return page.getByRole('group', { name: 'The team roster', exact: true });
}

async function send(panel: Locator) {
  const button = panel.getByRole('button', { name: /^Send to / });
  await button.scrollIntoViewIfNeeded();
  await reachable(button);
  await activate(button, 'Enter');
}

async function validation(page: Page, panel: Locator, info: TestInfo, prefix: string) {
  const subject = panel.getByLabel('Subject', { exact: true });
  const body = panel.getByLabel('Message', { exact: true });
  const feedback = panel.getByText(/Simulated \/ local only · \d/);
  const previousFeedback = await feedback.allTextContents();
  await type(subject, '   ');
  await type(body, '   ');
  await send(panel);
  await expect(subject).toBeFocused();
  await linkedError(subject, 'A subject is required.');
  await linkedError(body, 'A message is required.');
  expect(await feedback.allTextContents()).toEqual(previousFeedback);
  const subjectError = await subject.getAttribute('aria-describedby');
  const bodyError = await body.getAttribute('aria-describedby');
  await checkpoint(page, info, `${prefix}-invalid-subject-and-body`, panel);
  await type(subject, '  Session-only accessibility note  ');
  await corrected(subject, subjectError);
  await linkedError(body, 'A message is required.');
  await send(panel);
  await expect(body).toBeFocused();
  await checkpoint(page, info, `${prefix}-subject-corrected-body-invalid`, panel);
  await type(body, '  Simulated local-only message.  ');
  await corrected(body, bodyError);
  await checkpoint(page, info, `${prefix}-subject-body-corrected`, panel);
  await subject.focus();
  await page.keyboard.press('Tab');
  await expect(body).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(subject).toBeFocused();
  const channels = panel.getByRole('checkbox');
  const labels = await channels.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('aria-label')!),
  );
  expect(labels.length).toBeGreaterThan(0);
  for (const checkbox of await channels.all()) {
    if (await checkbox.isChecked()) await activate(checkbox, 'Space');
  }
  await send(panel);
  await expect(channels.first()).toBeFocused();
  await linkedError(channels.first(), 'Select at least one configured channel.');
  expect(await feedback.allTextContents()).toEqual(previousFeedback);
  const channelError = await channels.first().getAttribute('aria-describedby');
  await checkpoint(page, info, `${prefix}-invalid-no-selected-channel`, panel);
  for (const [index, label] of labels.entries()) {
    if (index > 0) await activate(channels.nth(index - 1), 'Space');
    await activate(channels.nth(index), 'Space');
    await corrected(channels.first(), channelError);
    await checkpoint(page, info, `${prefix}-corrected-only-${label}`, panel);
    await send(panel);
    const channel = Object.entries(NOTIFICATION_CHANNEL_META).find(
      ([, meta]) => `Use ${meta.label}` === label,
    )?.[0];
    expect(channel).toBeTruthy();
    await expect(
      panel.getByText(`Simulated / local only · 12:34 · ${channel}`, { exact: true }),
    ).toBeVisible();
    await checkpoint(page, info, `${prefix}-local-feedback-only-${label}`, panel);
  }
  for (const checkbox of await channels.all()) {
    if (!(await checkbox.isChecked())) await activate(checkbox, 'Space');
  }
  await send(panel);
  await expect(panel.getByText(/Simulated \/ local only · 12:34 ·/)).toBeVisible();
  await checkpoint(page, info, `${prefix}-all-configured-channels-feedback`, panel);
  for (const control of await panel.locator('input, textarea, select, button').all()) {
    if (await control.isEnabled()) await reachable(control);
  }
  // Inline composition must not trap focus or make the surrounding route inert.
  const provider = page.getByLabel('Data provider');
  await provider.focus();
  await expect(provider).toBeFocused();
  await subject.focus();
  await page.keyboard.press('Escape');
  await expect(subject).toBeFocused();
  await expect(subject).toHaveValue('  Session-only accessibility note  ');
}

async function allActions(page: Page) {
  await expect(page.getByTestId('action-item')).toHaveCount(25);
  for (let loaded = 25; loaded < actions.length; loaded += 25) {
    await activate(page.getByRole('button', { name: 'Load 25 more', exact: true }), 'Enter');
    await expect(page.getByTestId('action-item')).toHaveCount(
      Math.min(loaded + 25, actions.length),
    );
  }
  await expect(page.getByTestId('action-item')).toHaveCount(actions.length);
}

async function filterAction(page: Page, item: ActionItem, category: string) {
  // Exercise ordinary scoped route filters, not an axe exclusion: the full
  // route is audited, with only the relevant owner's bounded actions loaded.
  await activate(page.getByRole('button', { name: 'Clear filters', exact: true }), 'Enter');
  await type(page.getByLabel('Owner ID', { exact: true }), item.owner!.userId!);
  await activate(page.getByRole('checkbox', { name: category, exact: true }), 'Space');
  await settle(page);
  await expect(page.locator(`[data-action-id="${item.id}"]`)).toBeVisible();
}

function categoryAction(category: ActionItem['reasons'][number]['category']) {
  const item = actions.find(
    (candidate) =>
      candidate.owner?.userId && candidate.reasons.some((reason) => reason.category === category),
  );
  if (!item) throw new Error(`No seeded routed action for ${category}`);
  return item;
}

async function openAction(page: Page, item: ActionItem) {
  const row = page.locator(`[data-action-id="${item.id}"]`);
  const trigger = row.getByRole('button', {
    name: /^(Notify owner|Close notification)$/,
    exact: true,
  });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toHaveAttribute('aria-controls', `notification-${item.id}`);
  await expect(
    row.getByRole('region', { name: `Notification for ${item.id}`, exact: true }),
  ).toHaveCount(0);
  await activate(trigger, 'Enter');
  const panel = row.getByRole('region', { name: `Notification for ${item.id}`, exact: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel.getByLabel('Subject')).toBeFocused();
  await expect(panel.getByLabel('To', { exact: true })).toBeDisabled();
  await expect(panel.getByLabel('To', { exact: true })).toHaveValue(item.owner!.userId!);
  return { row, trigger, panel };
}

async function closeAction(
  page: Page,
  info: TestInfo,
  item: ActionItem,
  row: Locator,
  prefix: string,
) {
  const close = row.getByRole('button', {
    name: /^(Notify owner|Close notification)$/,
    exact: true,
  });
  await activate(close, 'Enter');
  await expect(close).toBeFocused();
  await expect(close).toHaveAttribute('aria-expanded', 'false');
  await expect(
    row.getByRole('region', { name: `Notification for ${item.id}`, exact: true }),
  ).toHaveCount(0);
  expect(await row.ariaSnapshot()).not.toContain(`Notification for ${item.id}`);
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(close).toBeFocused();
  await checkpoint(page, info, `${prefix}-closed-removed-from-tree`);
  // The same existing disclosure also works with touch and closes sensibly.
  await activate(close, 'touch');
  await expect(row.getByLabel('Subject')).toBeFocused();
  await activate(close, 'touch');
  await expect(close).toBeFocused();
}

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`VAL-A11Y-009 VAL-A11Y-004 VAL-A11Y-012 VAL-A11Y-013 VAL-ACT-016: INLINE-NOTIFY-ACTION five categories and every merged reason/template variant ${size}`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const check = monitor(page);
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(TIME);
    await page.goto('/');
    await route(page, 'Action Center');
    await settle(page);
    await allActions(page);
    const storage = await page.evaluate(() => [
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]);
    await checkpoint(page, info, `action-${size}-closed-route`);
    const selected = ACTION_CATEGORIES.map((category) => {
      return { category, item: categoryAction(category) };
    });
    let sent = 0;
    for (const { category, item } of selected) {
      await filterAction(page, item, ACTION_CATEGORY_LABELS[category]);
      const { row, panel } = await openAction(page, item);
      await keyboardSelect(panel.getByLabel('Template'), category);
      await expect(panel.getByLabel('Subject')).toHaveValue(
        `${ACTION_CATEGORY_LABELS[category]}: ${item.entityId}`,
      );
      await expect(panel.getByLabel('Message')).toHaveValue(new RegExp(item.id));
      await expect(panel).toContainText(
        'Only selected configured channels are used. Records are session-only. Refresh clears them.',
      );
      await expect(panel).toContainText('Simulated / local only — nothing is delivered.');
      await checkpoint(page, info, `action-${category}-${size}-ready-prefilled`, panel);
      sent += (await panel.getByRole('checkbox').count()) + 1;
      await validation(page, panel, info, `action-${category}-${size}`);
      await closeAction(page, info, item, row, `action-${category}-${size}`);
    }
    // Every distinct seeded merged reason set, and EVERY offered reason in
    // each set, rather than sampling one two-reason item.
    const variants = new Map<string, ActionItem>();
    for (const item of actions.filter(
      (candidate) => candidate.owner?.userId && candidate.reasons.length > 1,
    )) {
      const variant = item.reasons
        .map((reason) => reason.category)
        .sort()
        .join('+');
      if (!variants.has(variant)) variants.set(variant, item);
    }
    expect(variants.size).toBeGreaterThan(0);
    for (const [variant, item] of variants) {
      await filterAction(page, item, ACTION_CATEGORY_LABELS[item.reasons[0].category]);
      const { row, panel } = await openAction(page, item);
      await expect(panel.getByLabel('Template').locator('option')).toHaveText(
        item.reasons.map((reason) => ACTION_CATEGORY_LABELS[reason.category]),
      );
      for (const reason of item.reasons) {
        await keyboardSelect(panel.getByLabel('Template'), reason.category);
        await expect(panel.getByLabel('Subject')).toHaveValue(
          `${ACTION_CATEGORY_LABELS[reason.category]}: ${item.entityId}`,
        );
        const body = await panel.getByLabel('Message').inputValue();
        expect(body).toContain(actionEvidence(reason));
        expect(body).toContain(`Recommended action: ${reason.recommendedAction}`);
        expect(body).toContain(`Entity: ${item.id}`);
        await checkpoint(page, info, `action-merged-${variant}-${reason.category}-${size}`, panel);
      }
      await closeAction(page, info, item, row, `action-merged-${variant}-${size}`);
    }
    await evidence(info, 'INLINE-NOTIFY-ACTION-category-and-merged-inventory', {
      viewport,
      categories: selected.map(({ category, item }) => ({ category, id: item.id })),
      merged: [...variants].map(([variant, item]) => ({ variant, id: item.id })),
    });
    await route(page, 'Settings');
    await settle(page);
    await expect(
      queue(page).getByText(`Sent this session · ${sent}`, { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => [Object.entries(localStorage), Object.entries(sessionStorage)]),
    ).toEqual(storage);
    await checkpoint(page, info, `action-records-in-settings-log-${size}`);
    await page.reload();
    await route(page, 'Settings');
    await settle(page);
    await expect(queue(page).getByText('Sent this session · 0', { exact: true })).toBeVisible();
    await checkpoint(page, info, `action-feedback-cleared-on-reload-${size}`);
    await check(info);
  });

  test(`VAL-A11Y-009 VAL-A11Y-004 VAL-A11Y-012 VAL-A11Y-013 VAL-ACT-016: INLINE-NOTIFY-CONNECTIONS every template, registration, map recipient and configured channel ${size}`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const check = monitor(page);
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(TIME);
    await page.goto('/');
    await route(page, 'Settings');
    await settle(page);
    const panel = composer(page);
    const storage = await page.evaluate(() => [
      Object.entries(localStorage),
      Object.entries(sessionStorage),
    ]);
    await expect(panel.getByLabel('Subject')).toHaveValue(/Deal reg due next business day:/);
    await expect(panel.getByLabel('Message')).toHaveValue(/5-business-day response SLA/);
    await expect(panel.getByText(/On the SLA clock:/)).toBeVisible();
    await checkpoint(page, info, `connections-${size}-alert-prefilled`, panel);
    // The composer's own recipient picker is the roster surface now that the
    // connection map no longer carries teammate chips. Every offered
    // recipient's configured channel set is pinned.
    const recipients = await panel
      .getByLabel('To', { exact: true })
      .locator('option:not([disabled])')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          id: (element as HTMLOptionElement).value,
          name: element.textContent!.split(' · ')[0],
        })),
      );
    for (const recipient of recipients) {
      await keyboardSelect(panel.getByLabel('To', { exact: true }), recipient.id);
      await expect(panel.getByLabel('To', { exact: true })).toHaveValue(recipient.id);
      expect(await panel.getByRole('checkbox').count()).toBeGreaterThan(0);
      for (const channel of await panel.getByRole('checkbox').all()) {
        await expect(channel).toBeChecked();
        await reachable(channel);
      }
      await checkpoint(page, info, `connections-recipient-${recipient.name}-${size}`, panel);
    }
    expect(recipients.length).toBeGreaterThan(0);
    await keyboardSelect(panel.getByLabel('To', { exact: true }), recipients[0].id);
    await expect(panel.getByLabel('Template').locator('option')).toHaveText(
      NOTIFICATION_TEMPLATES.map((template) => template.label),
    );
    const registrations = await panel
      .getByLabel('Registration', { exact: true })
      .locator('option:not([disabled])')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          id: (element as HTMLOptionElement).value,
          label: element.textContent!,
        })),
      );
    expect(registrations.length).toBeGreaterThan(0);
    for (const template of NOTIFICATION_TEMPLATES) {
      await keyboardSelect(panel.getByLabel('Template'), template.id);
      await expect(panel.getByText(template.description, { exact: true })).toBeVisible();
      if (template.id === 'custom') {
        await expect(panel.getByLabel('Registration')).toBeDisabled();
        await expect(panel.getByLabel('Subject')).toHaveValue('');
        await expect(panel.getByLabel('Message')).toHaveValue('');
        await checkpoint(page, info, `connections-custom-blank-${size}`, panel);
        await validation(page, panel, info, `connections-custom-${size}`);
      } else {
        await expect(panel.getByLabel('Registration')).toBeEnabled();
        for (const registration of registrations) {
          await keyboardSelect(panel.getByLabel('Registration'), registration.id);
          await expect(panel.getByLabel('Subject')).not.toHaveValue('');
          await expect(panel.getByLabel('Message')).not.toHaveValue('');
          await checkpoint(
            page,
            info,
            `connections-${template.id}-${registration.id}-${size}`,
            panel,
          );
        }
        await send(panel);
        await expect(panel.getByText(/Simulated \/ local only · 12:34 ·/)).toBeVisible();
        await checkpoint(page, info, `connections-${template.id}-single-feedback-${size}`, panel);
      }
    }
    // Custom text survives teammate changes; channels reset to the new
    // recipient's configured set, never an earlier recipient's selection.
    await keyboardSelect(panel.getByLabel('Template'), 'custom');
    await type(panel.getByLabel('Subject'), 'Custom session note');
    await type(panel.getByLabel('Message'), 'Local-only custom message');
    for (const recipient of recipients) {
      await keyboardSelect(panel.getByLabel('To', { exact: true }), recipient.id);
      await expect(panel.getByLabel('Subject')).toHaveValue('Custom session note');
      for (const channel of await panel.getByRole('checkbox').all())
        await expect(channel).toBeChecked();
      await send(panel);
      await checkpoint(page, info, `connections-custom-${recipient.id}-feedback-${size}`, panel);
    }
    await evidence(info, 'INLINE-NOTIFY-CONNECTIONS-offered-inventory', {
      viewport,
      recipients,
      registrations,
      templates: NOTIFICATION_TEMPLATES,
    });
    expect(
      await page.evaluate(() => [Object.entries(localStorage), Object.entries(sessionStorage)]),
    ).toEqual(storage);
    await page.reload();
    await route(page, 'Settings');
    await settle(page);
    await expect(queue(page).getByText('Sent this session · 0', { exact: true })).toBeVisible();
    await checkpoint(page, info, `connections-${size}-feedback-lost-on-refresh`);
    await check(info);
  });

  test(`VAL-A11Y-009 VAL-A11Y-013 VAL-ACT-016: INLINE-NOTIFY-CONNECTIONS every queue owner invocation and owner batch feedback ${size}`, async ({
    page,
  }, info) => {
    const check = monitor(page);
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(TIME);
    await page.goto('/');
    await route(page, 'Settings');
    await settle(page);
    const panel = composer(page);
    const rows = queue(page).locator('tbody tr');
    let count = 0;
    const states = new Set<string>();
    for (const row of await rows.all()) {
      const owner = (await row.locator('td').nth(1).innerText()).trim();
      const action = row.getByRole('button', { name: 'Notify owner', exact: true });
      const clock = await row.locator('td').nth(4).innerText();
      states.add(clock.includes('to SLA') ? 'approaching' : 'breached');
      if (owner === 'No owner — add one') {
        await expect(action).toBeDisabled();
        continue;
      }
      await reachable(action);
      await activate(action, 'Enter');
      await expect(
        panel.getByRole('button', { name: `Send to ${owner}`, exact: true }),
      ).toBeEnabled();
      await expect(panel.getByLabel('Subject')).toHaveValue(
        clock.includes('to SLA') ? /due next business day:/ : /SLA lapsed:/,
      );
      await checkpoint(page, info, `connections-queue-row-${count}-${size}-prefilled`, panel);
      await send(panel);
      count += 1;
      await expect(
        queue(page).getByText(`Sent this session · ${count}`, { exact: true }),
      ).toBeVisible();
      await checkpoint(page, info, `connections-queue-row-${count}-${size}-local-record`, panel);
    }
    expect([...states].sort()).toEqual(['approaching', 'breached']);
    const batch = queue(page).getByRole('button', { name: /^Notify all \d+ owners$/ });
    const owners = Number((await batch.innerText()).match(/\d+/)![0]);
    expect(owners).toBe(count);
    await reachable(batch);
    await activate(batch, 'Enter');
    await expect(
      queue(page).getByText(`Sent this session · ${count + owners}`, { exact: true }),
    ).toBeVisible();
    await expect(queue(page)).toContainText(
      'Simulated / local only — recorded for this session, never delivered. Refresh clears them.',
    );
    await expect(queue(page).locator('ul li')).toHaveCount(Math.min(5, count + owners));
    await checkpoint(page, info, `connections-owner-batch-${size}-local-log`);
    await check(info);
  });

  for (const scenario of ['empty-roster', 'ineligible', 'missing-recipient', 'no-channels']) {
    test(`VAL-A11Y-009 VAL-ACT-016: both inline hosts ${scenario} recipient exclusion/unavailable state ${size}`, async ({
      page,
    }, info) => {
      const check = monitor(page);
      await page.setViewportSize(viewport);
      await fixture(page, scenario);
      await route(page, 'Action Center');
      await settle(page);
      for (const category of ACTION_CATEGORIES) {
        await activate(page.getByRole('button', { name: 'Clear filters', exact: true }), 'Enter');
        await activate(
          page.getByRole('checkbox', { name: ACTION_CATEGORY_LABELS[category], exact: true }),
          'Space',
        );
        await settle(page);
        const row = page.getByTestId('action-item').first();
        await expect(row).toContainText(ACTION_CATEGORY_LABELS[category]);
        const notify = row.getByRole('button', { name: 'Notify owner', exact: true });
        if (scenario === 'empty-roster' || scenario === 'ineligible') {
          await expect(notify).toBeDisabled();
          await expect(row).toContainText('Unowned — no eligible active demo recipient.');
        } else {
          await activate(notify, 'Enter');
          await expect(row).toContainText(
            'Unowned — no eligible active demo recipient. Owner notification is unavailable.',
          );
          await expect(row.getByLabel('Subject')).toHaveCount(0);
          await checkpoint(page, info, `action-${category}-${scenario}-${size}-open`);
          await activate(
            row.getByRole('button', { name: 'Close notification', exact: true }),
            'Enter',
          );
        }
        await checkpoint(page, info, `action-${category}-${scenario}-${size}-closed`);
      }
      await checkpoint(page, info, `action-${scenario}-${size}-closed`);
      await route(page, 'Settings');
      await settle(page);
      const panel = composer(page);
      if (scenario === 'no-channels') {
        await expect(panel.getByRole('checkbox')).toHaveCount(0);
        await send(panel);
        await expect(
          panel.getByText('Select at least one configured channel.', { exact: true }),
        ).toBeVisible();
        await expect(panel.locator('fieldset')).toHaveAttribute('aria-invalid', 'true');
      } else {
        await expect(panel.getByLabel('To').locator('option:not([disabled])')).toHaveCount(0);
        await expect(panel.getByRole('button', { name: /^Send to / })).toBeDisabled();
        await expect(panel.getByRole('checkbox')).toHaveCount(0);
        await expect(panel).toContainText(
          scenario === 'ineligible'
            ? 'Only a teammate with notifications on can be messaged.'
            : 'Add someone to the roster first.',
        );
      }
      if (scenario === 'empty-roster' || scenario === 'ineligible') {
        await expect(
          queue(page).getByRole('button', { name: 'Notify all 0 owners', exact: true }),
        ).toBeDisabled();
        for (const notify of await queue(page)
          .getByRole('button', { name: 'Notify owner', exact: true })
          .all())
          await expect(notify).toBeDisabled();
        await expect(queue(page)).toContainText('No owner — add one');
      }
      await expect(queue(page).getByText('Sent this session · 0', { exact: true })).toBeVisible();
      await checkpoint(page, info, `connections-${scenario}-${size}`, panel);
      await check(info);
    });
  }

  test(`VAL-A11Y-009 VAL-A11Y-004: INLINE-NOTIFY-ACTION roster loading, unavailable, focused Retry and partial recovery ${size}`, async ({
    page,
  }, info) => {
    const check = monitor(page);
    await page.setViewportSize(viewport);
    await fixture(page);
    await route(page, 'Action Center');
    await settle(page);
    for (const category of ACTION_CATEGORIES) {
      const item = categoryAction(category);
      const prefix = `action-roster-${category}-${size}`;
      await filterAction(page, item, ACTION_CATEGORY_LABELS[category]);
      const row = page.locator(`[data-action-id="${item.id}"]`);
      await page.evaluate(() => window.inlineNotificationFixture.arm('getTeamRoster', 'hold'));
      await activate(row.getByRole('button', { name: 'Notify owner', exact: true }), 'Enter');
      const panel = row.getByRole('region', { name: `Notification for ${item.id}`, exact: true });
      await expect(panel.getByRole('status')).toHaveText('Loading action notification roster');
      await expect(panel.getByLabel('Subject')).toHaveCount(0);
      await checkpoint(page, info, `${prefix}-loading`, panel);
      await page.evaluate(() => window.inlineNotificationFixture.release('getTeamRoster', true));
      await expect(
        panel.getByText('Failed to load the notification roster', { exact: false }),
      ).toBeVisible();
      await checkpoint(page, info, `${prefix}-unavailable`, panel);
      await page.evaluate(() => window.inlineNotificationFixture.arm('getTeamRoster', 'hold'));
      const retry = panel.getByRole('button', {
        name: 'Retry action notification roster',
        exact: true,
      });
      await activate(retry, 'Enter');
      // The query retains its named failure while Retry is in flight; it does
      // not invent a new loading-only rendering over the unavailable answer.
      await expect(retry).toBeFocused();
      await expect(panel).toContainText('Failed to load the notification roster');
      await checkpoint(page, info, `${prefix}-retry-in-flight`, panel);
      await page.evaluate(() => window.inlineNotificationFixture.release('getTeamRoster', true));
      await expect(retry).toBeVisible();
      await page.evaluate(() => window.inlineNotificationFixture.arm('getTeamRoster', 'partial'));
      const before = await page.evaluate(() => ({ ...window.inlineNotificationFixture.calls }));
      await activate(retry, 'Enter');
      const region = panel.getByRole('group', { name: 'action notification roster', exact: true });
      await expect(region).toBeFocused();
      await expect(region).toContainText('provider local · partial');
      await expect(region).toContainText('scoped rows remain usable');
      await expect(region.getByLabel('Subject')).toBeVisible();
      expect(await page.evaluate(() => window.inlineNotificationFixture.calls)).toEqual({
        ...before,
        getTeamRoster: (before.getTeamRoster ?? 0) + 1,
      });
      await checkpoint(page, info, `${prefix}-partial-recovered`, panel);
      await closeAction(page, info, item, row, prefix);
      // Reopening refreshes the on-demand roster from the provider; this is a
      // new loading answer, not an invented retained-refresh branch.
      await page.evaluate(() => window.inlineNotificationFixture.arm('getTeamRoster', 'hold'));
      await activate(row.getByRole('button', { name: 'Notify owner', exact: true }), 'Enter');
      await expect(panel.getByRole('status')).toBeVisible();
      await checkpoint(page, info, `${prefix}-reopened-refresh-loading`, panel);
      await page.evaluate(() => window.inlineNotificationFixture.release('getTeamRoster'));
      await expect(panel.getByLabel('Subject')).toBeFocused();
      await checkpoint(page, info, `${prefix}-reopened-refresh-ready`, panel);
      await closeAction(page, info, item, row, `${prefix}-refresh`);
    }
    await check(info);
  });

  const dependencies: { method: FixtureMethod; region: string; failure: string }[] = [
    {
      method: 'getTeamRoster',
      region: 'The notification composer',
      failure: 'Failed to load the notification roster',
    },
    {
      method: 'getPartnerRoster',
      region: 'The notification composer',
      failure: 'Failed to load the partner roster',
    },
    {
      method: 'listRecentRegistrations',
      region: 'The notification composer',
      failure: 'Failed to load the registration records',
    },
    {
      method: 'getRegistrationSlaAlerts',
      region: 'The SLA alert queue',
      failure: 'Failed to load the registration SLA alerts',
    },
    {
      method: 'getManagerDirectory',
      region: 'The team roster',
      failure: 'Failed to load the manager directory',
    },
  ];
  for (const dependency of dependencies) {
    test(`VAL-A11Y-009 VAL-A11Y-012: INLINE-NOTIFY-CONNECTIONS ${dependency.method} loading, unavailable, retry and recovery ${size}`, async ({
      page,
    }, info) => {
      const check = monitor(page);
      await page.setViewportSize(viewport);
      await fixture(page);
      await page.evaluate(
        (method) => window.inlineNotificationFixture.arm(method, 'hold'),
        dependency.method,
      );
      await route(page, 'Settings');
      const region = page.getByRole('group', { name: dependency.region, exact: true });
      await expect(region.getByRole('status')).toBeVisible();
      await checkpoint(page, info, `connections-${dependency.method}-${size}-loading`);
      await page.evaluate(
        (method) => window.inlineNotificationFixture.release(method, true),
        dependency.method,
      );
      await expect(region).toContainText(dependency.failure);
      await checkpoint(page, info, `connections-${dependency.method}-${size}-unavailable`);
      const before = await page.evaluate(() => ({ ...window.inlineNotificationFixture.calls }));
      await page.evaluate(
        (method) => window.inlineNotificationFixture.arm(method, 'hold'),
        dependency.method,
      );
      await activate(
        region.getByRole('button', { name: `Retry ${dependency.region}`, exact: true }),
        'Enter',
      );
      if (dependency.method === 'listRecentRegistrations') {
        await expect(region.getByRole('status')).toBeVisible();
      } else {
        await expect(region).toContainText(dependency.failure);
      }
      expect(await page.evaluate(() => window.inlineNotificationFixture.calls)).toEqual({
        ...before,
        [dependency.method]: (before[dependency.method] ?? 0) + 1,
      });
      await checkpoint(page, info, `connections-${dependency.method}-${size}-retry-in-flight`);
      await page.evaluate(
        (method) => window.inlineNotificationFixture.release(method),
        dependency.method,
      );
      await expect(region.getByRole('status')).toHaveCount(0);
      await expect(region).not.toContainText(dependency.failure);
      await expect(region).toBeFocused();
      await settle(page);
      expect(await page.evaluate(() => window.inlineNotificationFixture.calls)).toEqual({
        ...before,
        [dependency.method]: (before[dependency.method] ?? 0) + 1,
      });
      await checkpoint(page, info, `connections-${dependency.method}-${size}-recovered`);
      // Multi-query route regions render usable partial envelopes without
      // their own metadata caption. Pin the injected envelope technically,
      // and audit the resulting real route/form rather than fake its UI.
      await route(page, 'Action Center');
      await settle(page);
      await page.evaluate(
        (method) => window.inlineNotificationFixture.arm(method, 'partial'),
        dependency.method,
      );
      await route(page, 'Settings');
      await settle(page);
      expect(
        await page.evaluate(
          (method) => window.inlineNotificationFixture.completeness[method],
          dependency.method,
        ),
      ).toBe('partial');
      await evidence(info, `partial-envelope-${dependency.method}`, {
        method: dependency.method,
        completeness: 'partial',
        viewport,
      });
      await checkpoint(page, info, `connections-${dependency.method}-${size}-partial-usable`);
      await check(info);
    });
  }

  test(`VAL-A11Y-009 VAL-ACT-016: INLINE-NOTIFY-CONNECTIONS retained roster/SLA refreshing, failed refresh, independent retries and current-recipient fence ${size}`, async ({
    page,
  }, info) => {
    const check = monitor(page);
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(TIME);
    await fixture(page);
    await route(page, 'Settings');
    await settle(page);
    const alerts = queue(page);
    const owner = (
      await alerts.locator('tbody tr').first().locator('td').nth(1).innerText()
    ).trim();
    const teamRow = roster(page)
      .getByRole('row')
      .filter({ has: page.getByText(owner, { exact: true }) });
    await activate(
      alerts.locator('tbody tr').first().getByRole('button', { name: 'Notify owner', exact: true }),
      'Enter',
    );
    const subject = await composer(page).getByLabel('Subject').inputValue();
    const recipientId = await composer(page).getByLabel('To').inputValue();
    const initialOwners = await alerts.locator('tbody tr td:nth-child(2)').allTextContents();
    const expected = initialOwners.filter(
      (name) => name.trim() !== owner && name.trim() !== 'No owner — add one',
    ).length;
    await page.evaluate(() => {
      window.inlineNotificationFixture.arm('getTeamRoster', 'hold');
      window.inlineNotificationFixture.arm('getRegistrationSlaAlerts', 'hold');
    });
    await activate(
      teamRow.getByRole('button', { name: 'Pause notifications', exact: true }),
      'Enter',
    );
    await expect(composer(page).getByLabel('Subject')).toHaveValue(subject);
    await expect(
      composer(page).getByRole('button', { name: `Send to ${owner}`, exact: true }),
    ).toBeEnabled();
    await checkpoint(page, info, `connections-${size}-roster-and-sla-retained-refreshing`);
    await send(composer(page));
    await expect(alerts.getByText('Sent this session · 0', { exact: true })).toBeVisible();
    await checkpoint(page, info, `connections-${size}-pending-refresh-paused-save-blocked`);
    await page.evaluate(() => {
      window.inlineNotificationFixture.release('getTeamRoster', true);
      window.inlineNotificationFixture.release('getRegistrationSlaAlerts', true);
    });
    await expect(composer(page)).toContainText('Latest refresh failed:');
    await expect(roster(page)).toContainText('Failed to load the notification roster');
    await expect(alerts).toContainText('Failed to load the registration SLA alerts');
    await expect(
      page.getByText('latest refresh failed — showing the last good roster', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('latest refresh failed — showing the last good alert counts', { exact: true }),
    ).toBeVisible();
    await checkpoint(page, info, `connections-${size}-roster-and-sla-refresh-errors-retained`);
    await send(composer(page));
    await expect(alerts.getByText('Sent this session · 0', { exact: true })).toBeVisible();
    await activate(alerts.getByRole('button', { name: /^Notify all \d+ owners$/ }), 'Enter');
    await expect(
      alerts.getByText(`Sent this session · ${expected}`, { exact: true }),
    ).toBeVisible();
    await expect(alerts.locator('ul').getByText(owner, { exact: true })).toHaveCount(0);
    await checkpoint(page, info, `connections-${size}-stale-batch-excludes-paused-recipient`);
    const before = await page.evaluate(() => ({ ...window.inlineNotificationFixture.calls }));
    await activate(
      alerts.getByRole('button', { name: 'Retry The SLA alert queue', exact: true }),
      'Enter',
    );
    await expect(alerts).toBeFocused();
    await expect(alerts).not.toContainText('Latest refresh failed:');
    await expect(composer(page)).toContainText('Failed to load the notification roster');
    expect(await page.evaluate(() => window.inlineNotificationFixture.calls)).toEqual({
      ...before,
      getRegistrationSlaAlerts: (before.getRegistrationSlaAlerts ?? 0) + 1,
    });
    await checkpoint(page, info, `connections-${size}-sla-only-retry-roster-still-failed`);
    const afterQueue = await page.evaluate(() => ({ ...window.inlineNotificationFixture.calls }));
    await activate(
      roster(page).getByRole('button', { name: 'Retry The team roster', exact: true }),
      'Enter',
    );
    await expect(roster(page)).toBeFocused();
    await expect(composer(page)).not.toContainText('Latest refresh failed:');
    await expect(
      composer(page).getByLabel('To').locator(`option[value="${recipientId}"]`),
    ).toHaveCount(0);
    await expect(
      teamRow.getByRole('button', { name: 'Resume notifications', exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => window.inlineNotificationFixture.calls)).toEqual({
      ...afterQueue,
      getTeamRoster: (afterQueue.getTeamRoster ?? 0) + 1,
    });
    await checkpoint(page, info, `connections-${size}-both-recovered-current-roster`);
    await check(info);
  });
}
