import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  CURRENT_FISCAL_QUARTER,
  OPP_TYPES,
  OPP_TYPE_META,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNEL_META,
  STAGE_META,
} from '../../src/data/constants';
import { INTERNAL_DEMO_SCOPE } from '../../src/data/accessScope';
import { ACTION_CATEGORIES, ACTION_CATEGORY_LABELS } from '../../src/data/actionCenter';
import { CONNECTION_NODES, CONNECTION_EDGES } from '../../src/data/connections';
import { MockDataProvider } from '../../src/data/mock/MockDataProvider';
import type { PerformanceScope, RegistrationOpsSummary } from '../../src/data/DataProvider';
import type { ActionItem, FiscalPhase, OpportunityType } from '../../src/data/types';
import { DEFAULT_ACTION_POLICY } from '../../src/lib/actionPolicy';
import { actionEvidence } from '../../src/lib/actionEvidence';
import { NOTIFICATION_TEMPLATES } from '../../src/lib/notifications';
import { formatDate, formatUsd, formatUsdCompact } from '../../src/lib/format';
import { conversionRows, funnelRows, stageRows } from '../../src/views/performanceRows';
import {
  MANAGERS,
  activate,
  activity,
  axe,
  card,
  dense,
  evidence,
  metric,
  nativeDetails,
  navigate,
  noOverflow,
  observe,
  phaseDescription,
  progress,
  reachable,
  revenue,
  selectChip,
  settle,
  toggle,
  weekly,
} from './support/accessibility-surfaces';

// Closed inventory: library/accessibility-surface-inventory.md, CH-001..024,
// DT-001..020 and DS-001..043. Conditional provider/error/empty variants are
// also pinned in component/view unit suites; these cases exercise the actual
// production browser and every bounded loaded population, not sampled rows.
test.use({ hasTouch: true });
const provider = new MockDataProvider();
const access = INTERNAL_DEMO_SCOPE;
const methods = ['Enter', 'Space', 'click', 'touch'] as const;
const viewports = [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 720 },
] as const;

function chartValues(page: Page) {
  return page.getByRole('figure').evaluateAll((figures) =>
    figures.map((figure) => ({
      name: figure.getAttribute('aria-label'),
      values: figure.textContent,
    })),
  );
}

async function chartDisclosures(page: Page) {
  for (const summary of await page.locator('figure summary').all()) {
    if ((await summary.locator('..').getAttribute('open')) !== null) await summary.click();
    for (const method of methods) await nativeDetails(summary, method);
    await activate(summary, 'Enter');
  }
}

async function assertHomeCharts(
  page: Page,
  phase: FiscalPhase,
  oppType: OpportunityType | 'all',
  measure: 'count' | 'value',
) {
  const scope = { phase, oppType };
  const [funnel, stages, types, trend, series] = await Promise.all([
    provider.getRegistrationFunnel(access, scope),
    provider.getStageBreakdown(access, scope),
    provider.getTypeBreakdown(access, scope),
    provider.getQuarterlyRevenueTrend(access, scope),
    provider.getWeeklyActivitySeries(access, {}),
  ]);
  const outcomes = phase === 'fy' ? 'FY27 to date' : `FY27 ${FISCAL_PHASE_META[phase].label}`;
  await metric(page, 'Deal registration funnel', funnelRows(funnel.data, measure));
  await metric(page, 'Pipeline by sales stage', stageRows(stages.data, outcomes));
  await metric(
    page,
    'Pipeline by opportunity type',
    types.data.map((row) => ({
      label: OPP_TYPE_META[row.type].label,
      value: row.value,
      displayValue: formatUsdCompact(row.value),
      secondary: `${row.count} open`,
    })),
  );
  await revenue(page, trend.data);
  await activity(page, series.data);
}

function leakage(ops: RegistrationOpsSummary) {
  return [
    ['Approved, no opp', ops.approvedNotConverted, 'approved registrations'],
    ['Exclusivity lapsed', ops.exclusivityLapsed, '> 60 days since approval'],
    ['Pending past SLA', ops.pastSla, '5+ business days awaiting review'],
    ['Duplicate clients', ops.duplicateGroups, 'same client, multiple partners'],
  ].map(([label, value, secondary]) => ({
    label: String(label),
    value: Number(value),
    displayValue: String(value),
    secondary: String(secondary),
  }));
}

async function assertPerformanceCharts(page: Page, scope: PerformanceScope) {
  const [funnel, stages, trend, series, goal, ops, certification] = await Promise.all([
    provider.getRegistrationFunnel(access, scope),
    provider.getStageBreakdown(access, scope),
    provider.getQuarterlyRevenueTrend(access, scope),
    provider.getWeeklyActivitySeries(access, scope),
    provider.getWeeklyGoalProgress(access, scope),
    provider.getRegistrationOpsSummary(access, scope),
    provider.getPartnerCertification(access, scope),
  ]);
  const outcomes =
    scope.phase === 'fy' ? 'FY27 to date' : `FY27 ${FISCAL_PHASE_META[scope.phase].label}`;
  await metric(page, 'Deal registration funnel', funnelRows(funnel.data, 'value'));
  await metric(page, 'Pipeline by sales stage', stageRows(stages.data, outcomes));
  await revenue(page, trend.data);
  await activity(page, series.data);
  await progress(page, 'Partner meetings', goal.data.meetings, goal.data.meetingsGoal);
  await progress(page, 'PIO interlocks', goal.data.pioMeetings, goal.data.pioGoal);
  await metric(
    page,
    'Registration conversion time',
    conversionRows(ops.data.times, 'avg business days · 5-business-day SLA'),
  );
  await metric(page, 'Registration leakage', leakage(ops.data));
  if (scope.partnerId) {
    const cert = certification.data?.certification;
    await progress(
      page,
      'Partner strategists',
      cert?.partnerStrategistsCertified ?? 0,
      cert?.partnerStrategistsGoal ?? 1,
      !cert,
    );
    await progress(
      page,
      'Partner engineers',
      cert?.partnerEngineersCertified ?? 0,
      cert?.partnerEngineersGoal ?? 1,
      !cert,
    );
  }
}

for (const phase of FISCAL_PHASES) {
  test(`VAL-A11Y-006 VAL-A11Y-005: CH-001..005 DS-016/019/023/027..029 Home ${phase}, every type and funnel measure`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const check = observe(page);
    await page.goto('/');
    await settle(page);
    const records: unknown[] = [];
    await selectChip(
      page,
      'Select fiscal time phase',
      FISCAL_PHASE_META[phase].label,
      phaseDescription(phase),
    );
    for (const type of ['all', ...OPP_TYPES] as const) {
      await selectChip(
        page,
        'Filter by opportunity type',
        type === 'all' ? 'All' : OPP_TYPE_META[type].label,
        type === 'all' ? 'All opportunity types' : OPP_TYPE_META[type].description,
      );
      for (const measure of ['value', 'count'] as const) {
        await selectChip(
          page,
          'Funnel measure',
          measure === 'value' ? 'Registered $' : 'Count',
          measure === 'value'
            ? 'Partner-estimated deal value at submission'
            : 'Number of registrations',
        );
        await assertHomeCharts(page, phase, type, measure);
        records.push({ phase, type, measure, figures: await chartValues(page) });
      }
    }
    await chartDisclosures(page);
    await evidence(testInfo, 'CH-001..005', records);
    await axe(page, testInfo, `home-${phase}-chart-alternatives`, 'figure');
    check();
  });
}

for (const manager of [null, ...MANAGERS]) {
  test(`VAL-A11Y-006 VAL-A11Y-005: CH-006..015 DS-017/020/024/030 Partner Performance ${manager?.id ?? 'all'}, every aligned partner and phase`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const check = observe(page);
    await page.goto('/');
    await navigate(page, 'Partner Performance');
    const roster = (await provider.getPartnerRoster(access, {})).data;
    const managerId = manager?.id;
    await page
      .getByRole('combobox', { name: 'Partner manager', exact: true })
      .selectOption(managerId ?? 'all');
    await settle(page);
    const partnerIds = manager
      ? [
          undefined,
          ...roster
            .filter((partner) => partner.partnerManagerId === manager.id)
            .map((partner) => partner.id),
        ]
      : [undefined];
    const records: unknown[] = [];
    for (const partnerId of partnerIds) {
      await page
        .getByRole('combobox', { name: 'Partner', exact: true })
        .selectOption(partnerId ?? 'all');
      await settle(page);
      for (const phase of FISCAL_PHASES) {
        await selectChip(
          page,
          'Select fiscal time phase',
          FISCAL_PHASE_META[phase].label,
          phaseDescription(phase),
        );
        await assertPerformanceCharts(page, {
          phase,
          partnerManagerId: managerId,
          partnerId,
          partnerFilter: 'roster',
        });
        records.push({ phase, managerId, partnerId, figures: await chartValues(page) });
      }
    }
    await evidence(testInfo, `CH-006..015-${managerId ?? 'all'}`, {
      partnerIds,
      phases: FISCAL_PHASES,
      records,
    });
    await chartDisclosures(page);
    await axe(page, testInfo, `performance-${managerId ?? 'all'}-all-chart-types`, 'figure');
    check();
  });
}

test('VAL-A11Y-006 VAL-A11Y-005: CH-016 DS-022 every selected-quarter bucket, raw/weighted category, comparison, goal and all five manager scopes', async ({
  page,
}, testInfo) => {
  const check = observe(page);
  await page.goto('/');
  await navigate(page, 'Forecasting');
  const records: unknown[] = [];
  // Forecasting fixes its quarter to SNAPSHOT_DATE; other quarters have no
  // browser selector and are covered by WeeklyForecastChart's unit matrix.
  for (const quarter of [CURRENT_FISCAL_QUARTER]) {
    const scope = { quarter };
    const rows = (await provider.getWeeklyForecastSeries(access, scope)).data;
    const goal = (await provider.getForecastSummary(access, scope)).data.target;
    records.push({ quarter, rows: await weekly(page, rows, goal) });
    for (const manager of MANAGERS) {
      await page
        .getByRole('combobox', { name: 'Partner manager', exact: true })
        .selectOption(manager.id);
      await settle(page);
      await weekly(page, rows);
    }
    await page.getByRole('combobox', { name: 'Partner manager', exact: true }).selectOption('all');
    await settle(page);
  }
  const summary = page.getByRole('figure', { name: 'Week-over-week pipeline' }).locator('summary');
  await summary.click();
  for (const method of methods) await nativeDetails(summary, method);
  await summary.click();
  await evidence(testInfo, 'CH-016-all-buckets-values-states', records);
  await axe(page, testInfo, 'forecast-weekly-full-alternative', 'figure');
  check();
});

test('VAL-A11Y-006: CH-016 retains every weekly value with revenue goal unavailable after independent summary failure', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  const technicalErrors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') technicalErrors.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));
  await page.goto('/?remoteFailMethods=getForecastSummary:1:1');
  await page.getByLabel('Data provider').selectOption('remote');
  await expect(page.getByText(/round trips with a 15% simulated failure rate/)).toBeVisible();
  await navigate(page, 'Forecasting');
  await expect(
    page.getByRole('button', { name: 'Retry forecast summary', exact: true }),
  ).toBeVisible();
  await weekly(page, (await provider.getWeeklyForecastSeries(access, { quarter: 'FY27-Q3' })).data);
  await axe(page, testInfo, 'forecast-summary-unavailable-series-present', 'figure');
  expect(errors).toEqual([]);
  expect(technicalErrors).toHaveLength(1);
  expect(technicalErrors[0]).toMatch(/component: DataProvider, operation: getForecastSummary/);
  expect(requests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  expect(requests.some((url) => /@vite\/client|hot-update/.test(url))).toBe(false);
});

test('VAL-A11Y-006 VAL-A11Y-005: CH-017 DS-025 every Deal Reg Ops conversion transition and its business/calendar units', async ({
  page,
}, testInfo) => {
  const check = observe(page);
  await page.goto('/');
  await navigate(page, 'Deal Reg Ops');
  const ops = (await provider.getRegistrationOpsSummary(access, {})).data;
  await metric(
    page,
    'Conversion time',
    conversionRows(ops.times, 'avg business days · vs 5-business-day SLA'),
  );
  await evidence(testInfo, 'CH-017-conversion-values', ops.times);
  await axe(page, testInfo, 'registration-conversion', 'figure');
  check();
});

for (const manager of MANAGERS) {
  test(`VAL-A11Y-006 VAL-A11Y-005: CH-018..020 DS-018 Activity Tracking ${manager.id}, every partner and eight-by-eight meeting alternative`, async ({
    page,
  }, testInfo) => {
    const check = observe(page);
    await page.goto('/');
    await navigate(page, 'Activity Tracking');
    await page
      .getByRole('combobox', { name: 'Partner manager', exact: true })
      .selectOption(manager.id);
    await settle(page);
    const roster = (await provider.getPartnerRoster(access, {})).data.filter(
      (partner) => partner.partnerManagerId === manager.id,
    );
    const goal = (await provider.getWeeklyGoalProgress(access, { partnerManagerId: manager.id }))
      .data;
    const records: unknown[] = [];
    for (const partnerId of [undefined, ...roster.map((partner) => partner.id)]) {
      await page
        .getByRole('combobox', { name: 'Partner', exact: true })
        .selectOption(partnerId ?? 'all');
      await settle(page);
      await progress(page, 'Partner meetings', goal.meetings, goal.meetingsGoal);
      await progress(page, 'PIO interlocks', goal.pioMeetings, goal.pioGoal);
      const rows = (
        await provider.getWeeklyActivitySeries(access, { partnerManagerId: manager.id, partnerId })
      ).data;
      records.push({ partnerId, rows: await activity(page, rows) });
    }
    await expect(card(page, 'Progress to weekly goal')).toContainText(
      'Partner-Identified Opportunity Interlock (PIO Interlock)',
    );
    await evidence(testInfo, `CH-018..020-${manager.id}`, records);
    await chartDisclosures(page);
    await axe(page, testInfo, `activity-${manager.id}`, 'figure');
    check();
  });
}

for (const manager of MANAGERS) {
  test(`VAL-A11Y-006 VAL-A11Y-005: CH-021..024 DS-021/026/031/032 Partner View every ${manager.id} partner, fiscal phase and visible revenue motion`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const check = observe(page);
    await page.goto('/');
    await navigate(page, 'Partner View');
    const roster = (await provider.getPartnerRoster(access, {})).data.filter(
      (partner) => partner.partnerManagerId === manager.id,
    );
    const records: unknown[] = [];
    for (const partner of roster) {
      await page
        .getByRole('combobox', { name: 'Viewing as', exact: true })
        .selectOption(partner.id);
      await settle(page);
      const partnerAccess = { audience: 'partner', partnerId: partner.id } as const;
      const ops = (await provider.getRegistrationOpsSummary(partnerAccess, {})).data;
      await metric(
        page,
        'Deal registration timeline',
        conversionRows(ops.times, 'avg business days · 5-business-day SLA'),
      );
      for (const phase of FISCAL_PHASES) {
        await selectChip(
          page,
          'Select fiscal phase',
          FISCAL_PHASE_META[phase].label,
          phaseDescription(phase),
        );
        const motions = (await provider.getTypeBreakdown(partnerAccess, { phase })).data;
        const visibleMotions = motions.filter((row) => row.type !== 'sell-to');
        for (const slice of ['all', 'sell-with', 'allocate'] as const) {
          await selectChip(
            page,
            'Slice pipeline by revenue motion',
            slice === 'all' ? 'Total pipeline' : OPP_TYPE_META[slice].label,
            slice === 'all' ? 'Sell With and Allocate combined' : OPP_TYPE_META[slice].description,
          );
          const scope = { phase, oppType: slice };
          const stages = (await provider.getStageBreakdown(partnerAccess, scope)).data;
          await metric(
            page,
            'Pipeline by stage',
            stages.stages.map((row) => ({
              label: STAGE_META[row.stage].label,
              value: row.value,
              displayValue: formatUsdCompact(row.value),
              secondary: `${row.count} open`,
            })),
          );
          const total = visibleMotions.reduce(
            (sum, row) => ({ value: sum.value + row.value, count: sum.count + row.count }),
            { value: 0, count: 0 },
          );
          await metric(page, 'Pipeline by revenue motion', [
            {
              label: 'Total pipeline',
              value: total.value,
              displayValue: formatUsdCompact(total.value),
              secondary: `${total.count} open`,
            },
            ...visibleMotions.map((row) => ({
              label: OPP_TYPE_META[row.type].label,
              value: row.value,
              displayValue: formatUsdCompact(row.value),
              secondary: `${row.count} open`,
            })),
          ]);
          await revenue(page, (await provider.getQuarterlyRevenueTrend(partnerAccess, scope)).data);
          await expect(card(page, 'Pipeline by revenue motion')).not.toContainText('Sell To');
          records.push({ phase, slice, partnerId: partner.id, figures: await chartValues(page) });
        }
      }
    }
    await evidence(testInfo, `CH-021..024-${manager.id}`, {
      partners: roster.map((partner) => partner.id),
      phases: FISCAL_PHASES,
      slices: ['all', 'sell-with', 'allocate'],
      records,
    });
    await chartDisclosures(page);
    await axe(page, testInfo, `partner-view-${manager.id}-alternatives`, 'figure');
    check();
  });
}

async function openManager(page: Page, manager: (typeof MANAGERS)[number]) {
  const button = page.getByRole('button', { name: `${manager.name} opportunities`, exact: true });
  await expect(button).toHaveAttribute('aria-controls', `manager-${manager.id}`);
  if ((await button.getAttribute('aria-expanded')) !== 'true') await activate(button, 'Enter');
  const content = page.locator(`#manager-${manager.id}`);
  await expect(content).toBeVisible();
  await settle(page);
  return content;
}

for (const manager of MANAGERS) {
  test(`VAL-A11Y-005: ${manager.disclosure} DS-006..008 ${manager.id}, every loaded selected-quarter forecast row and four activation modes`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const check = observe(page);
    await page.goto('/');
    await navigate(page, 'Forecasting');
    const records: unknown[] = [];
    for (const quarter of [CURRENT_FISCAL_QUARTER]) {
      const content = await openManager(page, manager);
      const button = page.getByRole('button', {
        name: `${manager.name} opportunities`,
        exact: true,
      });
      await button.click();
      for (const method of methods) {
        await toggle(button, content, method);
        await expect(content.getByRole('table')).toHaveCount(0);
        expect(await content.ariaSnapshot()).toBe('');
      }
      await button.click();
      const rows = content.locator('tbody tr[data-opportunity-id]');
      const fixture = (
        await provider.listQuarterOpportunities(
          access,
          { quarter, partnerManagerId: manager.id },
          { limit: 25 },
        )
      ).data.rows;
      await expect(rows).toHaveCount(fixture.length);
      for (const opportunity of fixture) {
        const row = content.locator(`[data-opportunity-id="${opportunity.id}"]`);
        const note = row.getByRole('button', { name: new RegExp(`^(View|Hide) note for `) });
        if (opportunity.notes) {
          const targetId = await note.getAttribute('aria-controls');
          expect(targetId).toBe(`note-${opportunity.id}`);
          const noteContent = page.locator(`[id="${targetId}"]`);
          for (const method of methods) {
            await toggle(note, noteContent, method);
            await note.click();
            await expect(noteContent).toHaveText(opportunity.notes);
            expect(await noteContent.ariaSnapshot()).toContain(opportunity.notes);
            await note.click();
          }
        } else {
          await expect(note).toHaveCount(0);
          await expect(row.getByRole('button', { name: /^Add note for / })).toBeVisible();
        }
        const offStage = row.locator('summary[aria-label^="Off stage explanation for "]');
        for (const summary of await offStage.all()) {
          for (const method of methods) await nativeDetails(summary, method);
          await summary.click();
          await expect(summary.locator('..').locator('p')).toHaveText(
            /Called .+ while the deal sits in .+, which implies .+\./,
          );
          await summary.click();
        }
        if (opportunity.outcome !== undefined) {
          await expect(row.getByRole('button', { name: /^Edit forecast category/ })).toHaveCount(0);
        }
        await expect(row).not.toContainText('Edited — differs from Salesforce forecast');
      }
      // Each book independently reaches no-note Add, edited provenance and
      // note disclosure; these are session UI edits, never fixture mutation.
      if (fixture.length > 0) {
        const first = rows.first();
        await first.getByRole('button', { name: /^(Add|Edit) note for / }).click();
        await first
          .getByRole('textbox', { name: /^Note for / })
          .fill(`Accessible ${manager.id} ${quarter} note`);
        await first.getByRole('button', { name: 'Save note', exact: true }).click();
        await settle(page);
        const note = first.getByRole('button', { name: /^(View|Hide) note for / });
        await activate(note, 'Space');
        await expect(
          first.getByText(`Accessible ${manager.id} ${quarter} note`, { exact: true }),
        ).toBeVisible();
        await activate(note, 'Enter');
        await first.getByRole('button', { name: /^Edit revenue forecast/ }).click();
        await first
          .getByRole('textbox', { name: /^Revenue forecast/ })
          .fill(String(fixture[0].forecastedRevenue + 123));
        await first.getByRole('button', { name: 'Save revenue', exact: true }).click();
        await settle(page);
        await expect(
          first.getByText('Edited — differs from Salesforce forecast', { exact: true }),
        ).toBeVisible();
        await axe(page, testInfo, `${manager.id}-${quarter}-edited-note`);
      }
      records.push({
        quarter,
        ids: fixture.map((opportunity) => opportunity.id),
        offStage: await content.locator('summary').count(),
      });
    }
    await page
      .getByRole('combobox', { name: 'Partner manager', exact: true })
      .selectOption(manager.id);
    await settle(page);
    for (const other of MANAGERS.filter((candidate) => candidate.id !== manager.id)) {
      await expect(
        page.getByRole('button', { name: `${other.name} opportunities`, exact: true }),
      ).toHaveCount(0);
      await expect(page.locator(`#manager-${other.id}`)).toBeHidden();
    }
    await evidence(testInfo, `${manager.disclosure}-DS-006..008`, records);
    check();
  });
}

const TABLE_ROUTES = [
  {
    route: 'Home',
    tables: [
      ['DT-001', 'Registrations awaiting review'],
      ['DT-002', 'Partner leaderboard'],
    ],
  },
  {
    route: 'Partner Performance',
    // The whole-org registration tables live on Deal Reg Ops; a manager
    // drill-down keeps its own copies on this route.
    tables: [
      ['DT-003', 'Pipeline opportunities'],
      ['DT-004', 'Registrations awaiting review'],
      ['DT-005', 'Partner leaderboard & enablement'],
      ['DT-006', 'Exclusivity window'],
      ['DT-007', 'Duplicate & conflicting registrations'],
    ],
  },
  {
    route: 'Deal Reg Ops',
    tables: [
      ['DT-021', 'Deal registrations'],
      ['DT-013', 'Registrations awaiting review'],
      ['DT-014', 'Exclusivity window'],
      ['DT-015', 'Duplicate & conflicting registrations'],
    ],
  },
  {
    route: 'Partner View',
    tables: [
      ['DT-016', 'Deal registrations'],
      ['DT-017', 'Exclusivity window'],
      ['DT-018', 'Pipeline opportunities'],
    ],
  },
  {
    route: 'Settings',
    tables: [
      ['DT-022', 'Administrators'],
      ['DT-023', 'Users'],
      ['DT-019', 'Partner team notification routing'],
      ['DT-020', 'Deal-registration SLA alert queue'],
    ],
  },
] as const;

async function tableActions(page: Page, region: Locator) {
  const controls = region.locator('tbody button');
  for (const control of await controls.all()) {
    if (await control.isDisabled()) continue;
    await control.scrollIntoViewIfNeeded();
    await reachable(control);
    const label = (await control.getAttribute('aria-label')) ?? (await control.innerText());
    if (/^(Decide|Disposition)/.test(label)) {
      await activate(control, 'Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(control).toBeFocused();
      await activate(control, 'touch');
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
    } else if (/^(Add|Edit) note/.test(label)) {
      const id = await control.locator('xpath=ancestor::tr[1]').getAttribute('data-opportunity-id');
      const row = region.locator(`[data-opportunity-id="${id}"]`);
      await activate(control, 'Enter');
      await expect(row.getByRole('textbox', { name: /^Note for / })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(control).toBeFocused();
      await activate(control, 'touch');
      await row.getByRole('button', { name: 'Cancel note edit' }).tap();
      await expect(control).toBeFocused();
    } else if (label === 'Notify owner') {
      await activate(control, 'Enter');
      await expect(
        page
          .getByRole('group', { name: 'The notification composer', exact: true })
          .getByLabel('To', { exact: true }),
      ).not.toHaveValue('');
      await activate(control, 'touch');
    } else if (/^(Pause|Resume|Turn on) notifications$/.test(label)) {
      const row = control.locator('xpath=ancestor::tr[1]');
      await activate(control, 'Enter');
      await settle(page);
      await expect(row).toContainText(
        label === 'Pause notifications' ? 'Notifications paused' : 'Notifications on',
      );
      const reverse = row.getByRole('button', {
        name: label === 'Pause notifications' ? 'Resume notifications' : 'Pause notifications',
        exact: true,
      });
      await activate(reverse, 'touch');
      await settle(page);
    }
  }
}

for (const viewport of viewports) {
  test(`VAL-A11Y-011 VAL-A11Y-005: DT-001..020 DS-009..015 every table, row, header and final-column action at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const check = observe(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    await settle(page);
    const records: unknown[] = [];
    for (const entry of TABLE_ROUTES) {
      const { route, tables } = entry;
      await navigate(page, route);
      // The whole-org registration tables live on Deal Reg Ops; this route
      // needs a manager drill-down to render its scoped copies.
      if (route === 'Partner Performance') {
        await page
          .getByRole('combobox', { name: 'Partner manager', exact: true })
          .selectOption('pm-01');
        await settle(page);
      }
      for (const [id, name] of tables) {
        const region = page.getByRole('region', { name: `${name}, scrollable`, exact: true });
        records.push(await dense(page, region, id));
        if (name === 'Registrations awaiting review') {
          for (const row of await region.locator('tbody tr').all()) {
            await expect(row).toContainText(/\d+ business days waiting/);
            await expect(row).toContainText(/(Within|Past) the 5-business-day SLA/);
          }
        }
        if (name === 'Exclusivity window') {
          for (const row of await region.locator('tbody tr').all()) {
            if ((await row.locator('td').count()) > 1) {
              await expect(row).toContainText(/\d+ calendar days/);
              await expect(row).toContainText('60-calendar-day window from approval');
              await expect(row).toContainText(/In window|Exclusivity lapsed/);
            }
          }
        }
        if (name === 'Deal registrations' && route === 'Partner View') {
          const partnerId = await page
            .getByRole('combobox', { name: 'Viewing as', exact: true })
            .inputValue();
          const history = (
            await provider.listRecentRegistrations(
              { audience: 'partner', partnerId },
              {},
              { limit: 8 },
            )
          ).data.rows;
          const rows = region.locator('tbody tr');
          await expect(rows).toHaveCount(history.length || 1);
          for (const [index, registration] of history.entries()) {
            const cells = rows.nth(index).getByRole('cell');
            await expect(cells.nth(0)).toContainText(registration.accountName);
            if (registration.reason) await expect(cells.nth(0)).toContainText(registration.reason);
            await expect(cells.nth(1)).toHaveText(formatUsd(registration.amount));
            await expect(cells.nth(2)).toHaveText(formatDate(registration.submittedAt));
            await expect(cells.nth(3)).toHaveText(
              registration.decisionAt ? formatDate(registration.decisionAt) : '—',
            );
          }
          await expect(
            region.getByRole('columnheader', { name: 'Partner', exact: true }),
          ).toHaveCount(0);
        }
        await tableActions(page, region);
      }
      await axe(page, testInfo, `${route}-${viewport.width}-dense-content`);
      await noOverflow(page);
    }
    await navigate(page, 'Forecasting');
    for (const manager of MANAGERS) {
      const content = await openManager(page, manager);
      const region = content.getByRole('region', {
        name: `In-quarter opportunities · ${manager.id}, scrollable`,
        exact: true,
      });
      records.push(await dense(page, region, manager.table));
      await expect(region.getByRole('columnheader').last()).toHaveText('Notes');
      // Every loaded row's final-column note editor, not just the first row.
      const notes = region.getByRole('button', { name: /^(Add|Edit) note for / });
      for (const control of await notes.all()) {
        await reachable(control);
        const id = await control
          .locator('xpath=ancestor::tr[1]')
          .getAttribute('data-opportunity-id');
        const row = region.locator(`[data-opportunity-id="${id}"]`);
        await activate(control, 'Enter');
        await expect(row.getByRole('textbox', { name: /^Note for / })).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(control).toBeFocused();
        await activate(control, 'touch');
        await row.getByRole('button', { name: 'Cancel note edit' }).tap();
        await expect(control).toBeFocused();
        await noOverflow(page);
      }
    }
    await axe(page, testInfo, `forecast-all-five-books-${viewport.width}`);
    await evidence(testInfo, `DT-001..020-${viewport.width}`, records);
    check();
  });
}

const ACTION_PARTITIONS = [0, 1, 2, 3] as const;

function actionCoverage(items: readonly ActionItem[]) {
  const categories = new Set<string>();
  const notificationCategories = new Set<string>();
  for (const item of items) {
    for (const reason of item.reasons) {
      categories.add(reason.category);
      if (item.owner?.userId) notificationCategories.add(reason.category);
    }
  }
  return {
    categories: [...categories].sort(),
    notificationCategories: [...notificationCategories].sort(),
    merged: items.filter((item) => item.reasons.length > 1).length,
  };
}

async function actionPopulation(page: Page) {
  await page.goto('/');
  await navigate(page, 'Action Center');
  const fixture: ActionItem[] = [];
  let cursor: string | undefined;
  do {
    const result = (
      await provider.listActionItems(
        access,
        { policy: DEFAULT_ACTION_POLICY },
        { limit: 25, cursor },
      )
    ).data;
    fixture.push(...result.rows);
    cursor = result.nextCursor ?? undefined;
    if (cursor) {
      await page.getByRole('button', { name: 'Load 25 more', exact: true }).click();
      await expect(page.getByTestId('action-item')).toHaveCount(
        fixture.length + Math.min(25, result.totalCount - fixture.length),
      );
    }
  } while (cursor);
  await expect(page.getByTestId('action-item')).toHaveCount(fixture.length);
  const ids = fixture.map((item) => item.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(
    await page
      .getByTestId('action-item')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-action-id'))),
  ).toEqual(ids);
  const partitions = ACTION_PARTITIONS.map((partition) =>
    fixture.filter((_, fixtureIndex) => fixtureIndex % ACTION_PARTITIONS.length === partition),
  );
  const partitionIds = partitions.flat().map((item) => item.id);
  expect(new Set(partitionIds).size).toBe(partitionIds.length);
  expect([...partitionIds].sort()).toEqual([...ids].sort());
  const population = actionCoverage(fixture);
  expect(population.categories).toEqual([...ACTION_CATEGORIES].sort());
  expect(population.notificationCategories).toEqual([...ACTION_CATEGORIES].sort());
  expect(population.merged).toBeGreaterThan(0);
  return { fixture, partitions, population };
}

for (const partition of ACTION_PARTITIONS) {
  test(`VAL-A11Y-005: DS-033/034/042/043 every loaded action partition ${partition + 1}/4, merged reasons, evidence and eligible notification templates`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const check = observe(page);
    const { fixture, partitions, population } = await actionPopulation(page);
    const assigned = partitions[partition];
    const expected = actionCoverage(assigned);
    const seen = new Set<string>();
    const notificationCategories = new Set<string>();
    let merged = 0;
    for (const item of assigned) {
      const row = page.locator(`[data-action-id="${item.id}"]`);
      const button = row.getByRole('button', { name: `Show evidence for ${item.id}`, exact: true });
      const content = row.getByRole('region', { name: `Evidence for ${item.id}`, exact: true });
      for (const method of methods) await toggle(button, content, method);
      await activate(button, 'Enter');
      await expect(content).toContainText('As of Sep 18, 2026');
      await expect(content).toContainText('provider local');
      await expect(content).toContainText('Lineage:');
      await expect(content).toContainText('mock-book —');
      for (const reason of item.reasons) {
        seen.add(reason.category);
        await expect(
          content.getByRole('heading', {
            name: ACTION_CATEGORY_LABELS[reason.category],
            exact: true,
          }),
        ).toBeVisible();
        await expect(content).toContainText(actionEvidence(reason));
        await expect(content).toContainText(reason.recommendedAction);
      }
      if (item.reasons.length > 1) merged += 1;
      await activate(button, 'Space');
      await expect(content).toHaveCount(0);
      expect(await row.ariaSnapshot()).not.toContain(`Evidence for ${item.id}`);
      const notify = row.getByRole('button', {
        name: /^(Notify owner|Close notification)$/,
        exact: true,
      });
      if (!item.owner?.userId) {
        await expect(notify).toBeDisabled();
        continue;
      }
      for (const method of methods) {
        await activate(notify, method);
        await expect(notify).toHaveAttribute('aria-expanded', 'true');
        const composer = row.getByRole('region', {
          name: `Notification for ${item.id}`,
          exact: true,
        });
        await expect(composer).toBeVisible();
        const selector = composer.getByLabel('Template', { exact: true });
        await expect(selector.locator('option')).toHaveText(
          item.reasons.map((reason) => ACTION_CATEGORY_LABELS[reason.category]),
        );
        for (const reason of item.reasons) {
          await selector.selectOption(reason.category);
          notificationCategories.add(reason.category);
          await expect(composer.getByText(reason.recommendedAction, { exact: true })).toBeVisible();
          await expect(composer.getByLabel('Subject')).not.toHaveValue('');
          await expect(composer.getByLabel('Message')).toHaveValue(new RegExp(item.id));
        }
        for (const checkbox of await composer.getByRole('checkbox').all()) {
          const label = (await checkbox.getAttribute('aria-label'))!.replace('Use ', '');
          const channel = NOTIFICATION_CHANNELS.find(
            (candidate) => NOTIFICATION_CHANNEL_META[candidate].label === label,
          )!;
          await expect(checkbox.locator('..')).toContainText(
            NOTIFICATION_CHANNEL_META[channel].description,
          );
        }
        await activate(notify, method);
        await expect(notify).toHaveAttribute('aria-expanded', 'false');
        await expect(composer).toHaveCount(0);
      }
    }
    expect([...seen].sort()).toEqual(expected.categories);
    expect([...notificationCategories].sort()).toEqual(expected.notificationCategories);
    expect(merged).toBe(expected.merged);
    await evidence(testInfo, `DS-033/034/042/043-actions-partition-${partition + 1}`, {
      populationIds: fixture.map((item) => item.id),
      population,
      partition,
      partitionIds: partitions.map((items) => items.map((item) => item.id)),
      ids: assigned.map((item) => item.id),
      methods,
      categories: [...seen].sort(),
      notificationCategories: [...notificationCategories].sort(),
      merged,
    });
    check();
  });
}

test('VAL-A11Y-005: DS-033/034/042/043 all five category/full-page axe evidence and notification checkpoints', async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  const check = observe(page);
  const { fixture, population } = await actionPopulation(page);
  for (const category of ACTION_CATEGORIES) {
    await page
      .getByRole('checkbox', { name: ACTION_CATEGORY_LABELS[category], exact: true })
      .check();
    await settle(page);
    const row = page.getByTestId('action-item').first();
    await row.getByRole('button', { name: /^Show evidence for / }).click();
    await row.getByRole('button', { name: 'Notify owner', exact: true }).click();
    await settle(page);
    await axe(page, testInfo, `action-${category}-evidence-notification`);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await settle(page);
  }
  await evidence(testInfo, 'DS-033/034/042/043-all-actions', {
    ids: fixture.map((item) => item.id),
    ...population,
  });
  check();
});

test('VAL-A11Y-005 VAL-A11Y-011: DS-035..041 DT-019/020 every connection node, touching wire, roster identity, add-form channel and composer template', async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const check = observe(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await navigate(page, 'Data Connections');
  const map = page.getByRole('group', { name: 'Data connection map', exact: true });
  const coveredEdges = new Set<string>();
  for (const node of CONNECTION_NODES) {
    const button = map.getByRole('button').filter({ hasText: node.summary });
    for (const method of methods) {
      await activate(button, method);
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      const detail = page
        .getByRole('heading', { name: node.label, level: 3, exact: true })
        .locator('..');
      await expect(detail).toContainText(node.summary);
      for (const supplied of node.supplies)
        await expect(detail.getByText(supplied, { exact: true })).toBeVisible();
      for (const edge of CONNECTION_EDGES.filter(
        (candidate) => candidate.from === node.id || candidate.to === node.id,
      )) {
        coveredEdges.add(edge.id);
        await expect(detail.getByText(edge.detail, { exact: true })).toBeVisible();
      }
      if (node.blocker) await expect(detail).toContainText(node.blocker);
    }
  }
  expect([...coveredEdges].sort()).toEqual(CONNECTION_EDGES.map((edge) => edge.id).sort());

  // The roster, composer, and add-form now live on Settings; the map keeps
  // its nodes and wires only.
  await navigate(page, 'Settings');
  const roster = (await provider.getTeamRoster(access, {})).data;
  const composer = page.getByRole('group', { name: 'The notification composer', exact: true });
  const to = composer.getByLabel('To', { exact: true });
  const offered = new Set(
    await to
      .locator('option:not([disabled])')
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
  );
  for (const user of roster) {
    // Every roster identity is rendered by the membership and routing tables.
    await expect(page.getByText(user.email, { exact: true }).first()).toBeVisible();
    if (user.status !== 'active') {
      // A paused or not-yet-routing teammate is never offered as a recipient.
      expect(offered.has(user.id)).toBe(false);
      continue;
    }
    expect(offered.has(user.id)).toBe(true);
    await to.selectOption(user.id);
    await expect(to).toHaveValue(user.id);
    for (const template of NOTIFICATION_TEMPLATES) {
      await composer.getByLabel('Template', { exact: true }).selectOption(template.id);
      await expect(composer.getByText(template.description, { exact: true })).toBeVisible();
    }
    await expect(composer.getByRole('checkbox')).toHaveCount(user.channels.length);
    for (const channel of user.channels) {
      const checkbox = composer.getByRole('checkbox', {
        name: `Use ${NOTIFICATION_CHANNEL_META[channel].label}`,
        exact: true,
      });
      await expect(checkbox.locator('..')).toContainText(
        NOTIFICATION_CHANNEL_META[channel].description,
      );
      await checkbox.uncheck();
      await checkbox.check();
    }
  }
  const add = page.getByRole('button', { name: /^(Add user|Close)$/, exact: true });
  const formContainer = page.locator(`[id="${await add.getAttribute('aria-controls')}"]`);
  for (const method of methods) await toggle(add, formContainer, method, false);
  await activate(add, 'Enter');
  const form = page.getByRole('form', { name: 'Add internal user', exact: true });
  for (const channel of NOTIFICATION_CHANNELS) {
    const button = form.getByRole('button', {
      name: NOTIFICATION_CHANNEL_META[channel].label,
      exact: true,
    });
    const id = await button.getAttribute('aria-describedby');
    await expect(page.locator(`[id="${id}"]`)).toHaveText(
      NOTIFICATION_CHANNEL_META[channel].description,
    );
    await expect(page.locator(`[id="${id}"]`)).toBeVisible();
    if (channel === 'email') {
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    } else {
      await activate(button, 'Space');
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await activate(button, 'touch');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
    }
  }
  await axe(page, testInfo, 'settings-expanded-add-form');
  await form.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(formContainer).toBeHidden();
  await expect(add).toBeFocused();
  await activate(add, 'touch');
  await form.getByLabel('Name', { exact: true }).fill('Inventory recipient');
  await form.getByLabel('Work email', { exact: true }).fill('inventory@example.test');
  await form.getByRole('button', { name: 'Add to roster', exact: true }).click();
  await settle(page);
  await expect(formContainer).toBeHidden();
  const team = page.getByRole('region', {
    name: 'Partner team notification routing, scrollable',
    exact: true,
  });
  const added = team.getByRole('row').filter({ hasText: 'Inventory recipient' });
  for (const label of ['Turn on notifications', 'Pause notifications', 'Resume notifications']) {
    const button = added.getByRole('button', { name: label, exact: true });
    await reachable(button);
    await activate(button, label === 'Pause notifications' ? 'touch' : 'Enter');
    await settle(page);
  }
  await added.getByRole('button', { name: 'Remove', exact: true }).tap();
  await expect(added).toHaveCount(0);
  await noOverflow(page);
  await evidence(testInfo, 'DS-035..041-catalog-and-roster', {
    nodes: CONNECTION_NODES.map((node) => node.id),
    edges: [...coveredEdges],
    users: roster.map((user) => user.id),
    templates: NOTIFICATION_TEMPLATES.map((template) => template.id),
    channels: NOTIFICATION_CHANNELS,
  });
  await axe(page, testInfo, 'settings-final-roster-and-composer');
  check();
});
