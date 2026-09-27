import { expect, test, type Page } from '@playwright/test';

const primaryNavigation = (page: Page) => page.getByRole('navigation', { name: 'Primary' });

async function openView(page: Page, name: string) {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Partner Performance Overview' }),
  ).toBeVisible();
  await primaryNavigation(page).getByRole('button', { name }).click();
}

function metricValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('..').locator('p').nth(1);
}

test('editing an open forecast updates live pipeline and weighted metrics', async ({ page }) => {
  await openView(page, 'Forecasting');
  await expect(page.getByRole('heading', { name: 'Forecasting' })).toBeVisible();

  const pipelineValue = metricValue(page, 'Partner sourced pipeline');
  const weightedValue = metricValue(page, 'Weighted forecast');
  const initialPipeline = await pipelineValue.textContent();

  const table = page.getByRole('region', {
    name: 'In-quarter opportunities, scrollable',
  });
  const openOpportunityRow = table
    .getByRole('button', { name: /^Edit forecast category for / })
    .first()
    .locator('xpath=ancestor::tr');
  const editRevenue = openOpportunityRow.getByRole('button', {
    name: /^Edit revenue forecast for /,
  });

  await editRevenue.click();
  const revenueInput = openOpportunityRow.getByRole('textbox', {
    name: /^Revenue forecast for /,
  });
  await revenueInput.fill('-1');
  await openOpportunityRow.getByRole('button', { name: 'Save revenue' }).click();
  await expect(openOpportunityRow.getByRole('alert')).toHaveText(
    'Enter a non-negative number.',
  );

  await revenueInput.fill('987654321');
  await openOpportunityRow.getByRole('button', { name: 'Save revenue' }).click();
  await expect(openOpportunityRow).toContainText('$987,654,321');
  await expect(pipelineValue).not.toHaveText(initialPipeline ?? '');

  const weightedAfterRevenue = await weightedValue.textContent();
  const editedRow = table.getByRole('row').filter({ hasText: '$987,654,321' });
  await editedRow
    .getByRole('button', { name: /^Edit forecast category for / })
    .click();
  const category = editedRow.getByRole('combobox', {
    name: /^Forecast category for /,
  });
  const currentCategory = await category.inputValue();
  const nextCategory = currentCategory === 'commit' ? 'long-shot' : 'commit';
  await category.selectOption(nextCategory);

  await expect(weightedValue).not.toHaveText(weightedAfterRevenue ?? '');
});

test('an authorized roster addition can receive and log a notification', async ({ page }) => {
  await openView(page, 'Data Connections');
  await expect(page.getByRole('heading', { name: 'Data Connections' })).toBeVisible();

  const name = 'Integration Test User';
  const email = 'integration.user@example.com';
  const recipient = page.getByRole('combobox', { name: /^To/ });
  await expect(recipient).not.toContainText(name);

  await page.getByRole('button', { name: 'Add user' }).click();
  const form = page.getByRole('dialog', { name: 'Add internal user' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Work email').fill(email);
  await form.getByRole('button', { name: 'Add to roster' }).click();

  const userRow = page.getByRole('row').filter({ hasText: email });
  await expect(userRow).toContainText('Awaiting authorization');
  await expect(recipient).not.toContainText(name);

  await userRow.getByRole('button', { name: 'Authorize' }).click();
  await expect(userRow).toContainText('Authorized');
  await expect(recipient).toContainText(name);

  await recipient.selectOption({ label: `${name} · Partner Manager` });
  await page.getByRole('button', { name: `Send to ${name}` }).click();

  await expect(page.getByText(/^Delivered /)).toBeVisible();
  await expect(page.getByText('Sent this session · 1', { exact: true })).toBeVisible();
});

test('every simulated partner portal excludes internal Sell To opportunities', async ({
  page,
}) => {
  await openView(page, 'Partner View');
  await expect(page.getByText('In production, scoped by partner SSO')).toBeVisible();

  await page
    .getByRole('group', { name: 'Select fiscal phase' })
    .getByRole('button', { name: 'FY' })
    .click();

  const partnerPicker = page.getByLabel('Viewing as');
  const partnerIds = await partnerPicker.locator('option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value),
  );
  const pipeline = page.getByRole('region', {
    name: 'Pipeline opportunities, scrollable',
  });

  for (const partnerId of partnerIds) {
    await partnerPicker.selectOption(partnerId);
    await expect(pipeline.getByText(/^sell to$/i)).toHaveCount(0);
  }

  await expect(
    page.getByRole('group', { name: 'Slice pipeline by revenue motion' }),
  ).not.toContainText('Sell To');
  await expect(page.getByText('Duplicate & conflicting registrations')).toHaveCount(0);
});
