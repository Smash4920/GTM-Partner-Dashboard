import { writeFile } from 'node:fs/promises';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

export const JOURNEY_VIEWPORTS = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
] as const;

export async function retain(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name.replace(/[^\w.-]/g, '-')}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: 'application/json' });
}

export async function settled(page: Page) {
  await expect(page.getByText(/^(Loading|Refreshing)(?:\s|…|\.)/)).toHaveCount(0);
  await expect(page.getByRole('main').locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.getByLabel('Data provider', { exact: true })).toHaveValue('local');
}

export function productionObservations(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const requests: { url: string; method: string }[] = [];
  const sockets: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }));
  page.on('websocket', (socket) => sockets.push(socket.url()));
  return async (info: TestInfo) => {
    await retain(info, 'production-network-and-errors', {
      url: page.url(),
      consoleErrors,
      pageErrors,
      requests,
      sockets,
    });
    expect.soft(consoleErrors).toEqual([]);
    expect.soft(pageErrors).toEqual([]);
    expect.soft(sockets).toEqual([]);
    expect
      .soft(
        requests.every(
          ({ url, method }) =>
            new URL(url).origin === new URL(page.url()).origin && method === 'GET',
        ),
      )
      .toBe(true);
    expect
      .soft(requests.filter(({ url }) => /@vite|@react-refresh|hot-update|\/src\//.test(url)))
      .toEqual([]);
    expect.soft(requests.some(({ url }) => /\/assets\/[^/]+-[\w-]+\.js$/.test(url))).toBe(true);
    expect.soft(new URL(page.url()).origin).toBe('http://127.0.0.1:4173');
  };
}

/** Every interaction is a real keyboard event; DOM evaluation only observes. */
export function keyboardJourney(page: Page) {
  const trace: unknown[] = [];
  async function landing(action: string) {
    const focused = page.locator(':focus');
    await expect(focused, `Focus after ${action}`).toHaveCount(1);
    const state = await focused.evaluate((element) => ({
      tag: element.tagName,
      id: element.id,
      name: element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 180),
      value:
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? element.value
          : null,
      hidden: Boolean(element.closest('[hidden], [inert], [aria-hidden="true"]')),
    }));
    trace.push({ action, ...state });
    expect(state.tag, `Focus disappeared after ${action}`).not.toMatch(/^(BODY|HTML)$/);
    expect(state.hidden, `Hidden focus after ${action}`).toBe(false);
    await expect(focused).toBeVisible();
  }
  async function press(key: string) {
    await page.keyboard.press(key);
    await landing(key);
  }
  async function reach(target: Locator) {
    await expect(target).toBeVisible();
    for (let index = 0; index < 700; index += 1) {
      if (await target.evaluate((element) => element === document.activeElement)) return;
      // Traverse the actual DOM tab order without wrapping across body. Route
      // headings and auto-focused editors are legitimate starting positions.
      const backwards = await target.evaluate((element) => {
        const active = document.activeElement;
        return (
          active !== null &&
          active !== document.body &&
          Boolean(element.compareDocumentPosition(active) & Node.DOCUMENT_POSITION_FOLLOWING)
        );
      });
      await press(backwards ? 'Shift+Tab' : 'Tab');
    }
    throw new Error(`Keyboard traversal did not reach ${await target.getAttribute('aria-label')}`);
  }
  async function activate(target: Locator) {
    await reach(target);
    await press('Enter');
  }
  async function type(target: Locator, value: string) {
    await reach(target);
    await press('ControlOrMeta+A');
    await page.keyboard.insertText(value);
    await landing('insertText');
    await expect(target).toHaveValue(value);
  }
  async function select(target: Locator, value: string) {
    await reach(target);
    await press('Home');
    const count = await target.locator('option').count();
    for (let index = 0; index < count && (await target.inputValue()) !== value; index += 1)
      await press('ArrowDown');
    await expect(target).toHaveValue(value);
  }
  async function navigate(label: string) {
    const nav = page.getByRole('navigation', { name: 'Primary' });
    if (!(await nav.isVisible()))
      await activate(page.getByRole('button', { name: 'Open navigation menu', exact: true }));
    const button = nav.getByRole('button', { name: label, exact: true });
    const current = (await button.getAttribute('aria-current')) === 'page';
    await activate(button);
    if (!current) await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await settled(page);
    await landing(`route: ${label}`);
    await expect(page).toHaveTitle(`${label} | GTM Partner Dashboard`);
  }
  async function checkpoint(name: string, surface: Locator = page.getByRole('main')) {
    await landing(`checkpoint: ${name}`);
    trace.push({ checkpoint: name, tree: await surface.ariaSnapshot() });
  }
  return { press, reach, activate, type, select, navigate, checkpoint, trace };
}

export async function linkedError(control: Locator, message: string) {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const ids = (await control.getAttribute('aria-describedby'))?.split(/\s+/) ?? [];
  expect(ids.length).toBeGreaterThan(0);
  const messages = await Promise.all(
    ids.map((id) => control.page().locator(`[id="${id}"]`).innerText()),
  );
  expect(messages).toContain(message);
}
