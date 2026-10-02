import {
  expect,
  test,
  type ElementHandle,
  type Locator,
  type Page as BrowserPage,
} from '@playwright/test';
import { INTERNAL_DEMO_SCOPE } from '../../src/data/accessScope';
import { CURRENT_FISCAL_QUARTER } from '../../src/data/constants';
import type { Page, PageRequest } from '../../src/data/DataProvider';
import { MockDataProvider } from '../../src/data/mock/MockDataProvider';
import { ScaleDataProvider } from '../../src/data/mock/ScaleDataProvider';
import type { QueryResult } from '../../src/data/queryMetadata';
import type { ActivityMeeting, DealRegistration, Opportunity } from '../../src/data/types';
import { DEFAULT_ACTION_POLICY } from '../../src/lib/actionPolicy';
import { formatDate, formatTime } from '../../src/lib/format';
import type { DuplicateRegistrationGroup } from '../../src/lib/metrics';
import {
  MANAGERS,
  card,
  evidence,
  navigate,
  selectChip,
  settle,
} from './support/accessibility-surfaces';

// VAL-A11Y-010's closed inventory is PG-001..015, including five independent
// manager books and the calendar. Oracles run in the test process; the browser
// uses only the existing provider selector, scoped queries and session editors.
// Build the production preview with VITE_LOG_LEVEL=debug for seam call counts.
test.setTimeout(120_000);
const provider = new MockDataProvider();
const access = INTERNAL_DEMO_SCOPE;

function observePagination(page: BrowserPage) {
  const started: string[] = [];
  const failed: string[] = [];
  const unexpected: string[] = [];
  const pageErrors: string[] = [];
  const requests: string[] = [];
  const pending: Promise<void>[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => {
    pending.push(
      (async () => {
        let providerFailure = false;
        for (const argument of message.args()) {
          const value: unknown = await argument.jsonValue();
          if (typeof value !== 'object' || value === null) continue;
          const record = value as Record<string, unknown>;
          if (record.component !== 'DataProvider' || typeof record.operation !== 'string') continue;
          if (record.msg === 'Provider request started') started.push(record.operation);
          if (record.msg === 'Provider request failed') {
            failed.push(record.operation);
            providerFailure = true;
          }
        }
        if (message.type() === 'error' && !providerFailure) unexpected.push(message.text());
      })().catch((error: unknown) => {
        unexpected.push(`Unable to read structured console record: ${String(error)}`);
      }),
    );
  });
  return {
    started,
    async flush() {
      await Promise.all(pending);
    },
    async count(method: string) {
      await this.flush();
      return started.filter((operation) => operation === method).length;
    },
    async check(expectedFailures: string[] = []) {
      await this.flush();
      expect(pageErrors).toEqual([]);
      expect(unexpected).toEqual([]);
      expect(failed.sort()).toEqual([...expectedFailures].sort());
      expect(started.length, 'Production preview requires VITE_LOG_LEVEL=debug').toBeGreaterThan(0);
      const origin = new URL(page.url()).origin;
      expect(requests.filter((url) => new URL(url).origin !== origin)).toEqual([]);
      expect(
        requests.filter((url) => /\/@vite\/client|\/@react-refresh|hot-update/.test(url)),
      ).toEqual([]);
      expect(requests.some((url) => /\/assets\/.*-[\w-]+\.js/.test(url))).toBe(true);
    },
  };
}

type Observations = ReturnType<typeof observePagination>;

async function boot(page: BrowserPage, observations: Observations, plan = '', source = 'remote') {
  // A present, empty named plan is deterministic zero-failure remote mode.
  // remoteFailFirst=0 currently falls through to the random failure profile.
  await page.goto(`/?remoteFailMethods=${encodeURIComponent(plan)}`);
  await settle(page);
  await navigate(page, 'Production Requirements');
  await page.getByLabel('Data provider').selectOption(source);
  await expect(page.getByLabel('Data provider')).toHaveValue(source);
  await expect.poll(() => page.evaluate(() => window.GTM_HEALTH?.artifact.providerId)).toBe(source);
  await settle(page);
  await observations.flush();
}

async function collect<T>(
  query: (page: PageRequest) => Promise<QueryResult<Page<T>>>,
): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | undefined;
  do {
    const answer = await query({ limit: 100, ...(cursor === undefined ? {} : { cursor }) });
    rows.push(...answer.data.rows);
    cursor = answer.data.nextCursor;
    expect(rows.length).toBeLessThanOrEqual(answer.data.totalCount);
    if (cursor === undefined) expect(rows).toHaveLength(answer.data.totalCount);
  } while (cursor !== undefined);
  return rows;
}

interface Collection {
  id: string;
  noun: string;
  method: string;
  pageSize: number;
  total: number;
  countNoun?: boolean;
  buttonLabel?: string;
  instant?: boolean;
  root: Locator;
  keys: () => Promise<string[]>;
  expectedKeys: (count: number) => string[];
}

function footer(collection: Collection) {
  return collection.root.getByRole('group', { name: `${collection.noun} pagination`, exact: true });
}

function countLabel(collection: Collection, loaded: number) {
  return `Showing ${loaded} of ${collection.total}${collection.countNoun === false ? '' : ` ${collection.noun}`}`;
}

async function assertRows(collection: Collection, loaded: number) {
  const status = footer(collection).getByRole('status');
  await expect(status).toHaveAttribute('aria-atomic', 'true');
  await expect(status.locator(':scope > span').first()).toHaveText(countLabel(collection, loaded));
  const keys = await collection.keys();
  expect(keys, `${collection.id}: every loaded row matches its scoped provider answer`).toEqual(
    collection.expectedKeys(loaded),
  );
  expect(new Set(keys).size, `${collection.id}: rows are unique`).toBe(keys.length);
}

async function sameButton(
  collection: Collection,
  original: ElementHandle<SVGElement | HTMLElement> | null,
) {
  const button = footer(collection).getByRole('button');
  await expect(button).toHaveCount(1);
  expect(original).not.toBeNull();
  expect(await button.evaluate((element, prior) => element === prior, original!)).toBe(true);
  await expect(button).toBeFocused();
}

async function onlyMethod(observations: Observations, before: number, method: string) {
  await observations.flush();
  expect(observations.started.slice(before)).toEqual([method]);
}

async function activateTwice(
  page: BrowserPage,
  button: Locator,
  key: 'Enter' | 'Space',
  instant = false,
) {
  await button.focus();
  const element = await button.elementHandle();
  if (!instant) await page.keyboard.press(key);
  // Both clicks occur in the same JS task. This probes the synchronous
  // in-flight guard, not just Playwright's disabled/actionability waiting.
  await element!.evaluate((element) => {
    (element as HTMLButtonElement).click();
    (element as HTMLButtonElement).click();
  });
}

async function endpoint(
  page: BrowserPage,
  observations: Observations,
  collection: Collection,
  loaded: number,
) {
  await assertRows(collection, loaded);
  const group = footer(collection);
  await expect(group.getByRole('status')).toContainText('end of results');
  const button = group.getByRole('button', {
    name: collection.buttonLabel ?? `Load ${collection.pageSize} more`,
    exact: true,
  });
  const original = await button.elementHandle();
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  // aria-disabled keeps the endpoint in the keyboard order and focused.
  await expect(button).not.toHaveAttribute('disabled');
  await button.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(button).toBeFocused();
  await observations.flush();
  const before = observations.started.length;
  const retained = await collection.keys();
  await activateTwice(page, button, 'Enter');
  await page.keyboard.press('Space');
  // A round trip is 250 ms: retain a bounded observation window so even an
  // incorrectly deferred request would be visible in the seam logs.
  await page.waitForTimeout(350);
  await observations.flush();
  expect(
    observations.started.slice(before),
    `${collection.id}: exhausted activation is a no-op`,
  ).toEqual([]);
  expect(await collection.keys()).toEqual(retained);
  await sameButton(collection, original);
}

async function nextPage(
  page: BrowserPage,
  observations: Observations,
  collection: Collection,
  loaded: number,
  fail = false,
) {
  const group = footer(collection);
  const button = group.getByRole('button');
  await expect(button).toHaveAccessibleName(
    collection.buttonLabel ?? `Load ${collection.pageSize} more`,
  );
  await expect(button).toHaveAttribute('aria-disabled', 'false');
  await assertRows(collection, loaded);
  const original = await button.elementHandle();
  const retained = await collection.keys();
  await observations.flush();
  let before = observations.started.length;
  await activateTwice(page, button, 'Enter', collection.instant);
  // The local/scaled providers resolve on microtasks, so they promise no
  // observable busy frame. The remote cases assert the complete busy-state
  // contract; scaled cases still assert exact call counts, focus and rows.
  if (!collection.instant) {
    await expect(group.getByRole('status')).toContainText(`Loading more ${collection.noun}`);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(button).toHaveText('Loading…');
    expect(await collection.keys()).toEqual(retained);
    await expect(button).toBeFocused();
  }
  if (fail) {
    await expect(group.getByRole('status')).toContainText(`${collection.noun} failed:`);
    await expect(button).toHaveAccessibleName(`Retry ${collection.noun}`);
    await expect(button).toHaveAttribute('aria-disabled', 'false');
    await assertRows(collection, loaded);
    expect(await collection.keys()).toEqual(retained);
    await expect(button).toBeFocused();
    expect(await button.evaluate((element, prior) => element === prior, original!)).toBe(true);
    await onlyMethod(observations, before, collection.method);
    before = observations.started.length;
    await activateTwice(page, button, 'Space');
    await expect(group.getByRole('status')).toContainText(`Loading more ${collection.noun}`);
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(await collection.keys()).toEqual(retained);
    await expect(button).toBeFocused();
  }
  const next = Math.min(loaded + collection.pageSize, collection.total);
  await expect(group.getByRole('status').locator(':scope > span').first()).toHaveText(
    countLabel(collection, next),
  );
  await expect(group.getByRole('status')).not.toContainText(/Loading more|failed:/);
  await assertRows(collection, next);
  await expect(button).toHaveAccessibleName(
    collection.buttonLabel ?? `Load ${collection.pageSize} more`,
  );
  await expect(button).toHaveAttribute('aria-disabled', String(next === collection.total));
  await expect(button).toBeFocused();
  expect(await button.evaluate((element, prior) => element === prior, original!)).toBe(true);
  await onlyMethod(observations, before, collection.method);
  return next;
}

async function walk(
  page: BrowserPage,
  observations: Observations,
  collection: Collection,
  failFirstPage = false,
) {
  let loaded = Math.min(collection.pageSize, collection.total);
  await assertRows(collection, loaded);
  while (loaded < collection.total) {
    loaded = await nextPage(page, observations, collection, loaded, failFirstPage);
    failFirstPage = false;
  }
  await endpoint(page, observations, collection, loaded);
}

type TableKind = 'opportunities' | 'queue' | 'history' | 'exclusivity' | 'partners';

function tableKeys(root: Locator, kind: TableKind, showPartner = true) {
  return () =>
    root.locator('tbody tr').evaluateAll(
      (rows, options) =>
        rows
          .filter((row) => row.querySelectorAll('td').length > 1)
          .map((row) => {
            const cells = Array.from(row.querySelectorAll('td'));
            const text = (index: number, paragraph = false) =>
              (
                (paragraph ? cells[index].querySelector('p') : cells[index])?.textContent ?? ''
              ).trim();
            if (options.kind === 'partners') return text(1, true);
            if (options.kind === 'opportunities')
              return [text(0, true), text(1), text(4)].join('|');
            if (options.kind === 'history') return [text(0, true), text(2)].join('|');
            const account = text(0, options.kind === 'queue');
            return [
              account,
              ...(options.showPartner ? [text(1)] : []),
              text(options.showPartner ? 3 : 2),
            ].join('|');
          }),
      { kind, showPartner },
    );
}

function opportunityKeys(rows: Opportunity[]) {
  return rows.map((row) =>
    [
      row.accountName,
      row.factoryAccountDirector,
      formatDate(row.closedAt ?? row.expectedCloseDate),
    ].join('|'),
  );
}

function registrationKeys(
  rows: DealRegistration[],
  kind: 'queue' | 'history' | 'exclusivity',
  names: Map<string, string>,
  showPartner = true,
) {
  return rows.map((row) =>
    [
      row.accountName,
      ...(kind !== 'history' && showPartner ? [names.get(row.partnerId) ?? row.partnerId] : []),
      kind === 'exclusivity'
        ? row.decisionAt
          ? formatDate(row.decisionAt)
          : '—'
        : formatDate(row.submittedAt),
    ].join('|'),
  );
}

async function registrationNames() {
  const roster = await provider.getPartnerRoster(access, {});
  return new Map(roster.data.map((partner) => [partner.id, partner.name]));
}

test('VAL-A11Y-010 PG-001: Partner Performance pipeline retains rows and the focused node through page failure, retry, loading and exhaustion', async ({
  page,
}, testInfo) => {
  const observations = observePagination(page);
  const rows = await collect((request) =>
    provider.listScopedOpportunities(access, { phase: 'q3', partnerFilter: 'roster' }, request),
  );
  expect(rows.length).toBeGreaterThan(25);
  await boot(page, observations, 'listScopedOpportunities:1:1');
  await navigate(page, 'Partner Performance');
  const collection: Collection = {
    id: 'PG-001',
    noun: 'opportunities',
    method: 'listScopedOpportunities',
    pageSize: 25,
    total: rows.length,
    countNoun: false,
    root: card(page, /^Pipeline opportunities/),
    keys: tableKeys(card(page, /^Pipeline opportunities/), 'opportunities'),
    expectedKeys: (count) => opportunityKeys(rows.slice(0, count)),
  };
  await walk(page, observations, collection, true);
  await page.getByRole('combobox', { name: 'Partner manager', exact: true }).selectOption('pm-01');
  await settle(page);
  const scoped = await collect((request) =>
    provider.listScopedOpportunities(
      access,
      { phase: 'q3', partnerManagerId: 'pm-01', partnerFilter: 'roster' },
      request,
    ),
  );
  collection.total = scoped.length;
  collection.expectedKeys = (count) => opportunityKeys(scoped.slice(0, count));
  await walk(page, observations, collection);
  await evidence(testInfo, 'PG-001-pagination', {
    total: rows.length,
    managerTotal: scoped.length,
  });
  await observations.check(['listScopedOpportunities']);
});

test('VAL-A11Y-010 PG-002: leaderboard endpoint stays keyboard reachable and scaled pages append unique partners with scoped counts', async ({
  page,
}, testInfo) => {
  const observations = observePagination(page);
  await boot(page, observations, 'listPartnerLeaderboard:1');
  await navigate(page, 'Partner Performance');
  const ranking = card(page, 'Partner leaderboard & enablement');
  const retry = ranking.getByRole('button', { name: 'Retry partner leaderboard', exact: true });
  await expect(retry).toBeVisible();
  await observations.flush();
  const before = observations.started.length;
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(ranking.getByText(/^Loading /)).toBeVisible();
  await expect(
    ranking.getByRole('group', { name: 'partner leaderboard', exact: true }),
  ).toBeFocused();
  await expect(
    ranking.getByRole('group', { name: 'partners pagination', exact: true }),
  ).toBeVisible();
  await onlyMethod(observations, before, 'listPartnerLeaderboard');
  const rows = await collect((request) =>
    provider.listPartnerLeaderboard(access, { phase: 'q3', partnerFilter: 'roster' }, request),
  );
  const collection: Collection = {
    id: 'PG-002',
    noun: 'partners',
    method: 'listPartnerLeaderboard',
    pageSize: 25,
    total: rows.length,
    root: card(page, 'Partner leaderboard & enablement'),
    keys: tableKeys(card(page, 'Partner leaderboard & enablement'), 'partners'),
    expectedKeys: (count) => rows.slice(0, count).map((row) => row.partner.name),
  };
  await walk(page, observations, collection);
  await navigate(page, 'Production Requirements');
  await page.getByLabel('Data provider').selectOption('scaled');
  await expect
    .poll(() => page.evaluate(() => window.GTM_HEALTH?.artifact.providerId))
    .toBe('scaled');
  await navigate(page, 'Partner Performance');
  const scaled = new ScaleDataProvider();
  const answer = await scaled.listPartnerLeaderboard(
    access,
    { phase: 'q3', partnerFilter: 'roster' },
    { limit: 50 },
  );
  collection.total = answer.data.totalCount;
  collection.instant = true;
  collection.expectedKeys = (count) =>
    answer.data.rows.slice(0, count).map((row) => row.partner.name);
  await nextPage(page, observations, collection, 25);
  // Do not walk 2,500 partners to prove a shared 25-row append. A genuine
  // one-partner scope provides the scaled provider's endpoint instead.
  await page
    .getByRole('combobox', { name: 'Partner', exact: true })
    .selectOption(answer.data.rows[0].partner.id);
  await settle(page);
  collection.total = 1;
  collection.expectedKeys = () => [answer.data.rows[0].partner.name];
  await endpoint(page, observations, collection, 1);
  await evidence(testInfo, 'PG-002-pagination', {
    baseTotal: rows.length,
    scaledTotal: answer.data.totalCount,
    loaded: 50,
    scopedTotal: 1,
  });
  await observations.check(['listPartnerLeaderboard']);
});

async function refreshManager(
  page: BrowserPage,
  observations: Observations,
  collection: Collection,
  loaded: number,
  fail: boolean,
) {
  const rows = collection.root.locator('tr[data-opportunity-id]');
  const row = rows.first();
  const originalRows = await collection.keys();
  const button = footer(collection).getByRole('button');
  const original = await button.elementHandle();
  await row.getByRole('button', { name: /^Edit revenue forecast for / }).click();
  const input = row.getByRole('textbox', { name: /^Revenue forecast for / });
  const value = Number(await input.inputValue()) + 1;
  await input.fill(String(value));
  const before = await observations.count(collection.method);
  // Save through the public editor, then put focus on the already-mounted
  // footer while the real remote refresh runs; no provider injection.
  await row.getByRole('button', { name: 'Save revenue', exact: true }).click();
  await button.focus();
  const busyActivation = await button.evaluate((element) => {
    const busy = element.getAttribute('aria-disabled') === 'true';
    if (busy) {
      (element as HTMLButtonElement).click();
      (element as HTMLButtonElement).click();
    }
    return busy;
  });
  expect(busyActivation).toBe(true);
  await expect(footer(collection).getByRole('status')).toContainText(`Updating ${collection.noun}`);
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  expect(await collection.keys()).toEqual(originalRows);
  await expect(button).toBeFocused();
  if (fail) {
    await expect(footer(collection).getByRole('status')).toContainText(
      `${collection.noun} failed:`,
    );
    await expect(button).toHaveAccessibleName(`Retry ${collection.noun}`);
    await assertRows(collection, loaded);
    expect(await collection.keys()).toEqual(originalRows);
    await expect(button).toBeFocused();
    expect(await observations.count(collection.method)).toBe(before + 1);
    await activateTwice(page, button, 'Space');
    await expect(footer(collection).getByRole('status')).toContainText(
      `Updating ${collection.noun}`,
    );
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(await collection.keys()).toEqual(originalRows);
  }
  await expect(footer(collection).getByRole('status')).not.toContainText(/Updating|failed:/);
  await assertRows(collection, loaded);
  await expect(button).toBeFocused();
  expect(await button.evaluate((element, prior) => element === prior, original!)).toBe(true);
  expect(await observations.count(collection.method)).toBe(before + (fail ? 2 : 1));
}

for (const [index, manager] of MANAGERS.entries()) {
  const id = `PG-${String(index + 3).padStart(3, '0')}`;
  test(`VAL-A11Y-010 ${id}: ${manager.name} (${manager.id}) book preserves unique pages, focus, refresh failure and retry independently`, async ({
    page,
  }, testInfo) => {
    const observations = observePagination(page);
    const rows = await collect((request) =>
      provider.listQuarterOpportunities(
        access,
        { quarter: CURRENT_FISCAL_QUARTER, partnerManagerId: manager.id },
        request,
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    // Alex opens by default. Opening another manager consumes one successful
    // listQuarterOpportunities call before that manager's first page.
    const initialCalls = index === 0 ? 1 : 2;
    const pages = Math.ceil(rows.length / 25);
    // If the base book fits one page, fail a relevant edit-driven refresh.
    // Otherwise fail page two; a separate successful edit then proves refresh.
    const plan = `listQuarterOpportunities:${initialCalls}:1`;
    await boot(page, observations, plan);
    await navigate(page, 'Forecasting');
    const disclosure = page.getByRole('button', {
      name: `${manager.name} opportunities`,
      exact: true,
    });
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
    const root = page.locator(`#manager-${manager.id}`);
    const collection: Collection = {
      id,
      noun: `manager book ${manager.id}`,
      method: 'listQuarterOpportunities',
      pageSize: 25,
      total: rows.length,
      countNoun: false,
      root,
      keys: () =>
        root
          .locator('tr[data-opportunity-id]')
          .evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('data-opportunity-id')!),
          ),
      expectedKeys: (count) => rows.slice(0, count).map((row) => row.id),
    };
    if (rows.length > 25) {
      await walk(page, observations, collection, true);
      await refreshManager(page, observations, collection, rows.length, false);
    } else {
      await endpoint(page, observations, collection, rows.length);
      await refreshManager(page, observations, collection, rows.length, true);
      await endpoint(page, observations, collection, rows.length);
    }
    const calls = await observations.count(collection.method);
    await disclosure.click();
    await expect(root).toBeHidden();
    await disclosure.click();
    await assertRows(collection, rows.length);
    expect(await observations.count(collection.method)).toBe(calls);
    await navigate(page, 'Action Center');
    await navigate(page, 'Forecasting');
    await assertRows(collection, rows.length);
    expect(await observations.count(collection.method)).toBe(calls);
    await evidence(testInfo, `${id}-pagination`, {
      manager: manager.id,
      total: rows.length,
      pages,
      refresh: rows.length > 25 ? 'success' : 'failure-retry',
    });
    // Each manager also has an actual second page on the UI's scaled book.
    // Cover one bounded append rather than walking hundreds of scaled pages;
    // the complete base-book walk above supplies that manager's endpoint.
    await navigate(page, 'Production Requirements');
    await page.getByLabel('Data provider').selectOption('scaled');
    await expect
      .poll(() => page.evaluate(() => window.GTM_HEALTH?.artifact.providerId))
      .toBe('scaled');
    await navigate(page, 'Forecasting');
    if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
    const scaled = new ScaleDataProvider();
    const answer = await scaled.listQuarterOpportunities(
      access,
      { quarter: CURRENT_FISCAL_QUARTER, partnerManagerId: manager.id },
      { limit: 50 },
    );
    collection.total = answer.data.totalCount;
    collection.instant = true;
    collection.expectedKeys = (count) => answer.data.rows.slice(0, count).map((row) => row.id);
    await nextPage(page, observations, collection, 25);
    const scaledCalls = await observations.count(collection.method);
    await disclosure.click();
    await disclosure.click();
    await assertRows(collection, 50);
    expect(await observations.count(collection.method)).toBe(scaledCalls);
    await evidence(testInfo, `${id}-scaled-pagination`, {
      manager: manager.id,
      total: collection.total,
      loaded: 50,
    });
    await observations.check(['listQuarterOpportunities']);
  });
}

const OPS_COLLECTIONS = [
  {
    id: 'PG-008',
    noun: 'pending',
    title: 'Registrations awaiting review',
    method: 'listPendingRegistrations',
    pageSize: 10,
    kind: 'queue',
  },
  {
    id: 'PG-009',
    noun: 'unconverted',
    title: 'Exclusivity window',
    method: 'listUnconvertedRegistrations',
    pageSize: 8,
    kind: 'exclusivity',
  },
  {
    id: 'PG-010',
    noun: 'duplicate groups',
    title: 'Duplicate & conflicting registrations',
    method: 'listDuplicateRegistrationGroups',
    pageSize: 8,
    kind: 'duplicates',
  },
] as const;

function duplicateKeys(groups: DuplicateRegistrationGroup[], names: Map<string, string>) {
  return groups.flatMap((group) =>
    group.registrations.map((row) =>
      [
        group.accountName,
        names.get(row.partnerId) ?? row.partnerId,
        formatDate(row.submittedAt),
      ].join('|'),
    ),
  );
}

function readDuplicateKeys(root: Locator) {
  return () =>
    root.locator('tbody').evaluateAll((groups) =>
      groups.flatMap((group) => {
        const account = group
          .querySelector('th[scope="rowgroup"]')
          ?.firstChild?.textContent?.trim();
        if (!account) return [];
        return Array.from(group.querySelectorAll('tr')).map((row) => {
          const cells = row.querySelectorAll('td');
          return [account, cells[0].textContent!.trim(), cells[1].textContent!.trim()].join('|');
        });
      }),
    );
}

for (const entry of OPS_COLLECTIONS) {
  test(`VAL-A11Y-010 ${entry.id}: Deal Reg Ops ${entry.noun} pagination names counts and retains every row through loading, failure, retry and end`, async ({
    page,
  }, testInfo) => {
    const observations = observePagination(page);
    const names = await registrationNames();
    const rows =
      entry.kind === 'duplicates'
        ? []
        : await collect((request) =>
            entry.kind === 'queue'
              ? provider.listPendingRegistrations(access, {}, request)
              : provider.listUnconvertedRegistrations(access, {}, request),
          );
    const groups =
      entry.kind === 'duplicates'
        ? await collect((request) => provider.listDuplicateRegistrationGroups(access, {}, request))
        : [];
    const total = entry.kind === 'duplicates' ? groups.length : rows.length;
    expect(total).toBeGreaterThan(entry.pageSize);
    await boot(page, observations, `${entry.method}:1:1`);
    await navigate(page, 'Deal Reg Ops');
    const root = card(page, entry.title);
    const collection: Collection = {
      ...entry,
      total,
      root,
      keys: entry.kind === 'duplicates' ? readDuplicateKeys(root) : tableKeys(root, entry.kind),
      expectedKeys: (count) =>
        entry.kind === 'duplicates'
          ? duplicateKeys(groups.slice(0, count), names)
          : registrationKeys(rows.slice(0, count), entry.kind, names),
    };
    await walk(page, observations, collection, true);
    await evidence(testInfo, `${entry.id}-pagination`, {
      total,
      pageSize: entry.pageSize,
      rowKeys: await collection.keys(),
    });
    await observations.check([entry.method]);
  });
}

const PARTNER_COLLECTIONS = [
  {
    id: 'PG-011',
    noun: 'registrations',
    title: 'Deal registrations',
    method: 'listRecentRegistrations',
    pageSize: 8,
    kind: 'history',
    retry: 'registration history',
  },
  {
    id: 'PG-012',
    noun: 'unconverted',
    title: 'Exclusivity window',
    method: 'listUnconvertedRegistrations',
    pageSize: 6,
    kind: 'exclusivity',
    retry: 'exclusivity window',
  },
  {
    id: 'PG-013',
    noun: 'opportunities',
    title: /^Pipeline opportunities/,
    method: 'listScopedOpportunities',
    pageSize: 25,
    kind: 'opportunities',
    retry: 'pipeline opportunities',
  },
] as const;

for (const entry of PARTNER_COLLECTIONS) {
  test(`VAL-A11Y-010 ${entry.id}: Partner View ${entry.noun} tests the largest real partner book, named retry and exhaustion without exposing another partner`, async ({
    page,
  }, testInfo) => {
    const observations = observePagination(page);
    const roster = (await provider.getPartnerRoster(access, {})).data;
    const names = new Map(roster.map((partner) => [partner.id, partner.name]));
    const candidates = await Promise.all(
      roster.map(async (partner) => {
        const audience = { audience: 'partner' as const, partnerId: partner.id };
        const registrations =
          entry.kind === 'opportunities'
            ? []
            : await collect((request) =>
                entry.kind === 'history'
                  ? provider.listRecentRegistrations(audience, { partnerId: partner.id }, request)
                  : provider.listUnconvertedRegistrations(
                      audience,
                      { partnerId: partner.id },
                      request,
                    ),
              );
        const opportunities =
          entry.kind === 'opportunities'
            ? await collect((request) =>
                provider.listScopedOpportunities(
                  audience,
                  { phase: 'fy', partnerId: partner.id },
                  request,
                ),
              )
            : [];
        return {
          partner,
          registrations,
          opportunities,
          total: registrations.length + opportunities.length,
        };
      }),
    );
    candidates.sort((left, right) => right.total - left.total);
    const largest = candidates[0];
    expect(largest.total).toBeGreaterThan(0);
    // The base partner books may fit a single page. Exercise a real initial
    // failure/retry first, then explicitly prove the endpoint: never silently
    // omit PG-012 or PG-013 because they lack a second page in seeded data.
    await boot(page, observations, `${entry.method}:1`);
    await navigate(page, 'Partner View');
    const initialRoot = card(page, entry.title);
    const retry = initialRoot.getByRole('button', { name: `Retry ${entry.retry}`, exact: true });
    await expect(retry).toBeVisible();
    await expect(
      initialRoot.getByRole('group', { name: `${entry.noun} pagination`, exact: true }),
    ).toHaveCount(0);
    await observations.flush();
    const before = observations.started.length;
    await retry.focus();
    await page.keyboard.press('Enter');
    await expect(initialRoot.getByText(/^Loading /)).toBeVisible();
    await expect(initialRoot.getByRole('group', { name: entry.retry, exact: true })).toBeFocused();
    await expect(
      initialRoot.getByRole('group', { name: `${entry.noun} pagination`, exact: true }),
    ).toBeVisible();
    await onlyMethod(observations, before, entry.method);
    await page.getByLabel('Viewing as').selectOption(largest.partner.id);
    await settle(page);
    if (entry.kind === 'opportunities') await selectChip(page, 'Select fiscal phase', 'FY');
    const root = card(page, entry.title);
    const collection: Collection = {
      ...entry,
      total: largest.total,
      root,
      keys: tableKeys(root, entry.kind, false),
      expectedKeys: (count) =>
        entry.kind === 'opportunities'
          ? opportunityKeys(largest.opportunities.slice(0, count))
          : registrationKeys(largest.registrations.slice(0, count), entry.kind, names, false),
    };
    await walk(page, observations, collection);
    const calls = await observations.count(entry.method);
    if (entry.kind !== 'opportunities') {
      await selectChip(page, 'Select fiscal phase', 'Q1');
      await selectChip(page, 'Slice pipeline by revenue motion', 'Allocate');
      await assertRows(collection, largest.total);
      expect(await observations.count(entry.method)).toBe(calls);
    } else {
      expect(await root.getByRole('table').innerText()).not.toMatch(/sell to/i);
      await selectChip(page, 'Slice pipeline by revenue motion', 'Allocate');
      const audience = { audience: 'partner' as const, partnerId: largest.partner.id };
      const scoped = await collect((request) =>
        provider.listScopedOpportunities(
          audience,
          { phase: 'fy', partnerId: largest.partner.id, oppType: 'allocate' },
          request,
        ),
      );
      collection.total = scoped.length;
      collection.expectedKeys = (count) => opportunityKeys(scoped.slice(0, count));
      await walk(page, observations, collection);
    }
    const failures = [entry.method];
    if (largest.total > entry.pageSize) {
      // Reboot a fresh, explicitly planned provider to fail this partner's
      // second page, not the default portal partner's first page.
      const ranking = await provider.getTopPartnerLeaders(access, {
        phase: 'fy',
        oppTypes: ['sell-with', 'allocate'],
      });
      const defaultId = ranking.data.leaders[0].partner.id;
      const initialCalls =
        (defaultId === largest.partner.id ? 1 : 2) + (entry.kind === 'opportunities' ? 1 : 0);
      await boot(page, observations, `${entry.method}:${initialCalls}:1`);
      await navigate(page, 'Partner View');
      await page.getByLabel('Viewing as').selectOption(largest.partner.id);
      await settle(page);
      if (entry.kind === 'opportunities') await selectChip(page, 'Select fiscal phase', 'FY');
      collection.total = largest.total;
      collection.expectedKeys = (count) =>
        entry.kind === 'opportunities'
          ? opportunityKeys(largest.opportunities.slice(0, count))
          : registrationKeys(largest.registrations.slice(0, count), entry.kind, names, false);
      await walk(page, observations, collection, true);
      failures.push(entry.method);
    }
    await evidence(testInfo, `${entry.id}-pagination`, {
      partnerId: largest.partner.id,
      total: largest.total,
      maximumBaseTotal: candidates[0].total,
      pageSize: entry.pageSize,
    });
    await observations.check(failures);
  });
}

test('VAL-A11Y-010 PG-014: Action Center appends exactly one unique page per activation and preserves focus across page failure, retry, completion and filtered end', async ({
  page,
}, testInfo) => {
  const observations = observePagination(page);
  const rows = await collect((request) =>
    provider.listActionItems(access, { policy: DEFAULT_ACTION_POLICY }, request),
  );
  expect(rows.length).toBeGreaterThan(25);
  await boot(page, observations, 'listActionItems:1:1');
  await navigate(page, 'Action Center');
  const root = card(page, 'Action items');
  const collection: Collection = {
    id: 'PG-014',
    noun: 'action items',
    method: 'listActionItems',
    pageSize: 25,
    total: rows.length,
    root,
    keys: () =>
      root
        .locator('[data-action-id]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-action-id')!),
        ),
    expectedKeys: (count) => rows.slice(0, count).map((row) => row.id),
  };
  await walk(page, observations, collection, true);
  await page.getByLabel('Owner ID', { exact: true }).fill('no-such-pagination-owner');
  await settle(page);
  collection.total = 0;
  collection.expectedKeys = () => [];
  await endpoint(page, observations, collection, 0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await settle(page);
  collection.total = rows.length;
  collection.expectedKeys = (count) => rows.slice(0, count).map((row) => row.id);
  await assertRows(collection, 25);
  await evidence(testInfo, 'PG-014-pagination', {
    total: rows.length,
    uniqueIds: rows.map((row) => row.id),
    filteredTotal: 0,
  });
  await observations.check(['listActionItems']);
});

test('VAL-A11Y-010 PG-014: a retained Action Center window reports refresh failure and its stable focused Retry refreshes all loaded rows once', async ({
  page,
}, testInfo) => {
  const observations = observePagination(page);
  const rows = await collect((request) =>
    provider.listActionItems(access, { policy: DEFAULT_ACTION_POLICY }, request),
  );
  await boot(page, observations, 'listActionItems:2:1');
  await navigate(page, 'Action Center');
  const root = card(page, 'Action items');
  const collection: Collection = {
    id: 'PG-014',
    noun: 'action items',
    method: 'listActionItems',
    pageSize: 25,
    total: rows.length,
    root,
    keys: () =>
      root
        .locator('[data-action-id]')
        .evaluateAll((elements) =>
          elements.map((element) => element.getAttribute('data-action-id')!),
        ),
    expectedKeys: (count) => rows.slice(0, count).map((row) => row.id),
  };
  const loaded = await nextPage(page, observations, collection, 25);
  const original = await footer(collection).getByRole('button').elementHandle();
  await navigate(page, 'Forecasting');
  const forecastRow = page.locator('#manager-pm-01 tr[data-opportunity-id]').first();
  await forecastRow.getByRole('button', { name: /^(Add|Edit) note for / }).click();
  await forecastRow
    .getByRole('textbox', { name: /^Note for / })
    .fill('Pagination refresh evidence');
  await forecastRow.getByRole('button', { name: 'Save note', exact: true }).click();
  await navigate(page, 'Action Center');
  await assertRows(collection, loaded);
  const group = footer(collection);
  const button = group.getByRole('button');
  await expect(button).toHaveAccessibleName('Retry action items');
  await expect(group.getByRole('status')).toContainText('action items failed:');
  expect(await button.evaluate((element, prior) => element === prior, original!)).toBe(true);
  await observations.flush();
  const before = observations.started.length;
  await activateTwice(page, button, 'Enter');
  await expect(group.getByRole('status')).toContainText('Updating action items');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await assertRows(collection, loaded);
  await expect(button).toBeFocused();
  await expect(group.getByRole('status')).not.toContainText(/Updating|failed:/);
  await assertRows(collection, loaded);
  await sameButton(collection, original);
  await observations.flush();
  expect(observations.started.slice(before)).toEqual(['listActionItems']);
  await evidence(testInfo, 'PG-014-retained-refresh', {
    loaded,
    total: rows.length,
    trigger: 'public Forecasting note editor',
    retryCalls: 1,
  });
  await observations.check(['listActionItems']);
});

function meetingKeys(rows: ActivityMeeting[]) {
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return rows.map((row) => {
    const end = new Date(Date.parse(row.occurredAt) + row.durationMinutes * 60_000).toISOString();
    return [
      dayNames[new Date(row.occurredAt).getUTCDay()],
      `${formatTime(row.occurredAt)}–${formatTime(end)}`,
      row.partnerId,
    ].join('|');
  });
}

function readMeetingKeys(root: Locator) {
  return () =>
    root.locator('select[aria-label^="Partner for "]').evaluateAll((elements) =>
      elements.map((element) => {
        const meeting = element.closest('.border-l-2')!;
        const day = meeting
          .parentElement!.parentElement!.querySelector(':scope > p')!
          .textContent!.trim();
        const time = meeting.querySelector('p')!.textContent!.trim();
        return [day, time, (element as HTMLSelectElement).value].join('|');
      }),
    );
}

test('VAL-A11Y-010 PG-015: meeting calendar initial retry recovers named counts and every manager endpoint blocks requests while keeping focus', async ({
  page,
}, testInfo) => {
  const observations = observePagination(page);
  await boot(page, observations, 'listWeeklyClassificationMeetings:1');
  await navigate(page, 'Activity Tracking');
  await page.getByRole('button', { name: 'Log Meetings', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Log meetings', exact: true });
  const retry = dialog.getByRole('button', { name: 'Retry meeting calendar', exact: true });
  await expect(retry).toBeVisible();
  await observations.flush();
  const before = observations.started.length;
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText('Loading meetings…', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('group', { name: 'meeting calendar', exact: true })).toBeFocused();
  await expect(
    dialog.getByRole('group', { name: 'meeting calendar pagination', exact: true }),
  ).toBeVisible();
  await onlyMethod(observations, before, 'listWeeklyClassificationMeetings');
  const totals: Record<string, number> = {};
  for (const [index, manager] of MANAGERS.entries()) {
    if (index > 0) {
      await page
        .getByRole('combobox', { name: 'Partner manager', exact: true })
        .selectOption(manager.id);
      await settle(page);
      await page.getByRole('button', { name: 'Log Meetings', exact: true }).click();
      dialog = page.getByRole('dialog', { name: 'Log meetings', exact: true });
    }
    const rows = await collect((request) =>
      provider.listWeeklyClassificationMeetings(access, { partnerManagerId: manager.id }, request),
    );
    totals[manager.id] = rows.length;
    const collection: Collection = {
      id: 'PG-015',
      noun: 'meeting calendar',
      method: 'listWeeklyClassificationMeetings',
      pageSize: 25,
      buttonLabel: 'Load more meetings',
      total: rows.length,
      root: dialog,
      keys: readMeetingKeys(dialog),
      expectedKeys: (count) => meetingKeys(rows.slice(0, count)),
    };
    await walk(page, observations, collection);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  await evidence(testInfo, 'PG-015-base-calendar', {
    totals,
    namedRetry: 'Retry meeting calendar',
  });
  await observations.check(['listWeeklyClassificationMeetings']);
});

test('VAL-A11Y-010 PG-015: scaled meeting calendar loads one distinct page with retained classifications and truthful total instead of loaded-count total', async ({
  page,
}, testInfo) => {
  const observations = observePagination(page);
  await boot(page, observations, '', 'scaled');
  await navigate(page, 'Activity Tracking');
  const manager = MANAGERS[0];
  await page.getByRole('button', { name: 'Log Meetings', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Log meetings', exact: true });
  const scaled = new ScaleDataProvider();
  const answer = await scaled.listWeeklyClassificationMeetings(
    access,
    { partnerManagerId: manager.id },
    { limit: 50 },
  );
  const collection: Collection = {
    id: 'PG-015',
    noun: 'meeting calendar',
    method: 'listWeeklyClassificationMeetings',
    pageSize: 25,
    buttonLabel: 'Load more meetings',
    instant: true,
    total: answer.data.totalCount,
    root: dialog,
    keys: readMeetingKeys(dialog),
    expectedKeys: (count) => meetingKeys(answer.data.rows.slice(0, count)),
  };
  expect(collection.total).toBeGreaterThan(50);
  const classification = dialog.locator('select[aria-label^="Call type for "]').first();
  const existing = await classification.inputValue();
  const selected = existing === 'discovery' ? 'pio-interlock' : 'discovery';
  await classification.selectOption(selected);
  const retained = await classification.elementHandle();
  await nextPage(page, observations, collection, 25);
  await expect(classification).toHaveValue(selected);
  expect(await classification.evaluate((element, prior) => element === prior, retained!)).toBe(
    true,
  );
  await evidence(testInfo, 'PG-015-scaled-calendar', {
    total: collection.total,
    loaded: 50,
    retainedClassification: selected,
    pageRequests: 1,
  });
  await observations.check();
});
