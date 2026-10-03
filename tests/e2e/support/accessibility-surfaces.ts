import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  FISCAL_PHASE_META,
  FORECAST_CATEGORIES,
  FORECAST_CATEGORY_META,
  MEETING_TYPES,
  MEETING_TYPE_META,
  SNAPSHOT_DATE,
} from '../../../src/data/constants';
import type { WeeklySeriesRow } from '../../../src/data/DataProvider';
import type { FiscalPhase } from '../../../src/data/types';
import { formatDate, formatUsd } from '../../../src/lib/format';
import type { QuarterRevenueRow, WeeklyActivityRow } from '../../../src/lib/metrics';

export const MANAGERS = [
  { id: 'pm-01', name: 'Alex Morgan', table: 'DT-008', disclosure: 'DS-001' },
  { id: 'pm-02', name: 'Jordan Lee', table: 'DT-009', disclosure: 'DS-002' },
  { id: 'pm-03', name: 'Taylor Chen', table: 'DT-010', disclosure: 'DS-003' },
  { id: 'pm-04', name: 'Casey Rivera', table: 'DT-011', disclosure: 'DS-004' },
  { id: 'pm-05', name: 'Riley Patel', table: 'DT-012', disclosure: 'DS-005' },
] as const;

export async function settle(page: Page) {
  await expect(page.getByText(/^Loading /)).toHaveCount(0);
  await expect(page.getByText(/^Refreshing/)).toHaveCount(0);
}

export async function navigate(page: Page, label: string) {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  if (!(await nav.isVisible())) {
    await page.getByRole('button', { name: 'Open navigation menu', exact: true }).click();
  }
  const button = nav.getByRole('button', { name: label, exact: true });
  const alreadyCurrent = (await button.getAttribute('aria-current')) === 'page';
  await button.focus();
  await page.keyboard.press('Enter');
  if (!alreadyCurrent) await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await settle(page);
}

export function observe(page: Page) {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  return () => {
    expect(errors).toEqual([]);
    expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
    expect(requests.some((url) => /@vite\/client|hot-update/.test(url))).toBe(false);
    expect(requests.some((url) => /\/assets\/.*-[\w-]+\.js/.test(url))).toBe(true);
  };
}

export function card(page: Page, name: string | RegExp) {
  return page
    .getByRole('heading', { name, level: 2, exact: typeof name === 'string' })
    .locator('xpath=ancestor::section[1]');
}

export async function axe(page: Page, testInfo: TestInfo, state: string, include?: string) {
  const builder = new AxeBuilder({ page });
  const result = await (include ? builder.include(include) : builder).analyze();
  await testInfo.attach(`axe-${state}`, {
    body: JSON.stringify({ state, url: page.url(), violations: result.violations }),
    contentType: 'application/json',
  });
  // A violation still fails the test, but does not silently prevent the rest
  // of this closed inventory from being exercised and recorded.
  expect.soft(result.violations, state).toEqual([]);
}

export async function evidence(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
}

export async function activate(control: Locator, method: 'Enter' | 'Space' | 'click' | 'touch') {
  if (method === 'click') await control.click();
  else if (method === 'touch') await control.tap();
  else {
    await control.focus();
    await control.page().keyboard.press(method);
  }
}

export async function toggle(
  control: Locator,
  content: Locator,
  method: 'Enter' | 'Space' | 'click' | 'touch',
  retainFocus = true,
) {
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(content).toBeHidden();
  await activate(control, method);
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await expect(content).toBeVisible();
  if (retainFocus && (method === 'Enter' || method === 'Space'))
    await expect(control).toBeFocused();
  await activate(control, method);
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(content).toBeHidden();
}

export async function nativeDetails(
  summary: Locator,
  method: 'Enter' | 'Space' | 'click' | 'touch',
) {
  const details = summary.locator('..');
  const content = details.locator(':scope > :not(summary)');
  await expect(details).not.toHaveAttribute('open');
  await expect(content).toBeHidden();
  await activate(summary, method);
  await expect(details).toHaveAttribute('open', '');
  await expect(content).toBeVisible();
  if (method === 'Enter' || method === 'Space') await expect(summary).toBeFocused();
  await activate(summary, method);
  await expect(details).not.toHaveAttribute('open');
  await expect(content).toBeHidden();
}

export async function selectChip(page: Page, group: string, label: string, description?: string) {
  const chips = page.getByRole('group', { name: group, exact: true });
  const button = chips.getByRole('button', { name: label, exact: true });
  await button.focus();
  await page.keyboard.press('Enter');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await expect(chips.locator('button[aria-pressed="true"]')).toHaveCount(1);
  if (description !== undefined) await expect(chips.locator(':scope > p')).toHaveText(description);
  await settle(page);
}

export function phaseDescription(phase: FiscalPhase) {
  return FISCAL_PHASE_META[phase].description;
}

export async function metric(
  page: Page,
  title: string,
  expected: { label: string; displayValue: string; value: number; secondary?: string }[],
) {
  const figure = card(page, title).getByRole('figure', { name: 'Metric breakdown', exact: true });
  await expect(figure.locator('figcaption')).toContainText('Dollar values are USD');
  await expect(figure.locator('figcaption')).toContainText('Days are calendar days unless marked');
  await expect(figure.getByRole('listitem')).toHaveCount(expected.length);
  const actual = await figure.getByRole('listitem').evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.children)
        .filter((element) => element.getAttribute('aria-hidden') !== 'true')
        .map((element) => element.textContent!.replace(/\s+/g, ' ').trim()),
    ),
  );
  expect(actual, title).toEqual(
    expected.map((row) => [
      row.label,
      row.displayValue === '—'
        ? '— No data'
        : row.displayValue.startsWith('$')
          ? `${row.displayValue} (${row.value} USD)`
          : row.displayValue,
      ...(row.secondary === undefined ? [] : [row.secondary]),
    ]),
  );
  for (const row of expected) {
    await expect(figure.getByText(row.label, { exact: true })).toBeVisible();
  }
}

async function chartTable(
  page: Page,
  name: string,
  headers: string[],
  expected: (string | number)[][],
) {
  const figure = page.getByRole('figure', { name, exact: true });
  await expect(figure).toHaveCount(1);
  await expect(figure.locator('figcaption')).not.toBeEmpty();
  const details = figure.locator('details');
  const summary = figure.locator('summary');
  await expect(summary).toHaveAttribute('aria-label', `View chart data: ${name}`);
  if (!(await details.getAttribute('open')) && (await details.getAttribute('open')) !== '') {
    await summary.focus();
    await page.keyboard.press('Enter');
  }
  const table = figure.getByRole('table', { name: `${name} data`, exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole('columnheader')).toHaveText(headers);
  await expect(table.locator('thead th:not([scope="col"])')).toHaveCount(0);
  await expect(table.locator('tbody th:not([scope="row"])')).toHaveCount(0);
  const actual = await table
    .locator('tbody tr')
    .evaluateAll((rows) =>
      rows.map((row) =>
        Array.from(row.children).map((cell) => cell.textContent!.replace(/\s+/g, ' ').trim()),
      ),
    );
  expect(actual, name).toEqual(expected.map((row) => row.map(String)));
  const region = figure.getByRole('region', { name: `${name} data`, exact: true });
  await expect(region).toHaveAttribute('tabindex', '0');
  // Include every bucket, zero category and target in the accessibility tree.
  const tree = await table.ariaSnapshot();
  for (const header of headers) expect(tree).toContain(header);
  for (const row of expected) expect(tree).toContain(String(row[0]));
  return actual;
}

export async function activity(page: Page, rows: WeeklyActivityRow[]) {
  expect(rows).toHaveLength(8);
  return chartTable(
    page,
    'Weekly partner activity',
    [
      'Week',
      'Total meetings',
      ...MEETING_TYPES.map((type) => `${MEETING_TYPE_META[type].fullLabel} (meetings)`),
    ],
    rows.map((row, index) => [
      `${formatDate(row.weekStart)}–${formatDate(row.weekEnd)}${index === 7 ? ' · This week' : ''}`,
      row.total,
      ...MEETING_TYPES.map((type) => row.byType[type] ?? 0),
    ]),
  );
}

export async function revenue(page: Page, rows: QuarterRevenueRow[]) {
  expect(rows).toHaveLength(4);
  return chartTable(
    page,
    'Quarterly revenue vs. target',
    ['Quarter', 'Closed-won (USD)', 'Target (USD)'],
    rows.map((row) => [row.quarter, formatUsd(row.closedWon), formatUsd(row.target)]),
  );
}

export async function progress(
  page: Page,
  name: string,
  value: number,
  goal: number,
  missing = false,
) {
  const figure = page.getByRole('figure', { name, exact: true });
  const summary = missing
    ? 'No certification data'
    : goal <= 0
      ? 'No goal set'
      : `${value} of ${goal}; ${Math.round((value / goal) * 100)}% of goal. ${
          value > goal ? 'Goal exceeded' : value === goal ? 'Goal reached' : 'Below goal'
        }`;
  await expect(figure.locator('figcaption')).toHaveText(summary);
  const bar = figure.getByRole('progressbar');
  if (goal <= 0 || missing) await expect(bar).toHaveCount(0);
  else {
    await expect(bar).toHaveAttribute('aria-valuenow', String(Math.min(value, goal)));
    await expect(bar).toHaveAttribute('aria-valuemax', String(goal));
    await expect(bar).toHaveAttribute('aria-valuemin', '0');
    await expect(bar).toHaveAttribute('aria-valuetext', summary);
    await expect(figure).toContainText(`${value}/${goal}`);
  }
}

function wow(delta: number | null) {
  if (delta === null) return 'first week';
  const rounded = Math.round(delta);
  return rounded === 0
    ? 'flat WoW'
    : `${rounded > 0 ? '+' : '−'}${formatUsd(Math.abs(rounded))} WoW`;
}

export async function weekly(page: Page, rows: WeeklySeriesRow[], goal?: number) {
  let previous: WeeklySeriesRow | undefined;
  const expected = rows.map((row) => {
    const source = !row.hasStarted
      ? "Hasn't started yet"
      : row.recordedAt
        ? `Snapshot recorded ${formatDate(row.recordedAt)}`
        : new Date(row.weekStart) <= SNAPSHOT_DATE && new Date(row.weekEnd) > SNAPSHOT_DATE
          ? 'Live book · moves with session edits'
          : 'Reconstructed from current book';
    const values = row.hasStarted
      ? [
          ...FORECAST_CATEGORIES.flatMap((category) => [
            formatUsd(row.raw[category]),
            formatUsd(row.weighted[category]),
          ]),
          formatUsd(row.total),
          formatUsd(row.weightedTotal),
          wow(previous ? row.total - previous.total : null),
          wow(previous ? row.weightedTotal - previous.weightedTotal : null),
        ]
      : Array<string>(12).fill('Not started');
    if (row.hasStarted) previous = row;
    return [
      `${formatDate(row.weekStart)}–${formatDate(row.weekEnd)}`,
      source,
      ...values,
      ...(goal === undefined ? [] : [formatUsd(goal)]),
    ];
  });
  const actual = await chartTable(
    page,
    'Week-over-week pipeline',
    [
      'Week (end exclusive)',
      'Source / state',
      ...FORECAST_CATEGORIES.flatMap((category) => [
        `${FORECAST_CATEGORY_META[category].label} raw (USD)`,
        `${FORECAST_CATEGORY_META[category].label} weighted (USD)`,
      ]),
      'Total pipeline (USD)',
      'Weighted forecast (USD)',
      'Total pipeline WoW (USD)',
      'Weighted forecast WoW (USD)',
      ...(goal === undefined ? [] : ['Revenue goal (USD)']),
    ],
    expected,
  );
  await expect(
    page.getByRole('figure', { name: 'Week-over-week pipeline' }).locator('figcaption'),
  ).toContainText(
    goal === undefined ? 'Revenue goal unavailable.' : `Revenue goal ${formatUsd(goal)}`,
  );
  return actual;
}

export async function noOverflow(page: Page) {
  expect
    .soft(
      await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: innerWidth,
      })),
    )
    .toEqual({
      document: page.viewportSize()!.width,
      body: page.viewportSize()!.width,
      viewport: page.viewportSize()!.width,
    });
}

export async function reachable(control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  await control.page().keyboard.press('Tab');
  await control.page().keyboard.press('Shift+Tab');
  await expect(control).toBeFocused();
  const result = await control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      visible: element.matches(':focus-visible'),
      outline: style.outlineStyle,
      unobscured: point === element || element.contains(point),
      inViewport:
        rect.left >= 0 && rect.right <= innerWidth && rect.top >= 64 && rect.bottom <= innerHeight,
    };
  });
  expect
    .soft(
      result,
      `Focused control: ${(await control.getAttribute('aria-label')) ?? (await control.innerText())}`,
    )
    .toEqual({
      visible: true,
      outline: 'solid',
      unobscured: true,
      inViewport: true,
    });
}

export async function dense(page: Page, region: Locator, id: string) {
  await expect(region).toHaveAttribute('tabindex', '0');
  await expect(region).toHaveAttribute('aria-label', /.+, scrollable$/);
  const table = region.getByRole('table');
  await expect(table).toHaveCount(1);
  const headers = table.locator('thead th');
  expect(await headers.count(), id).toBeGreaterThan(0);
  await expect(table.locator('thead th:not([scope="col"])')).toHaveCount(0);
  await expect(table.locator('tbody th:not([scope="rowgroup"])')).toHaveCount(0);
  const headerNames = await headers.allTextContents();
  const shape = await table.evaluate((element) => {
    const columns = element.querySelectorAll('thead th').length;
    return Array.from(element.querySelectorAll('tbody tr')).map((row) => {
      // A continuation row inherits the client rowgroup header via rowspan.
      const count = Array.from(row.children).reduce(
        (total, cell) => total + ((cell as HTMLTableCellElement).colSpan || 1),
        0,
      );
      return count === columns || (count === columns - 1 && columns === 4);
    });
  });
  expect(shape.every(Boolean), `${id}: native table header coverage`).toBe(true);
  await region.evaluate((element) => {
    element.scrollLeft = 0;
    element.scrollTop = 0;
  });
  await region.scrollIntoViewIfNeeded();
  await region.focus();
  await expect(region).toBeFocused();
  const before = await region.evaluate((element) => element.scrollLeft);
  for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowRight');
  const dimensions = await region.evaluate((element) => ({
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    client: element.clientWidth,
    scroll: element.scrollWidth,
    offset: element.scrollLeft,
  }));
  expect.soft(dimensions.left, id).toBeGreaterThanOrEqual(0);
  expect.soft(dimensions.right, id).toBeLessThanOrEqual(page.viewportSize()!.width);
  if (dimensions.scroll > dimensions.client) expect(dimensions.offset, id).toBeGreaterThan(before);
  // Finish the scroll without a pointer drag, then wait for the browser's
  // keyboard-scroll animation to settle before measuring the final label.
  await region.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect
    .poll(() =>
      region.evaluate((element) => element.scrollWidth - element.clientWidth - element.scrollLeft),
    )
    .toBeLessThanOrEqual(1);
  const final = headers.last();
  expect(await final.innerText(), id).toBeTruthy();
  // Measure the label, not the cell's trailing padding or subpixel border.
  const finalBounds = await region.evaluate((element) => {
    const header = Array.from(element.querySelectorAll('thead th')).at(-1)!;
    const range = document.createRange();
    range.selectNodeContents(header);
    const rect = range.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      regionRight: element.getBoundingClientRect().right,
    };
  });
  expect
    .soft(finalBounds.right, `${id}: final header must not be clipped`)
    .toBeLessThanOrEqual(finalBounds.regionRight + 1);
  const rowValues = await table.locator('tbody tr').allTextContents();
  expect(
    rowValues.every((text) => text.trim().length > 0),
    id,
  ).toBe(true);
  await noOverflow(page);
  return { id, headerNames, rows: rowValues.length, dimensions };
}
