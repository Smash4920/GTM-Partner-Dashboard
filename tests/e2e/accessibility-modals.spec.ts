import { writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { WORKFLOW_OUTCOMES } from '../../src/lib/workflows';
import { activate, card, navigate, noOverflow, settle } from './support/accessibility-surfaces';

// Closed inventory in library/accessibility-modal-inventory.md, excluding
// INLINE-NOTIFY-* (covered exhaustively by accessibility-inline-notifications).
// Every host runs the SAME full state matrix at BOTH approved viewports.
// Unreachable query/invalid-target states use isolated, production-built
// static fixtures on the existing preview origin, not product selectors.
test.describe.configure({ mode: 'parallel' });
test.use({ hasTouch: true });
const inventory = new Map<string, { invocation: string; state: string }[]>();
test.beforeEach(({}, info) => {
  test.setTimeout(240_000);
  inventory.set(info.outputDir, []);
});
test.afterEach(async ({ page }, info) => {
  const states = inventory.get(info.outputDir)!;
  const expected = info.title.includes('MOD-MEETING clean/dirty')
    ? 60
    : info.title.includes('MOD-MEETING calendar')
      ? 11
      : info.title.includes('COND-MEETING-PROSPECT')
        ? 21
        : info.title.includes('COND-ACTIVITY-PROSPECT')
          ? 16
          : info.title.includes('roster loading/')
            ? 11
            : info.title.includes('isolated invalid target')
              ? 5
              : info.title.includes('MOD-CONFLICT')
                ? 39
                : 36;
  await evidence(info, 'modal-closed-inventory', {
    title: info.title,
    viewport: page.viewportSize(),
    expected,
    observed: states.length,
    states,
  });
  expect
    .soft(states, 'Every closed-inventory state must produce its own axe artifact')
    .toHaveLength(expected);
  inventory.delete(info.outputDir);
});
const VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
] as const;
const PREFIX = '/__modal-fixture__/';
const ENTRY = 'tests/fixtures/modals/index.html';
const ACTOR = 'Demo actor (not authenticated)';
const FIXED_TIME = new Date('2026-10-01T12:34:56.000Z');
const IDS = 'VAL-A11Y-007 VAL-A11Y-008 VAL-A11Y-009';
type FixtureMethod = Parameters<Window['modalFixture']['arm']>[0];
type Host = {
  id: string;
  route: string;
  kind: keyof typeof WORKFLOW_OUTCOMES;
  title: string;
};
const HOSTS: readonly Host[] = [
  {
    id: 'MOD-REG-QUEUE',
    route: 'Deal Reg Ops',
    kind: 'registration',
    title: 'Registration decision',
  },
  {
    id: 'MOD-REG-ACTION',
    route: 'Action Center',
    kind: 'registration',
    title: 'Registration decision',
  },
  {
    id: 'MOD-CONFLICT',
    route: 'Deal Reg Ops',
    kind: 'conflict',
    title: 'Partner-conflict disposition',
  },
  {
    id: 'MOD-FORECAST-FORECASTING',
    route: 'Forecasting',
    kind: 'forecast',
    title: 'Forecast-change review',
  },
  {
    id: 'MOD-FORECAST-ACTION',
    route: 'Action Center',
    kind: 'forecast',
    title: 'Forecast-change review',
  },
  {
    id: 'MOD-FORECAST-REGOPS',
    route: 'Deal Reg Ops',
    kind: 'forecast',
    title: 'Forecast-change review',
  },
];
const fixtureDir = process.env.E2E_MODAL_FIXTURE_DIR;
test.beforeAll(async () => {
  if (!fixtureDir) throw new Error('Run through npm run test:e2e to prepare immutable fixtures');
});

async function evidence(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name.replace(/[^\w.-]/g, '-')}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

function monitor(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: { url: string; method: string }[] = [];
  const sockets: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  return async (info: TestInfo) => {
    await evidence(info, 'modal-network-console-page-errors', {
      consoleErrors,
      pageErrors,
      requests,
      sockets,
    });
    expect(pageErrors).toEqual([]);
    expect(
      consoleErrors.filter(
        (message) =>
          !/component: DataProvider.*operation: (getTeamRoster|listWeeklyClassificationMeetings)/.test(
            message,
          ),
      ),
    ).toEqual([]);
    expect(sockets).toEqual([]);
    expect(
      requests.every(
        ({ url, method }) => method === 'GET' && new URL(url).origin === new URL(page.url()).origin,
      ),
    ).toBe(true);
    expect(requests.some(({ url }) => /@vite|hot-update|@react-refresh|\/src\//.test(url))).toBe(
      false,
    );
    expect(requests.some(({ url }) => /\/assets\/.*-[\w-]+\.js/.test(url))).toBe(true);
  };
}

async function boot(page: Page, scenario?: string) {
  await page.clock.setFixedTime(FIXED_TIME);
  if (scenario !== undefined) {
    await page.route(`**${PREFIX}**`, async (request) => {
      const relative = new URL(request.request().url()).pathname.slice(PREFIX.length);
      const path = resolve(fixtureDir!, relative);
      if (!path.startsWith(`${fixtureDir}${sep}`)) throw new Error('Fixture path escaped output');
      await request.fulfill({ path });
    });
    await page.goto(`${PREFIX}${ENTRY}?scenario=${scenario}`);
  } else await page.goto('/');
  await settle(page);
}

function controls(dialog: Locator) {
  return dialog.locator(
    'button:visible:not([disabled]), input:visible:not([disabled]), select:visible:not([disabled]), textarea:visible:not([disabled]), a:visible[href], [tabindex="0"]:visible',
  );
}

async function focusGeometry(control: Locator) {
  // Measure the actual keyboard landing, without scrolling/refocusing it
  // first. Besides avoiding redundant browser round trips, this catches
  // clipping that a diagnostic scroll would otherwise silently repair.
  const result = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const bounds = element.closest('dialog')?.getBoundingClientRect() ?? {
      left: 0,
      right: innerWidth,
      top: 64,
      bottom: innerHeight,
    };
    const style = getComputedStyle(element);
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      name: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '',
      focused: element === document.activeElement,
      focusVisible: element.matches(':focus-visible'),
      outline: style.outlineStyle,
      unobscured: point === element || element.contains(point),
      reachable:
        rect.left >= Math.max(0, bounds.left) &&
        rect.right <= Math.min(innerWidth, bounds.right) &&
        rect.top >= Math.max(0, bounds.top) &&
        rect.bottom <= Math.min(innerHeight, bounds.bottom),
    };
  });
  expect.soft(result.focused, result.name).toBe(true);
  expect.soft(result.focusVisible, result.name).toBe(true);
  expect.soft(result.outline, result.name).toBe('solid');
  expect.soft(result.unobscured, result.name).toBe(true);
  expect.soft(result.reachable, result.name).toBe(true);
  return result;
}

async function containment(page: Page, dialog: Locator) {
  const previous = await page.locator(':focus').elementHandle();
  await page.keyboard.press('Shift');
  const list = await controls(dialog).all();
  expect(list.length).toBeGreaterThan(0);
  const trace: { direction: string; index: number; name: string }[] = [];
  await list[0].focus();
  for (const [index, control] of list.entries()) {
    const geometry = await focusGeometry(control);
    trace.push({ direction: 'forward', index, name: geometry.name });
    await page.keyboard.press('Tab');
  }
  await expect(list[0]).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const landing = await list[index].evaluate((element) => ({
      focused: element === document.activeElement,
      name: element.getAttribute('aria-label') ?? element.textContent!,
    }));
    expect(landing.focused, landing.name).toBe(true);
    trace.push({
      direction: 'reverse',
      index,
      name: landing.name,
    });
    await page.keyboard.press('Shift+Tab');
  }
  await expect(list.at(-1)!).toBeFocused();
  await previous?.evaluate((element) => {
    if (element.isConnected && element instanceof HTMLElement) element.focus();
  });
  return trace;
}

async function checkpoint(page: Page, info: TestInfo, invocation: string, state: string) {
  const name = `${invocation}-${page.viewportSize()!.width}x${page.viewportSize()!.height}-${state}`;
  const dialog = page.getByRole('dialog');
  const active = (await dialog.count()) > 0;
  let geometry: unknown = null;
  let focusTrace: unknown = null;
  const session = await page.context().newCDPSession(page);
  const { nodes } = await session.send('Accessibility.getFullAXTree');
  await session.detach();
  const accessibleTree = nodes
    .filter((node) => !node.ignored)
    .map((node) => ({
      role: node.role?.value,
      name: node.name?.value,
      properties: node.properties,
    }));
  if (active) {
    await expect(dialog).toHaveCount(1);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await expect(dialog).toHaveAttribute('open', '');
    expect(await dialog.evaluate((element) => element.matches(':modal'))).toBe(true);
    const title = dialog.getByRole('heading', { level: 2 });
    await expect(title).toHaveCount(1);
    await expect(title).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-labelledby', (await title.getAttribute('id'))!);
    await expect(dialog).toHaveAccessibleName((await title.innerText()).trim());
    await title.scrollIntoViewIfNeeded();
    geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: innerWidth,
        height: innerHeight,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
      };
    });
    expect(geometry).toMatchObject({ overflowY: 'auto' });
    expect(
      await dialog.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return (
          rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight
        );
      }),
    ).toBe(true);
    // Native showModal makes the background inert without adding attributes.
    // A background focus request must leave the exact active modal control
    // alone, and the background h1 must be absent from the accessible tree.
    const before = await page.locator(':focus').elementHandle();
    await page.getByLabel('Data provider', { exact: true }).evaluate((element) => {
      (element as HTMLElement).focus();
    });
    expect(await before?.evaluate((element) => element === document.activeElement)).toBe(true);
    // Playwright's DOM-derived ariaSnapshot does not account for native
    // top-layer inertness. Inspect Chromium's actual assistive-technology
    // tree instead; the DOM snapshot is retained separately for diagnosis.
    expect(accessibleTree.some((node) => node.role === 'main')).toBe(false);
    expect(accessibleTree.some((node) => node.role === 'navigation')).toBe(false);
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    focusTrace = await containment(page, dialog);
    await title.scrollIntoViewIfNeeded();
    const image = info.outputPath(`${name}.png`);
    await page.screenshot({ path: image });
    await info.attach(`${name}-viewport`, { path: image, contentType: 'image/png' });
  } else {
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    const group = page.getByRole('group', { name: 'Add prospective partner', exact: true });
    if (await group.count()) {
      const previous = await page.locator(':focus').elementHandle();
      const list = await controls(group).all();
      const trace = [];
      await page.keyboard.press('Shift');
      await list[0].focus();
      for (const control of list) {
        await expect(control).toBeFocused();
        trace.push(await focusGeometry(control));
        await page.keyboard.press('Tab');
      }
      expect(await group.evaluate((element) => element.contains(document.activeElement))).toBe(
        false,
      );
      await page.keyboard.press('Shift+Tab');
      for (const control of [...list].reverse()) {
        await expect(control).toBeFocused();
        await page.keyboard.press('Shift+Tab');
      }
      expect(await group.evaluate((element) => element.contains(document.activeElement))).toBe(
        false,
      );
      await previous?.evaluate((element) => (element as HTMLElement).focus());
      focusTrace = trace;
    }
  }
  const result = await new AxeBuilder({ page }).analyze();
  await evidence(info, `axe-${name}`, {
    validationIds: ['VAL-A11Y-007', 'VAL-A11Y-008', 'VAL-A11Y-009'],
    invocation,
    state,
    url: page.url(),
    viewport: page.viewportSize(),
    dialogCount: await dialog.count(),
    tree: await page.locator('body').ariaSnapshot(),
    accessibleTree,
    geometry,
    focusTrace,
    activeElement: await page.evaluate(() => {
      const element = document.activeElement!;
      return {
        tag: element.tagName,
        id: element.id,
        name: element.getAttribute('aria-label'),
        text: element.textContent?.trim().slice(0, 300),
        hiddenAncestor: element.closest('[hidden], [inert]') !== null,
      };
    }),
    violations: result.violations,
  });
  inventory.get(info.outputDir)!.push({ invocation, state });
  expect.soft(result.violations, name).toEqual([]);
  await noOverflow(page);
}

async function open(opener: Locator, title: string) {
  await activate(opener, 'Enter');
  const dialog = opener.page().getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: title, exact: true })).toBeFocused();
  return dialog;
}

async function restored(page: Page, opener: Locator) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('dialog')).toHaveCount(0);
  await expect(opener).toBeFocused();
}

async function select(control: Locator, value: string) {
  await control.focus();
  if (value === '__add_partner__') {
    await control.page().keyboard.press('End');
    await expect(
      control.page().getByRole('group', { name: 'Add prospective partner' }),
    ).toBeVisible();
    return;
  }
  await control.page().keyboard.press('Home');
  const length = await control.locator('option').count();
  for (let index = 0; index < length && (await control.inputValue()) !== value; index += 1)
    await control.page().keyboard.press('ArrowDown');
  await expect(control).toHaveValue(value);
}

async function type(control: Locator, value: string) {
  await control.focus();
  await control.page().keyboard.press('ControlOrMeta+A');
  await control.page().keyboard.insertText(value);
}

async function linkedError(control: Locator, message: string) {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  await expect(control).toHaveAccessibleDescription(message);
  const id = await control.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  await expect(control.page().locator(`[id="${id}"]`)).toHaveText(message);
}

async function forecastEdit(page: Page) {
  await navigate(page, 'Forecasting');
  const table = page.getByRole('region', { name: /^In-quarter opportunities/ });
  const opener = table.getByRole('button', { name: /^Edit revenue forecast for / }).first();
  const rowIndex = await opener.evaluate(
    (element) => (element.closest('tr') as HTMLTableRowElement).rowIndex,
  );
  const row = table.getByRole('row').nth(rowIndex);
  await activate(opener, 'Enter');
  await type(row.getByRole('textbox', { name: /^Revenue forecast for / }), '987654321');
  await activate(row.getByRole('button', { name: 'Save revenue', exact: true }), 'Enter');
  await expect(page.getByRole('list', { name: 'Current-session forecast changes' })).toContainText(
    'change-1',
  );
  await settle(page);
}

async function hostInvoker(page: Page, host: Host) {
  if (host.kind === 'forecast') await forecastEdit(page);
  await navigate(page, host.route);
  if (host.id === 'MOD-REG-QUEUE')
    return card(page, 'Registrations awaiting review')
      .getByRole('button', { name: /^Decide / })
      .first();
  if (host.id === 'MOD-CONFLICT')
    return card(page, 'Duplicate & conflicting registrations')
      .getByRole('button', { name: /^Disposition / })
      .first();
  if (host.id === 'MOD-REG-ACTION')
    return page.getByRole('button', { name: 'Record registration decision', exact: true }).first();
  return page.getByRole('button', { name: 'Review change-1', exact: true });
}

async function validDraft(dialog: Locator, outcome: string) {
  const actor = dialog.getByLabel(ACTOR, { exact: true });
  const id = await actor.locator('option:not([value=""])').first().getAttribute('value');
  expect(id).toBeTruthy();
  await select(actor, id!);
  await select(dialog.getByLabel('Outcome', { exact: true }), outcome);
  await type(dialog.getByLabel('Reason', { exact: true }), '  Session-only accessibility review  ');
}

async function backdrop(page: Page) {
  // Both approved widths leave a genuine backdrop point outside the dialog.
  await page.mouse.click(2, 2);
}

async function record(page: Page, info: TestInfo, host: Host, opener: Locator, outcome: string) {
  const dialog = await open(opener, host.title);
  await expect(dialog.getByLabel(ACTOR, { exact: true })).toBeVisible();
  await validDraft(dialog, outcome);
  await checkpoint(page, info, host.id, `valid-${outcome}-draft`);
  const entities = await dialog.locator('p.my-3').innerText();
  await activate(dialog.getByRole('button', { name: 'Record session outcome' }), 'Enter');
  const saved = page.getByRole('dialog', { name: 'Session outcome recorded', exact: true });
  await expect(saved.getByRole('heading', { name: 'Session outcome recorded' })).toBeFocused();
  await expect(saved.getByLabel(ACTOR, { exact: true })).toHaveCount(0);
  await expect(saved.getByText(/Session-only · simulated\/local-only/)).toBeVisible();
  await expect(saved).toContainText('Selected demo actor is not authenticated.');
  await expect(saved).toContainText('Refresh loses these records.');
  await expect(saved).toContainText(`outcome ${outcome}`);
  await expect(saved).toContainText('reason: Session-only accessibility review · time');
  for (const entity of entities.split(/, | · /)) await expect(saved).toContainText(entity);
  await expect(saved.locator('time')).toHaveAttribute('datetime', FIXED_TIME.toISOString());
  await checkpoint(page, info, host.id, `recorded-${outcome}`);
  if (outcome === WORKFLOW_OUTCOMES[host.kind][0])
    await activate(saved.getByRole('button', { name: 'Close', exact: true }), 'touch');
  else await page.keyboard.press('Escape');
  await restored(page, opener);
  await checkpoint(page, info, host.id, `recorded-${outcome}-closed-restored`);
}

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  for (const host of HOSTS) {
    test(`${IDS}: ${host.id} every draft control, validation, dismissal and recorded outcome ${size}`, async ({
      page,
    }, info) => {
      const check = monitor(page);
      await page.setViewportSize(viewport);
      await boot(page);
      const opener = await hostInvoker(page, host);
      const initialStores = await page.evaluate(() => [
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]);
      let dialog = await open(opener, host.title);
      await expect(dialog.getByLabel(ACTOR, { exact: true })).toBeVisible();
      await checkpoint(page, info, host.id, 'ready-clean');
      await page.keyboard.press('Escape');
      await restored(page, opener);
      await checkpoint(page, info, host.id, 'clean-escape-closed');
      dialog = await open(opener, host.title);
      await activate(dialog.getByRole('button', { name: 'Cancel', exact: true }), 'touch');
      await restored(page, opener);
      await checkpoint(page, info, host.id, 'clean-cancel-closed');
      dialog = await open(opener, host.title);
      await backdrop(page);
      await restored(page, opener);
      await checkpoint(page, info, host.id, 'clean-backdrop-closed');
      dialog = await open(opener, host.title);
      const actor = dialog.getByLabel(ACTOR, { exact: true });
      const outcome = dialog.getByLabel('Outcome', { exact: true });
      const reason = dialog.getByLabel('Reason', { exact: true });
      const submit = dialog.getByRole('button', { name: 'Record session outcome' });
      await expect(outcome.locator('option')).toHaveText([
        'Select outcome',
        ...WORKFLOW_OUTCOMES[host.kind],
      ]);
      await activate(submit, 'Enter');
      await expect(actor).toBeFocused();
      await linkedError(actor, 'Select an active demo actor.');
      await linkedError(outcome, 'Select an outcome.');
      await linkedError(reason, 'Enter a reason.');
      await checkpoint(page, info, host.id, 'invalid-actor-outcome-reason');
      await select(
        actor,
        (await actor.locator('option:not([value=""])').first().getAttribute('value'))!,
      );
      await expect(actor).not.toHaveAttribute('aria-invalid', 'true');
      await activate(submit, 'Enter');
      await expect(outcome).toBeFocused();
      await checkpoint(page, info, host.id, 'actor-corrected-outcome-reason-invalid');
      await select(outcome, WORKFLOW_OUTCOMES[host.kind][0]);
      await expect(outcome).not.toHaveAttribute('aria-invalid', 'true');
      await type(reason, '   ');
      await activate(submit, 'Enter');
      await expect(reason).toBeFocused();
      await linkedError(reason, 'Enter a reason.');
      await checkpoint(page, info, host.id, 'actor-outcome-corrected-whitespace-reason-invalid');
      await type(reason, '  Exact preserved draft  ');
      await expect(reason).not.toHaveAttribute('aria-invalid', 'true');
      await checkpoint(page, info, host.id, 'all-errors-corrected-dirty');
      const draft = [
        await actor.inputValue(),
        await outcome.inputValue(),
        await reason.inputValue(),
      ];
      // Escape from EVERY editable field plus final submit/Cancel controls,
      // with both Keep editing and repeated Escape restoring that exact node.
      for (const [index, control] of [actor, outcome, reason, submit].entries()) {
        await control.focus();
        await page.keyboard.press('Escape');
        const confirmation = page.getByRole('dialog', { name: 'Discard unsaved workflow?' });
        await expect(confirmation.getByRole('heading')).toBeFocused();
        await expect(page.getByLabel(ACTOR, { exact: true })).toBeHidden();
        await checkpoint(page, info, host.id, `discard-escape-control-${index}`);
        if (index % 2 === 0)
          await activate(confirmation.getByRole('button', { name: 'Keep editing' }), 'Enter');
        else await page.keyboard.press('Escape');
        await expect(control).toBeFocused();
        expect([
          await actor.inputValue(),
          await outcome.inputValue(),
          await reason.inputValue(),
        ]).toEqual(draft);
        await checkpoint(page, info, host.id, `discard-control-${index}-exact-draft-returned`);
      }
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
      await activate(cancel, 'Enter');
      await checkpoint(page, info, host.id, 'discard-cancel');
      await page.keyboard.press('Escape');
      await expect(cancel).toBeFocused();
      await checkpoint(page, info, host.id, 'discard-cancel-escape-returned');
      await reason.focus();
      await backdrop(page);
      await checkpoint(page, info, host.id, 'discard-backdrop');
      await activate(page.getByRole('button', { name: 'Keep editing' }), 'touch');
      // Retain every subsequent inventory artifact even if this particular
      // restoration is defective; a soft assertion still fails the test.
      await expect.soft(reason).toBeFocused();
      await checkpoint(page, info, host.id, 'discard-backdrop-kept');
      // Each field alone makes a clean draft dirty, not only Reason.
      await activate(cancel, 'Enter');
      await activate(page.getByRole('button', { name: 'Discard', exact: true }), 'Enter');
      await restored(page, opener);
      await checkpoint(page, info, host.id, 'discard-confirmed-exact-invoker');
      for (const field of ['actor', 'outcome', 'reason'] as const) {
        dialog = await open(opener, host.title);
        await expect(dialog.getByLabel(ACTOR, { exact: true })).toBeVisible();
        let control: Locator;
        if (field === 'actor') {
          control = dialog.getByLabel(ACTOR, { exact: true });
          await select(
            control,
            (await control.locator('option:not([value=""])').first().getAttribute('value'))!,
          );
        } else if (field === 'outcome') {
          control = dialog.getByLabel('Outcome', { exact: true });
          await select(control, WORKFLOW_OUTCOMES[host.kind][0]);
        } else {
          control = dialog.getByLabel('Reason', { exact: true });
          await type(control, 'Isolated reason draft');
        }
        await checkpoint(page, info, host.id, `only-${field}-dirty`);
        await page.keyboard.press('Escape');
        await checkpoint(page, info, host.id, `only-${field}-discard`);
        await activate(page.getByRole('button', { name: 'Discard', exact: true }), 'touch');
        await restored(page, opener);
        await checkpoint(page, info, host.id, `only-${field}-discarded-restored`);
      }
      for (const value of WORKFLOW_OUTCOMES[host.kind])
        await record(page, info, host, opener, value);
      expect(
        await page.evaluate(() => [Object.entries(localStorage), Object.entries(sessionStorage)]),
      ).toEqual(initialStores);
      await check(info);
    });

    test(`${IDS}: ${host.id} roster loading/unavailable/retry/empty/partial/scope-refresh and removed-invoker fallback ${size}`, async ({
      page,
    }, info) => {
      const check = monitor(page);
      await page.setViewportSize(viewport);
      await boot(page, '');
      const opener = await hostInvoker(page, host);
      await arm(page, 'getTeamRoster', 'hold');
      let dialog = await open(opener, host.title);
      await expect(dialog.getByRole('status')).toHaveText('Loading workflow actor roster');
      await checkpoint(page, info, host.id, 'roster-loading');
      await release(page, 'getTeamRoster', true);
      await expect(dialog).toContainText('Workflow actor roster unavailable:');
      await checkpoint(page, info, host.id, 'roster-unavailable');
      const retry = dialog.getByRole('button', {
        name: 'Retry workflow actor roster',
        exact: true,
      });
      await arm(page, 'getTeamRoster', 'hold');
      const before = await calls(page, 'getTeamRoster');
      await activate(retry, 'Enter');
      await expect(dialog).toContainText('Workflow actor roster unavailable:');
      await expect(retry).toBeFocused();
      await checkpoint(page, info, host.id, 'roster-retry-in-flight');
      await release(page, 'getTeamRoster', true);
      await checkpoint(page, info, host.id, 'roster-retry-failed');
      expect(await calls(page, 'getTeamRoster')).toBe(before + 1);
      await arm(page, 'getTeamRoster', 'partial');
      await activate(retry, 'Enter');
      await expect(
        dialog.getByRole('group', { name: 'workflow actor roster', exact: true }),
      ).toBeFocused();
      await expect(dialog).toContainText('provider local · partial');
      await checkpoint(page, info, host.id, 'roster-retry-partial-recovered');
      await validDraft(dialog, WORKFLOW_OUTCOMES[host.kind][0]);
      const draft = [
        await dialog.getByLabel(ACTOR).inputValue(),
        await dialog.getByLabel('Outcome', { exact: true }).inputValue(),
        await dialog.getByLabel('Reason', { exact: true }).inputValue(),
      ];
      await arm(page, 'getTeamRoster', 'hold');
      await page.evaluate(() => window.modalFixture.refreshRoster());
      await expect(dialog.getByRole('status')).toBeVisible();
      // A new roster scope replaces data; form controls are genuinely absent
      // rather than claimed to be retained under a nonexistent refresh state.
      await expect(dialog.getByLabel(ACTOR)).toHaveCount(0);
      const refreshFocus = await page.evaluate(() => ({
        tag: document.activeElement?.tagName,
        insideModal: document.activeElement?.closest('dialog[open]') !== null,
      }));
      await evidence(info, `${host.id}-roster-refresh-focus`, refreshFocus);
      await expect.soft(dialog.getByRole('heading')).toBeFocused();
      // A failing focus assertion must not suppress the remaining axe states.
      // Repair only after recording/failing the real transition, and identify
      // that diagnostic repair explicitly in this file-backed trace.
      if (!refreshFocus.insideModal) await dialog.getByRole('heading').focus();
      await checkpoint(page, info, host.id, 'roster-scope-refresh-loading');
      await release(page, 'getTeamRoster', true);
      await checkpoint(page, info, host.id, 'roster-scope-refresh-error');
      await activate(retry, 'Enter');
      await expect(
        dialog.getByRole('group', { name: 'workflow actor roster', exact: true }),
      ).toBeFocused();
      expect([
        await dialog.getByLabel(ACTOR).inputValue(),
        await dialog.getByLabel('Outcome', { exact: true }).inputValue(),
        await dialog.getByLabel('Reason', { exact: true }).inputValue(),
      ]).toEqual(draft);
      await checkpoint(page, info, host.id, 'roster-refresh-recovered-draft-retained');
      await page.keyboard.press('Escape');
      await activate(page.getByRole('button', { name: 'Discard', exact: true }), 'Enter');
      await restored(page, opener);
      await arm(page, 'getTeamRoster', 'empty');
      dialog = await open(opener, host.title);
      await expect(dialog.getByLabel(ACTOR).locator('option')).toHaveCount(1);
      await checkpoint(page, info, host.id, 'roster-empty');
      await activate(dialog.getByRole('button', { name: 'Record session outcome' }), 'Enter');
      await linkedError(dialog.getByLabel(ACTOR), 'Select an active demo actor.');
      await checkpoint(page, info, host.id, 'roster-empty-invalid');
      await page.keyboard.press('Escape');
      await restored(page, opener);
      // A detached invoker is a deterministic integration fixture, not a
      // claim that records currently remove source queues (they do not).
      dialog = await open(opener, host.title);
      await expect(dialog.getByLabel(ACTOR)).toBeVisible();
      await opener.evaluate((element) => element.remove());
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.soft(page.getByRole('heading', { level: 1 })).toBeFocused();
      await checkpoint(page, info, host.id, 'removed-invoker-nearest-route-heading');
      await check(info);
    });

    test(`${IDS}: ${host.id} isolated invalid target remains unrecorded and recorded confirmation removed-invoker fallback ${size}`, async ({
      page,
    }, info) => {
      const check = monitor(page);
      await page.setViewportSize(viewport);
      await boot(page, 'invalid-target');
      const opener = await hostInvoker(page, host);
      const dialog = await open(opener, host.title);
      await expect(dialog.getByLabel(ACTOR)).toBeVisible();
      await validDraft(dialog, WORKFLOW_OUTCOMES[host.kind][0]);
      await activate(dialog.getByRole('button', { name: 'Record session outcome' }), 'Enter');
      await expect(dialog.getByRole('alert')).toHaveText(
        'Workflow entity or runtime timestamp is unavailable.',
      );
      await expect(page.getByRole('dialog', { name: 'Session outcome recorded' })).toHaveCount(0);
      await expect(
        page.getByRole('list', { name: 'Session workflow records' }).getByRole('listitem'),
      ).toHaveCount(0);
      await checkpoint(page, info, host.id, 'invalid-target-unrecorded');
      await page.keyboard.press('Escape');
      await checkpoint(page, info, host.id, 'invalid-target-discard');
      await opener.evaluate((element) => element.remove());
      await activate(page.getByRole('button', { name: 'Discard', exact: true }), 'Enter');
      await expect.soft(page.getByRole('heading', { level: 1 })).toBeFocused();
      await checkpoint(page, info, host.id, 'invalid-target-discard-removed-invoker-fallback');
      // Return to the ordinary built entry to test completion fallback too.
      await page.goto('/');
      await settle(page);
      const validOpener = await hostInvoker(page, host);
      const valid = await open(validOpener, host.title);
      await expect(valid.getByLabel(ACTOR)).toBeVisible();
      await validDraft(valid, WORKFLOW_OUTCOMES[host.kind][0]);
      await activate(valid.getByRole('button', { name: 'Record session outcome' }), 'Enter');
      await checkpoint(page, info, host.id, 'recorded-before-invoker-removed');
      await validOpener.evaluate((element) => element.remove());
      await page.keyboard.press('Escape');
      await expect.soft(page.getByRole('heading', { level: 1 })).toBeFocused();
      await checkpoint(page, info, host.id, 'recorded-escape-removed-invoker-fallback');
      await check(info);
    });
  }

  test(`${IDS}: MOD-MEETING calendar loading/empty/error/retry/pagination/loading-more/appended/end ${size}`, async ({
    page,
  }, info) => {
    const check = monitor(page);
    await page.setViewportSize(viewport);
    await boot(page, 'meetings-paged');
    await arm(page, 'listWeeklyClassificationMeetings', 'hold');
    await navigateActivity(page);
    const opener = page.getByRole('button', { name: 'Log Meetings', exact: true });
    let dialog = await open(opener, 'Log meetings · Alex Morgan');
    await expect(dialog.getByText('Loading meetings…', { exact: true })).toBeVisible();
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-initial-loading');
    await release(page, 'listWeeklyClassificationMeetings', true);
    await expect(dialog.getByRole('button', { name: 'Retry meeting calendar' })).toBeVisible();
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-first-page-error');
    await arm(page, 'listWeeklyClassificationMeetings', 'hold');
    await activate(dialog.getByRole('button', { name: 'Retry meeting calendar' }), 'Enter');
    await expect(
      dialog.getByRole('group', { name: 'meeting calendar', exact: true }),
    ).toBeFocused();
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-first-page-retry-loading');
    await release(page, 'listWeeklyClassificationMeetings');
    await expect(dialog.getByRole('combobox', { name: /^Partner for / })).toHaveCount(25);
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-recovered-25-rows');
    const partner = dialog.getByRole('combobox', { name: /^Partner for / }).first();
    const typeControl = dialog.getByRole('combobox', { name: /^Call type for / }).first();
    await typeControl.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    const draft = [await partner.inputValue(), await typeControl.inputValue()];
    await arm(page, 'listWeeklyClassificationMeetings', 'hold');
    const more = dialog.getByRole('button', { name: 'Load more meetings', exact: true });
    const before = await calls(page, 'listWeeklyClassificationMeetings');
    await activate(more, 'Enter');
    await expect(more).toBeFocused();
    await expect(more).toBeDisabled();
    await expect(dialog.getByRole('combobox', { name: /^Partner for / })).toHaveCount(25);
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-load-more-loading-retains-draft');
    await release(page, 'listWeeklyClassificationMeetings', true);
    await expect(dialog).toContainText('Failed to load more meetings');
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-loaded-rows-page-error');
    await arm(page, 'listWeeklyClassificationMeetings', 'hold');
    await activate(dialog.getByRole('button', { name: 'Retry meeting calendar' }), 'Enter');
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-loaded-rows-page-retry-loading');
    await release(page, 'listWeeklyClassificationMeetings');
    await expect(dialog.getByRole('combobox', { name: /^Partner for / })).toHaveCount(30);
    expect([await partner.inputValue(), await typeControl.inputValue()]).toEqual(draft);
    expect(await calls(page, 'listWeeklyClassificationMeetings')).toBe(before + 2);
    await expect(dialog.getByRole('button', { name: 'Load more meetings' })).toBeDisabled();
    await expect(dialog).toContainText('Showing 30 of 30');
    await expect(dialog).toContainText('end of results');
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-appended-30-rows-end');
    await activate(dialog.getByRole('button', { name: 'Submit classifications' }), 'Enter');
    await restored(page, opener);
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-paged-submitted-restored');
    await navigate(page, 'Home');
    await arm(page, 'listWeeklyClassificationMeetings', 'empty');
    await navigateActivity(page);
    dialog = await open(opener, 'Log meetings · Alex Morgan');
    await expect(dialog.getByRole('combobox')).toHaveCount(0);
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-empty-week-five-days');
    await page.keyboard.press('Escape');
    await restored(page, opener);
    await checkpoint(page, info, 'MOD-MEETING', 'calendar-empty-closed');
    await check(info);
  });

  test(`${IDS}: MOD-MEETING clean/dirty all classifications and Cancel/close/backdrop/Escape confirmations ${size}`, async ({
    page,
  }, info) => {
    const check = monitor(page);
    await page.setViewportSize(viewport);
    await boot(page);
    await navigate(page, 'Activity Tracking');
    const opener = page.getByRole('button', { name: 'Log Meetings', exact: true });
    const title = 'Log meetings · Alex Morgan';
    for (const method of ['Cancel', 'Close Log meetings', 'Escape', 'backdrop']) {
      const dialog = await open(opener, title);
      await expect(dialog.getByRole('combobox', { name: /^Partner for / })).toHaveCount(10);
      await checkpoint(page, info, 'MOD-MEETING', `clean-calendar-before-${method}`);
      if (method === 'Escape') await page.keyboard.press('Escape');
      else if (method === 'backdrop') await backdrop(page);
      else await activate(dialog.getByRole('button', { name: method, exact: true }), 'touch');
      await restored(page, opener);
      await checkpoint(page, info, 'MOD-MEETING', `clean-${method}-closed-restored`);
    }
    let dialog = await open(opener, title);
    const partners = dialog.getByRole('combobox', { name: /^Partner for / });
    const types = dialog.getByRole('combobox', { name: /^Call type for / });
    const values: { partner: string; type: string }[] = [];
    // Change and retain BOTH controls of EVERY loaded meeting, not a sample.
    for (let index = 0; index < 10; index += 1) {
      const partner = partners.nth(index);
      const next = await partner
        .locator('option:not([value="__add_partner__"])')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      await select(
        partner,
        next.find((value) => value !== '')!,
      );
      const current = await types.nth(index).inputValue();
      const alternate = await types
        .nth(index)
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      await select(
        types.nth(index),
        alternate.find((value) => value !== current)!,
      );
      values.push({
        partner: await partner.inputValue(),
        type: await types.nth(index).inputValue(),
      });
    }
    await checkpoint(page, info, 'MOD-MEETING', 'dirty-all-twenty-classification-controls');
    for (const [index, control] of (await dialog.getByRole('combobox').all()).entries()) {
      await control.focus();
      await page.keyboard.press('Escape');
      const confirm = page.getByRole('dialog', {
        name: 'Discard unsubmitted classifications?',
        exact: true,
      });
      await expect(confirm.getByRole('heading')).toBeFocused();
      await expect(confirm.getByRole('combobox')).toHaveCount(0);
      await checkpoint(page, info, 'CONF-MEETING-DISCARD', `dirty-escape-meeting-control-${index}`);
      if (index % 2 === 0)
        await activate(confirm.getByRole('button', { name: 'Keep editing' }), 'Enter');
      else await page.keyboard.press('Escape');
      await expect.soft(control).toBeFocused();
      for (const [row, value] of values.entries()) {
        await expect(partners.nth(row)).toHaveValue(value.partner);
        await expect(types.nth(row)).toHaveValue(value.type);
      }
      await checkpoint(page, info, 'CONF-MEETING-DISCARD', `control-${index}-exact-draft-returned`);
    }
    for (const method of ['Cancel', 'Close Log meetings', 'backdrop']) {
      const control =
        method === 'backdrop'
          ? types.first()
          : dialog.getByRole('button', { name: method, exact: true });
      await control.focus();
      if (method === 'backdrop') await backdrop(page);
      else await activate(control, 'Enter');
      await checkpoint(page, info, 'CONF-MEETING-DISCARD', `dirty-${method}-confirmation`);
      await activate(page.getByRole('button', { name: 'Keep editing' }), 'touch');
      await expect.soft(control).toBeFocused();
      await checkpoint(page, info, 'CONF-MEETING-DISCARD', `dirty-${method}-kept`);
    }
    await activate(dialog.getByRole('button', { name: 'Submit classifications' }), 'Enter');
    await restored(page, opener);
    await checkpoint(page, info, 'MOD-MEETING', 'dirty-submitted-exact-invoker');
    dialog = await open(opener, title);
    for (const [index, value] of values.entries()) {
      await expect(partners.nth(index)).toHaveValue(value.partner);
      await expect(types.nth(index)).toHaveValue(value.type);
    }
    await checkpoint(page, info, 'MOD-MEETING', 'submitted-classifications-reopened-clean');
    await page.keyboard.press('Escape');
    await restored(page, opener);
    dialog = await open(opener, title);
    await types.first().focus();
    const options = await types
      .first()
      .locator('option')
      .evaluateAll((elements) => elements.map((element) => (element as HTMLOptionElement).value));
    await select(
      types.first(),
      options.find((value) => value !== values[0].type)!,
    );
    await page.keyboard.press('Escape');
    await checkpoint(page, info, 'CONF-MEETING-DISCARD', 'confirmed-discard-before-close');
    await activate(page.getByRole('button', { name: 'Discard', exact: true }), 'touch');
    await restored(page, opener);
    await checkpoint(page, info, 'CONF-MEETING-DISCARD', 'discarded-exact-invoker');
    dialog = await open(opener, title);
    await opener.evaluate((element) => element.remove());
    await page.keyboard.press('Escape');
    await expect.soft(page.getByRole('heading', { level: 1 })).toBeFocused();
    await checkpoint(page, info, 'MOD-MEETING', 'removed-invoker-clean-escape-heading-fallback');
    await check(info);
  });

  for (const inMeeting of [true, false]) {
    const invocation = inMeeting ? 'COND-MEETING-PROSPECT' : 'COND-ACTIVITY-PROSPECT';
    test(`${IDS}: ${invocation} blank/whitespace/nonblank Add/Enter Cancel/Escape and preserved nested discard ${size}`, async ({
      page,
    }, info) => {
      const check = monitor(page);
      await page.setViewportSize(viewport);
      await boot(page);
      await navigate(page, 'Activity Tracking');
      const meetingOpener = page.getByRole('button', { name: 'Log Meetings', exact: true });
      let dialog: Locator | undefined;
      if (inMeeting) dialog = await open(meetingOpener, 'Log meetings · Alex Morgan');
      const partner = inMeeting
        ? dialog!.getByRole('combobox', { name: /^Partner for / }).first()
        : page.getByRole('combobox', { name: 'Partner', exact: true });
      const original = await partner.inputValue();
      for (const action of ['Cancel', 'Escape', 'Add', 'Enter']) {
        await select(partner, '__add_partner__');
        const group = page.getByRole('group', { name: 'Add prospective partner', exact: true });
        const input = group.getByRole('textbox', { name: 'Partner name', exact: true });
        await expect(input).toBeFocused();
        await expect(group.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
        await checkpoint(page, info, invocation, `${action}-blank-inline-open`);
        await page.keyboard.press('Enter');
        await expect(input).toBeFocused();
        await type(input, '   ');
        await expect(group.getByRole('button', { name: 'Add', exact: true })).toBeDisabled();
        await checkpoint(page, info, invocation, `${action}-whitespace-add-disabled`);
        await page.keyboard.press('Enter');
        await expect(input).toHaveValue('   ');
        await type(input, `  Session prospect ${action}  `);
        await expect(group.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
        await checkpoint(page, info, invocation, `${action}-nonblank-inline-open`);
        if (action === 'Escape' || action === 'Enter') await page.keyboard.press(action);
        else await activate(group.getByRole('button', { name: action, exact: true }), 'touch');
        await expect(group).toHaveCount(0);
        await expect(partner).toBeFocused();
        if (action === 'Cancel' || action === 'Escape') await expect(partner).toHaveValue(original);
        else {
          await expect(partner.locator('option:checked')).toHaveText(`Session prospect ${action}`);
          expect(await partner.inputValue()).toMatch(/^prospect-/);
        }
        await checkpoint(page, info, invocation, `${action}-closed-control-restored`);
      }
      if (inMeeting) {
        const typeControl = dialog!.getByRole('combobox', { name: /^Call type for / }).first();
        await typeControl.focus();
        await page.keyboard.press('Home');
        await page.keyboard.press('ArrowDown');
        const savedType = await typeControl.inputValue();
        await select(partner, '__add_partner__');
        const input = page.getByRole('textbox', { name: 'Partner name', exact: true });
        await type(input, 'Exact nested inline draft');
        // Escape within the inline form cancels just that form, never the
        // parent dirty draft or a silently nested second dialog.
        await page.keyboard.press('Escape');
        await expect(partner).toBeFocused();
        await expect(typeControl).toHaveValue(savedType);
        await checkpoint(page, info, invocation, 'dirty-parent-inline-escape-only-cancels-inline');
        await select(partner, '__add_partner__');
        await type(input, 'Exact nested inline draft');
        await activate(dialog!.getByRole('button', { name: 'Close Log meetings' }), 'Enter');
        await expect(page.getByRole('textbox', { name: 'Partner name' })).toHaveCount(0);
        await checkpoint(
          page,
          info,
          'CONF-MEETING-DISCARD',
          'inline-prospect-open-under-confirmation',
        );
        await activate(page.getByRole('button', { name: 'Keep editing' }), 'Enter');
        await expect(dialog!.getByRole('button', { name: 'Close Log meetings' })).toBeFocused();
        await expect(input).toHaveValue('Exact nested inline draft');
        await checkpoint(page, info, invocation, 'nested-confirmation-keeps-exact-inline-draft');
        await input.focus();
        await page.keyboard.press('Escape');
        await expect(partner).toBeFocused();
        await activate(dialog!.getByRole('button', { name: 'Cancel', exact: true }), 'Enter');
        await checkpoint(
          page,
          info,
          'CONF-MEETING-DISCARD',
          'inline-prospect-closed-parent-dirty-confirmation',
        );
        await page.keyboard.press('Escape');
        await expect(dialog!.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
        await activate(dialog!.getByRole('button', { name: 'Cancel', exact: true }), 'Enter');
        await activate(page.getByRole('button', { name: 'Discard', exact: true }), 'Enter');
        await restored(page, meetingOpener);
        await checkpoint(page, info, invocation, 'parent-discard-inline-removed-from-tree');
      }
      await check(info);
    });
  }
}

async function arm(
  page: Page,
  method: FixtureMethod,
  mode: Parameters<Window['modalFixture']['arm']>[1],
) {
  await page.evaluate(([name, value]) => window.modalFixture.arm(name, value), [
    method,
    mode,
  ] as const);
}

async function release(page: Page, method: FixtureMethod, fail = false) {
  await expect
    .poll(() => page.evaluate((name) => window.modalFixture.pending[name], method))
    .toBe(true);
  await page.evaluate(([name, value]) => window.modalFixture.release(name, value), [
    method,
    fail,
  ] as const);
}

async function calls(page: Page, method: FixtureMethod) {
  return page.evaluate((name) => window.modalFixture.calls[name] ?? 0, method);
}

async function navigateActivity(page: Page) {
  // The calendar is intentionally held. Wait only for its independent
  // directory/roster prerequisites, not the generic settle helper.
  const nav = page.getByRole('navigation', { name: 'Primary' });
  if (!(await nav.isVisible()))
    await activate(page.getByRole('button', { name: 'Open navigation menu' }), 'Enter');
  await activate(nav.getByRole('button', { name: 'Activity Tracking', exact: true }), 'Enter');
  await expect(page.getByRole('button', { name: 'Log Meetings', exact: true })).toBeEnabled();
}
