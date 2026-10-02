import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ROUTES } from '../../src/data/routes';

const nav = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

async function settle(page: Page) {
  await expect(page.getByText(/^Loading /)).toHaveCount(0);
}

async function navigate(page: Page, name: string) {
  const destination = nav(page).getByRole('button', { name, exact: true });
  await destination.focus();
  await page.keyboard.press('Enter');
  await expect(heading(page)).toBeFocused();
  await settle(page);
}

async function recordAnnouncements(page: Page) {
  await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Route announcement"]')!;
    const announcements: string[] = [];
    new MutationObserver(() => announcements.push(region.textContent!)).observe(region, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    Object.assign(window, { routeAnnouncements: announcements });
  });
}

function observe(page: Page) {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return () => {
    expect(errors).toEqual([]);
    expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
    expect(requests.some((url) => /@vite\/client|hot-update/.test(url))).toBe(false);
    expect(requests.some((url) => /\/assets\/.*-[\w-]+\.js/.test(url))).toBe(true);
  };
}

test('VAL-A11Y-001: resize, collapse, mobile opening and route selection preserve independent navigation', async ({
  page,
}) => {
  const check = observe(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true });
  await expect(collapse).toHaveAttribute('aria-controls', 'primary-navigation');
  await collapse.click();
  const expand = page.getByRole('button', { name: 'Expand sidebar', exact: true });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expect(nav(page)).toHaveCSS('width', '56px');
  await expect(nav(page).getByRole('button', { name: 'Home', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav(page)).toBeHidden();
  const open = page.getByRole('button', { name: 'Open navigation menu', exact: true });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  await expect(open).toHaveAttribute('aria-controls', 'primary-navigation');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await open.focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Data provider')).toBeFocused();
  await open.click();
  await expect(page.getByRole('button', { name: 'Close navigation menu' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await navigate(page, 'Action Center');
  await expect(nav(page)).toBeHidden();
  await open.click();
  await expect(
    nav(page).getByRole('button', { name: 'Action Center', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Close navigation menu' }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(expand).toBeVisible();
  await expect(nav(page)).toHaveCSS('width', '56px');
  await expand.click();
  await expect(nav(page)).toHaveCSS('width', '208px');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(nav(page)).toBeHidden();
  await open.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(open).toHaveAttribute('aria-expanded', 'false');
  check();
});

test('VAL-A11Y-002 VAL-CROSS-001: first Tab, skip, and keyboard navigation provide context for all registered routes', async ({
  page,
}) => {
  const check = observe(page);
  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  const bounds = await skip.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('main')).toHaveCount(1);
  await navigate(page, 'Data Connections');
  await recordAnnouncements(page);
  for (const { label } of ROUTES) {
    await navigate(page, label);
    await expect(page).toHaveTitle(`${label} | GTM Partner Dashboard`);
    await expect(heading(page)).toHaveCount(1);
    await expect(heading(page)).toBeVisible();
    await expect(nav(page).getByRole('button', { name: label, exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByRole('status', { name: 'Route announcement' })).toHaveText(
      `${label} page`,
    );
    expect((await heading(page).boundingBox())!.y).toBeGreaterThanOrEqual(64);
  }
  expect(await page.evaluate(() => Reflect.get(window, 'routeAnnouncements'))).toEqual(
    ROUTES.map(({ label }) => `${label} page`),
  );
  await navigate(page, 'Action Center');
  const more = page.getByRole('button', { name: 'Load 25 more', exact: true });
  await more.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('action-item')).toHaveCount(50);
  await expect(more).toBeFocused();
  await expect(page.getByRole('status', { name: 'Route announcement' })).toHaveText(
    'Action Center page',
  );
  expect(await page.evaluate(() => Reflect.get(window, 'routeAnnouncements'))).toEqual([
    ...ROUTES.map(({ label }) => `${label} page`),
    'Action Center page',
  ]);
  check();
});

test('VAL-A11Y-002: query refresh, edits, metadata and focused retry never repeat route context', async ({
  page,
}) => {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/?remoteFailMethods=getActionCenterSummary:1:1');
  await navigate(page, 'Forecasting');
  await recordAnnouncements(page);
  const manager = page.getByRole('combobox', { name: 'Partner manager', exact: true });
  await manager.focus();
  await manager.selectOption({ index: 1 });
  await settle(page);
  await expect(manager).toBeFocused();
  const row = page
    .getByRole('region', { name: 'In-quarter opportunities, scrollable' })
    .getByRole('row')
    .nth(1);
  await row.getByRole('button', { name: /^Edit revenue forecast/ }).click();
  await row.getByRole('textbox', { name: /^Revenue forecast/ }).fill('500000');
  await row.getByRole('button', { name: 'Save revenue', exact: true }).click();
  await settle(page);
  await expect(row.getByRole('button', { name: /^Edit revenue forecast/ })).toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, 'routeAnnouncements'))).toEqual([]);

  await page.getByLabel('Data provider').focus();
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();
  await settle(page);
  await expect(page.getByLabel('Data provider')).toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, 'routeAnnouncements'))).toEqual([]);
  await navigate(page, 'Action Center');
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
  await recordAnnouncements(page);
  await page.getByLabel('High value (USD)', { exact: true }).fill('400001');
  const apply = page.getByRole('button', { name: 'Apply demo policy', exact: true });
  await apply.focus();
  await page.keyboard.press('Enter');
  const retry = page.getByRole('button', { name: 'Retry Action Center summary', exact: true });
  await expect(retry).toBeVisible();
  await expect(apply).toBeFocused();
  await expect(page.getByTestId('action-item')).toHaveCount(25);
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(retry).toHaveCount(0);
  await expect(
    page.getByRole('group', { name: 'Action Center summary', exact: true }),
  ).toBeFocused();
  await expect(heading(page)).not.toBeFocused();
  expect(await page.evaluate(() => Reflect.get(window, 'routeAnnouncements'))).toEqual([]);
  await expect(page).toHaveTitle('Action Center | GTM Partner Dashboard');
  expect(errors).toHaveLength(1);
  expect(errors[0]).toMatch(/component: DataProvider, operation: getActionCenterSummary/);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
});

test('VAL-CROSS-001: static route headings and catalog remain keyboard reachable after readiness failure', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/?remoteFailFirst=1');
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByRole('alert')).toContainText('Still using Local mock');
  for (const label of ['Production Requirements', 'Data Connections']) {
    await navigate(page, label);
    await expect(page).toHaveTitle(`${label} | GTM Partner Dashboard`);
    await expect(heading(page)).toHaveText(label);
  }
  await expect(
    page.getByRole('heading', { name: 'Data connection map', exact: true }),
  ).toBeVisible();
  expect(pageErrors).toEqual([]);
});

for (const { id, label } of ROUTES) {
  test(`VAL-A11Y-003: ${label} controls have ordered, unclipped keyboard focus`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto('/');
    if (id === 'home') await navigate(page, 'Data Connections');
    await navigate(page, label);
    // Start a genuine keyboard sequence at the document's first control.
    await page.getByRole('link', { name: 'Skip to main content' }).focus();
    const controls = await page
      .locator('a[href], button, input, select, textarea, summary, [tabindex]')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const control = element as HTMLElement;
            const style = getComputedStyle(control);
            return (
              control.tabIndex >= 0 &&
              !control.matches(':disabled') &&
              !control.closest('[hidden], [inert]') &&
              style.visibility !== 'hidden' &&
              control.getClientRects().length > 0
            );
          })
          .map((element, index) => {
            element.setAttribute('data-focus-index', String(index));
            return index;
          }),
      );
    for (const index of controls.slice(1)) {
      await page.keyboard.press('Tab');
      const control = page.locator(`[data-focus-index="${index}"]`);
      await expect(control).toBeFocused();
      const result = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        const bounds = element.getBoundingClientRect();
        const clippedBy: string[] = [];
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          if (!/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowX)) continue;
          const container = parent.getBoundingClientRect();
          if (bounds.left < container.left - 1 || bounds.right > container.right + 1) {
            clippedBy.push(parent.getAttribute('aria-label') ?? parent.tagName);
          }
        }
        return {
          positiveTabindex: (element as HTMLElement).tabIndex > 0,
          visible: element.matches(':focus-visible'),
          outline: style.outlineStyle,
          width: style.outlineWidth,
          offset: style.outlineOffset,
          clippedBy,
        };
      });
      expect(result).toEqual({
        positiveTabindex: false,
        visible: true,
        outline: 'solid',
        width: '2px',
        offset: '-2px',
        clippedBy: [],
      });
    }
    const pointer = nav(page).getByRole('button', { name: label, exact: true });
    await pointer.click();
    expect(await pointer.evaluate((element) => element.matches(':focus-visible'))).toBe(false);
    await pointer.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(pointer).toHaveCSS('outline-style', 'solid');
    await pointer.click();
    await expect(pointer).toHaveCSS('outline-style', 'none');
  });
}

async function associatedError(control: Locator, text: string) {
  await expect(control).toHaveAttribute('aria-invalid', 'true');
  const id = await control.getAttribute('aria-describedby');
  expect(id).toBeTruthy();
  await expect(control.page().locator(`[id="${id}"]`)).toHaveText(text);
  await expect(control.page().locator(`[id="${id}"]`)).toBeVisible();
}

async function axe(page: Page) {
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

test('VAL-A11Y-004: forecast, roster, policy and notification errors are linked, focused and cleared', async ({
  page,
}) => {
  await page.goto('/');
  await navigate(page, 'Forecasting');
  const row = page
    .getByRole('region', { name: 'In-quarter opportunities, scrollable' })
    .getByRole('row')
    .nth(1);
  await row.getByRole('button', { name: /^Edit revenue forecast/ }).click();
  const revenue = row.getByRole('textbox', { name: /^Revenue forecast/ });
  await revenue.fill('-1');
  await row.getByRole('button', { name: 'Save revenue', exact: true }).click();
  await expect(revenue).toBeFocused();
  await associatedError(revenue, 'Enter a non-negative number.');
  await axe(page);
  await revenue.fill('500000');
  await expect(revenue).not.toHaveAttribute('aria-describedby');
  await row.getByRole('button', { name: 'Cancel revenue edit' }).click();
  await navigate(page, 'Data Connections');
  await page.getByRole('button', { name: 'Add user', exact: true }).click();
  const roster = page.getByRole('form', { name: 'Add internal user' });
  await roster.getByRole('button', { name: 'Add to roster' }).click();
  await expect(roster.getByLabel('Name', { exact: true })).toBeFocused();
  await associatedError(roster.getByLabel('Name', { exact: true }), 'A name is required.');
  await associatedError(roster.getByLabel('Work email'), 'Enter a valid work email address.');
  await axe(page);
  await roster.getByLabel('Name', { exact: true }).fill('Demo recipient');
  await expect(roster.getByLabel('Name', { exact: true })).not.toHaveAttribute('aria-describedby');
  await roster.getByRole('button', { name: 'Add to roster' }).click();
  await expect(roster.getByLabel('Work email')).toBeFocused();
  await roster.getByRole('button', { name: 'Cancel', exact: true }).click();
  const composer = page.getByRole('group', { name: 'The notification composer', exact: true });
  await composer.getByLabel('To', { exact: true }).selectOption({ index: 1 });
  await composer.getByLabel('Subject').fill('');
  await composer.getByLabel('Message').fill(' ');
  await composer.getByRole('button', { name: /^Send to / }).click();
  await expect(composer.getByLabel('Subject')).toBeFocused();
  await associatedError(composer.getByLabel('Subject'), 'A subject is required.');
  await associatedError(composer.getByLabel('Message'), 'A message is required.');
  await axe(page);
  await composer.getByLabel('Subject').fill('Demo subject');
  await expect(composer.getByLabel('Subject')).not.toHaveAttribute('aria-describedby');
  await composer.getByRole('button', { name: /^Send to / }).click();
  await expect(composer.getByLabel('Message')).toBeFocused();
  await composer.getByLabel('Message').fill('Demo message');
  for (const channel of await composer.getByRole('checkbox').all()) await channel.uncheck();
  await composer.getByRole('button', { name: /^Send to / }).click();
  await expect(composer.getByRole('checkbox').first()).toBeFocused();
  await associatedError(
    composer.getByRole('checkbox').first(),
    'Select at least one configured channel.',
  );
  await axe(page);
  await composer.getByRole('checkbox').first().check();
  await expect(composer.getByRole('checkbox').first()).not.toHaveAttribute('aria-describedby');
  await expect(page.getByText('Sent this session · 0')).toBeVisible();
  await navigate(page, 'Action Center');
  await page.getByLabel('High value (USD)', { exact: true }).fill('');
  await page.getByLabel('Stale days (calendar)', { exact: true }).fill('0');
  await page.getByRole('button', { name: 'Apply demo policy' }).click();
  const first = page.getByLabel('High value (USD)', { exact: true });
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('aria-invalid', 'true');
  await axe(page);
  await first.fill('400000');
  await expect(first).not.toHaveAttribute('aria-describedby');
  await expect(page.getByText('85 unique items', { exact: true })).toBeVisible();
});
