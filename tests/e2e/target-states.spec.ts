import { expect, test, type Page } from '@playwright/test';

/**
 * Browser evidence that target coverage is a truthful three-way state
 * (VAL-DATA-002) and that manager scoping narrows the target figures to the
 * manager's own partners (VAL-DATA-001). All figures come from the seeded,
 * snapshot-anchored book, so every assertion is deterministic: Northwind
 * Solutions has $1.5M open against its $168K Q3 target with nothing won,
 * Catalyst Growth Partners (the newest partner, joined 2025-11-02) has met
 * its $105K Q3 target with $304K won but has no committed FY27-Q4 target row
 * at all, and the whole org has over-delivered its combined Q3 target.
 */

const primaryNavigation = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

async function openPartnerPerformance(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Partner Performance Overview' })).toBeVisible();
  await primaryNavigation(page).getByRole('button', { name: 'Partner Performance' }).click();
  await expect(page.getByRole('heading', { name: 'Partner Performance' })).toBeVisible();
}

/** KPI tile by its exact label text. */
function kpiTile(page: Page, label: string) {
  // Tile labels are <p> elements; table header cells with the same text are
  // not, so constraining to <p> keeps the lookup unique.
  return page.getByText(label, { exact: true }).and(page.locator('p')).locator('..');
}

test('seeded target smoke: an unmet target shows a finite coverage ratio', async ({ page }) => {
  await openPartnerPerformance(page);

  // Northwind Solutions: $1.5M open in Q3 against a $168K target, nothing
  // closed yet — 9.0x coverage of the remaining quota.
  await page
    .getByRole('combobox', { name: 'Partner', exact: true })
    .selectOption({ label: 'Northwind Solutions' });

  const coverageTile = kpiTile(page, 'Pipeline coverage');
  await expect(coverageTile.locator('p').nth(1)).toHaveText('9.0x');
  await expect(coverageTile).toContainText('$168K sourced target remaining');
  await expect(coverageTile).not.toContainText('Target met');
  await expect(coverageTile).not.toContainText('No target');
});

test('seeded target smoke: a scope with no committed target says No target, never Target met', async ({
  page,
}) => {
  await openPartnerPerformance(page);

  // The seeded newest partner has not committed a target for the upcoming
  // quarter (FY27 Q4), so this scope is the honest "no target" case.
  await page
    .getByRole('combobox', { name: 'Partner', exact: true })
    .selectOption({ label: 'Catalyst Growth Partners' });
  await page.getByRole('button', { name: 'Q4' }).click();

  const coverageTile = kpiTile(page, 'Pipeline coverage');
  await expect(coverageTile.locator('p').nth(1)).toHaveText('No target');
  await expect(coverageTile).toContainText('No sourced target set');

  // Attainment is reported as zero against the missing goal, not as ∞ or NaN.
  const closedWonTile = kpiTile(page, 'Closed-won Q4');
  await expect(closedWonTile).toContainText('0% of Q4 target');
  await expect(page.getByText(/∞|NaN/)).toHaveCount(0);
});

test('seeded target smoke: a partner whose closed-won reached the target shows Target met', async ({
  page,
}) => {
  await openPartnerPerformance(page);

  // Catalyst Growth Partners closed $304K against its $105K Q3 target.
  await page
    .getByRole('combobox', { name: 'Partner', exact: true })
    .selectOption({ label: 'Catalyst Growth Partners' });

  const coverageTile = kpiTile(page, 'Pipeline coverage');
  await expect(coverageTile.locator('p').nth(1)).toHaveText('Target met');
  await expect(coverageTile).toContainText('Sourced target achieved');
  await expect(coverageTile).not.toContainText(/\d\.\dx/);

  const closedWonTile = kpiTile(page, 'Closed-won Q3');
  await expect(closedWonTile).toContainText('290% of Q3 target');
});

test('seeded target smoke: the whole-org home tile shows Target met, not a ratio over a zero gap', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Partner Performance Overview' })).toBeVisible();

  // The seeded org closed $2.8M against a $1.7M Q3 target.
  const tile = kpiTile(page, 'Partner sourced pipeline coverage');
  await expect(tile.locator('p').nth(1)).toHaveText('Target met');
  await expect(tile).toContainText('Sourced target achieved');
});

test('VAL-DATA-001: a manager scope reports only that manager’s partner targets', async ({
  page,
}) => {
  await openPartnerPerformance(page);

  // Whole org: every partner's Q3 target counts toward attainment.
  const closedWonTile = kpiTile(page, 'Closed-won Q3');
  await expect(closedWonTile).toContainText('160% of Q3 target');

  // Alex Morgan owns 5 of the 25 seeded partners; scoping must recompute
  // attainment from their targets and wins alone ($1.4M won of $505K).
  await page
    .getByRole('combobox', { name: 'Partner manager' })
    .selectOption({ label: 'Alex Morgan' });
  await expect(page.getByText('Scope · Alex Morgan · 5 partners')).toBeVisible();
  await expect(closedWonTile).toContainText('278% of Q3 target');

  // And the coverage state is recomputed for the scope, not inherited.
  const coverageTile = kpiTile(page, 'Pipeline coverage');
  await expect(coverageTile.locator('p').nth(1)).toHaveText('Target met');
  await expect(coverageTile).toContainText('Sourced target achieved');
});
