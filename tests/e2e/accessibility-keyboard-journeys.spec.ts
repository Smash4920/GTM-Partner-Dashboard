import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  JOURNEY_VIEWPORTS,
  keyboardJourney,
  linkedError,
  productionObservations,
  retain,
  settled,
} from './support/accessibility-journeys';

type Keyboard = ReturnType<typeof keyboardJourney>;

async function cancelAndRecord(
  page: Page,
  keyboard: Keyboard,
  invoker: Locator,
  title: string,
  outcome: string,
) {
  await keyboard.activate(invoker);
  const dialog = page.getByRole('dialog', { name: title, exact: true });
  const reason = dialog.getByLabel('Reason', { exact: true });
  await keyboard.type(reason, 'Cancelled session-only draft');
  await keyboard.press('Escape');
  const discard = page.getByRole('dialog', { name: 'Discard unsaved workflow?', exact: true });
  await keyboard.activate(discard.getByRole('button', { name: 'Keep editing', exact: true }));
  await expect(reason).toHaveValue('Cancelled session-only draft');
  await keyboard.press('Escape');
  await keyboard.activate(discard.getByRole('button', { name: 'Discard', exact: true }));
  await expect(invoker).toBeFocused();
  await keyboard.checkpoint(`${title} kept then discarded`);
  await keyboard.activate(invoker);
  await keyboard.select(dialog.getByLabel('Demo actor (not authenticated)'), 'user-01');
  await keyboard.select(dialog.getByLabel('Outcome', { exact: true }), outcome);
  await keyboard.type(reason, 'Session-only keyboard outcome');
  await keyboard.activate(dialog.getByRole('button', { name: 'Record session outcome' }));
  const recorded = page.getByRole('dialog', { name: 'Session outcome recorded', exact: true });
  await expect(recorded).toContainText(`outcome ${outcome}`);
  await expect(recorded).toContainText('not authenticated');
  await keyboard.checkpoint(`${title} recorded locally`, recorded);
  await keyboard.activate(recorded.getByRole('button', { name: 'Close', exact: true }));
  await expect(invoker).toBeFocused();
}

async function journey(
  page: Page,
  info: TestInfo,
  viewport: (typeof JOURNEY_VIEWPORTS)[number],
  run: (keyboard: Keyboard) => Promise<void>,
) {
  const check = productionObservations(page);
  const keyboard = keyboardJourney(page);
  try {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await settled(page);
    await keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();
    await run(keyboard);
    await keyboard.navigate('Home');
    await keyboard.checkpoint('returned through primary navigation');
  } finally {
    await retain(info, 'keyboard-action-focus-and-state-trace', {
      title: info.title,
      viewport,
      url: page.url(),
      trace: keyboard.trace,
    });
    await check(info);
  }
}

test.setTimeout(180_000);

for (const viewport of JOURNEY_VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`VAL-A11Y-013: conflict, forecast-review and Settings notification keyboard-only ${size}`, async ({
    page,
  }, info) => {
    await journey(page, info, viewport, async (keyboard) => {
      await keyboard.navigate('Forecasting');
      const table = page.getByRole('region', { name: /^In-quarter opportunities/ });
      const opener = table.getByRole('button', { name: /^Edit revenue forecast for / }).first();
      await keyboard.activate(opener);
      await keyboard.type(table.getByRole('textbox', { name: /^Revenue forecast for / }), '765432');
      await keyboard.activate(table.getByRole('button', { name: 'Save revenue', exact: true }));
      await settled(page);
      await keyboard.navigate('Deal Reg Ops');
      await cancelAndRecord(
        page,
        keyboard,
        page.getByRole('button', { name: /^Disposition reg-/ }).first(),
        'Partner-conflict disposition',
        'share-credit',
      );
      await cancelAndRecord(
        page,
        keyboard,
        page.getByRole('button', { name: /^Review change-/ }).first(),
        'Forecast-change review',
        'accepted',
      );
      await keyboard.navigate('Settings');
      const panel = page.getByRole('group', { name: 'The notification composer', exact: true });
      const recipient = panel.getByLabel('To', { exact: true });
      const recipientId = (await recipient
        .locator('option:not([disabled])')
        .first()
        .getAttribute('value'))!;
      await keyboard.select(recipient, recipientId);
      await keyboard.select(panel.getByLabel('Template', { exact: true }), 'custom');
      const subject = panel.getByLabel('Subject', { exact: true });
      const message = panel.getByLabel('Message', { exact: true });
      const send = panel.getByRole('button', { name: /^Send to / });
      await keyboard.activate(send);
      await expect(subject).toBeFocused();
      await linkedError(subject, 'A subject is required.');
      await linkedError(message, 'A message is required.');
      await keyboard.checkpoint('Settings inline invalid notification', panel);
      await keyboard.type(subject, 'Session-only keyboard notification');
      await keyboard.type(message, 'Simulated local-only keyboard message.');
      await keyboard.activate(send);
      await expect(panel.getByText(/Simulated \/ local only · \d/)).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(panel.getByRole('button', { name: 'Close notification' })).toHaveCount(0);
      await keyboard.checkpoint('Settings inline local feedback, no close control', panel);
    });
  });

  test(`VAL-A11Y-013: forecast cancel/save, validation and disclosures keyboard-only ${size}`, async ({
    page,
  }, info) => {
    await journey(page, info, viewport, async (keyboard) => {
      await keyboard.navigate('Forecasting');
      const table = page.getByRole('region', { name: /^In-quarter opportunities/ });
      const categoryButton = table
        .getByRole('button', { name: /^Edit forecast category for / })
        .first();
      const account = (await categoryButton.getAttribute('aria-label'))!.replace(
        'Edit forecast category for ',
        '',
      );
      const rowIndex = await categoryButton.evaluate(
        (element) => (element.closest('tr') as HTMLTableRowElement).rowIndex,
      );
      const row = table.getByRole('row').nth(rowIndex);
      const revenueButton = row.getByRole('button', {
        name: `Edit revenue forecast for ${account}`,
        exact: true,
      });
      const revenue = row.getByRole('textbox', {
        name: `Revenue forecast for ${account}`,
        exact: true,
      });
      await keyboard.activate(revenueButton);
      const originalRevenue = await revenue.inputValue();
      await keyboard.type(revenue, '123456');
      await keyboard.activate(row.getByRole('button', { name: 'Cancel revenue edit' }));
      await expect(revenueButton).toBeFocused();
      await keyboard.activate(revenueButton);
      await expect(revenue).toHaveValue(originalRevenue);
      await keyboard.type(revenue, '-1');
      await keyboard.activate(row.getByRole('button', { name: 'Save revenue', exact: true }));
      await expect(revenue).toBeFocused();
      await linkedError(revenue, 'Enter a non-negative number.');
      await keyboard.checkpoint('invalid revenue blocked with linked error', row);
      await keyboard.type(revenue, '987654');
      await expect(revenue).not.toHaveAttribute('aria-invalid', 'true');
      await keyboard.activate(row.getByRole('button', { name: 'Save revenue', exact: true }));
      await settled(page);
      await expect(revenueButton).toBeFocused();
      await keyboard.activate(revenueButton);
      await expect(revenue).toHaveValue('987654');
      await keyboard.press('Escape');
      await expect(revenueButton).toBeFocused();
      await keyboard.checkpoint('revenue saved and reopened', row);

      const category = row.getByRole('combobox', {
        name: `Forecast category for ${account}`,
        exact: true,
      });
      await keyboard.activate(categoryButton);
      const initialCategory = await category.inputValue();
      await keyboard.press('Escape');
      await expect(categoryButton).toBeFocused();
      await keyboard.activate(categoryButton);
      await expect(category).toHaveValue(initialCategory);
      // These native select changes commit instantly and remove the editor.
      // Two different endpoints ensure one change even at an endpoint.
      await keyboard.press('Home');
      if (await category.count()) await keyboard.press('End');
      await expect(categoryButton).toBeFocused();
      await keyboard.activate(categoryButton);
      const committedCategory = await category.inputValue();
      expect(committedCategory).not.toBe(initialCategory);
      await keyboard.press('Escape');
      await keyboard.checkpoint('category cancelled unchanged then committed', row);

      for (const field of ['next step', 'note'] as const) {
        const opener = () =>
          row.getByRole('button', { name: new RegExp(`^(Add|Edit) ${field} for `) }).first();
        const input = row.getByRole('textbox', {
          name: `${field === 'note' ? 'Note' : 'Next step'} for ${account}`,
          exact: true,
        });
        await keyboard.activate(opener());
        const original = await input.inputValue();
        await keyboard.type(input, `Cancelled ${field}`);
        await keyboard.activate(row.getByRole('button', { name: `Cancel ${field} edit` }));
        await expect(opener()).toBeFocused();
        await keyboard.activate(opener());
        await expect(input).toHaveValue(original);
        const saved = `Session-only keyboard ${field}`;
        await keyboard.type(input, saved);
        await keyboard.activate(row.getByRole('button', { name: `Save ${field}`, exact: true }));
        await settled(page);
        await expect(opener()).toBeFocused();
        await keyboard.activate(opener());
        await expect(input).toHaveValue(saved);
        await keyboard.press('Escape');
        await keyboard.checkpoint(`${field} cancelled and saved`, row);
      }
      const viewNote = row.getByRole('button', { name: `View note for ${account}`, exact: true });
      await keyboard.activate(viewNote);
      const hideNote = row.getByRole('button', { name: `Hide note for ${account}`, exact: true });
      await expect(hideNote).toHaveAttribute('aria-expanded', 'true');
      await expect(row.getByText('Session-only keyboard note', { exact: true })).toBeVisible();
      await keyboard.checkpoint('note disclosure open', row);
      await keyboard.activate(hideNote);
      await expect(viewNote).toHaveAttribute('aria-expanded', 'false');
      await expect(row.getByText('Session-only keyboard note', { exact: true })).toHaveCount(0);

      const offStage = table.locator('summary[aria-label^="Off stage explanation for "]').first();
      const details = offStage.locator('..');
      await keyboard.activate(offStage);
      await expect(details).toHaveAttribute('open', '');
      await expect(details.locator('p')).toContainText(/Called .+ which implies/);
      await keyboard.checkpoint('off-stage explanation available without hover', details);
      await keyboard.activate(offStage);
      await expect(details).not.toHaveAttribute('open');
    });
  });

  test(`VAL-A11Y-013: meeting classification and workflow cancel/complete keyboard-only ${size}`, async ({
    page,
  }, info) => {
    await journey(page, info, viewport, async (keyboard) => {
      await keyboard.navigate('Activity Tracking');
      const log = page.getByRole('button', { name: 'Log Meetings', exact: true });
      await keyboard.activate(log);
      const meeting = page.getByRole('dialog', { name: 'Log meetings · Alex Morgan', exact: true });
      const partner = meeting.getByRole('combobox', { name: /^Partner for / }).first();
      const callType = meeting.getByRole('combobox', { name: /^Call type for / }).first();
      await expect(partner).toBeVisible();
      const partnerValue = (await partner
        .locator('option:not([value=""]):not([value="__add_partner__"])')
        .first()
        .getAttribute('value'))!;
      await keyboard.select(partner, partnerValue);
      const originalType = await callType.inputValue();
      const types = await callType
        .locator('option')
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
      const selectedType = types.find((value) => value !== originalType)!;
      await keyboard.select(callType, selectedType);
      await keyboard.checkpoint('meeting classified draft', meeting);
      await keyboard.activate(meeting.getByRole('button', { name: 'Submit classifications' }));
      await expect(meeting).toHaveCount(0);
      await expect(log).toBeFocused();
      await keyboard.activate(log);
      await expect(partner).toHaveValue(partnerValue);
      await expect(callType).toHaveValue(selectedType);
      await keyboard.activate(meeting.getByRole('button', { name: 'Cancel', exact: true }));
      await expect(meeting).toHaveCount(0);
      await expect(log).toBeFocused();
      await keyboard.checkpoint('meeting saved, reopened and closed');

      await keyboard.navigate('Deal Reg Ops');
      const queue = page
        .getByRole('heading', { name: 'Registrations awaiting review' })
        .locator('xpath=ancestor::section[1]');
      const decide = queue.getByRole('button', { name: /^Decide reg-/ }).first();
      await keyboard.activate(decide);
      const workflow = page.getByRole('dialog', { name: 'Registration decision', exact: true });
      const reason = workflow.getByLabel('Reason', { exact: true });
      await expect(reason).toBeVisible();
      await keyboard.type(reason, 'Cancelled session-only reason');
      await keyboard.activate(workflow.getByRole('button', { name: 'Cancel', exact: true }));
      const discard = page.getByRole('dialog', { name: 'Discard unsaved workflow?', exact: true });
      await keyboard.activate(discard.getByRole('button', { name: 'Keep editing', exact: true }));
      await expect(reason).toHaveValue('Cancelled session-only reason');
      await keyboard.activate(workflow.getByRole('button', { name: 'Cancel', exact: true }));
      await keyboard.activate(discard.getByRole('button', { name: 'Discard', exact: true }));
      await expect(workflow).toHaveCount(0);
      await expect(decide).toBeFocused();
      await keyboard.checkpoint('dirty workflow kept then discarded');

      await keyboard.activate(decide);
      await keyboard.select(workflow.getByLabel('Demo actor (not authenticated)'), 'user-01');
      await keyboard.select(workflow.getByLabel('Outcome', { exact: true }), 'approved');
      await keyboard.type(reason, 'Session-only keyboard approval');
      await keyboard.activate(workflow.getByRole('button', { name: 'Record session outcome' }));
      const recorded = page.getByRole('dialog', { name: 'Session outcome recorded', exact: true });
      await expect(recorded).toContainText('outcome approved');
      await expect(recorded).toContainText('Session-only');
      await expect(recorded).toContainText('not authenticated');
      await keyboard.checkpoint('workflow recorded locally', recorded);
      await keyboard.activate(recorded.getByRole('button', { name: 'Close', exact: true }));
      await expect(recorded).toHaveCount(0);
      await expect(decide).toBeFocused();
    });
  });

  test(`VAL-A11Y-013: Action Center evidence, pagination and inline notification keyboard-only ${size}`, async ({
    page,
  }, info) => {
    await journey(page, info, viewport, async (keyboard) => {
      await keyboard.navigate('Action Center');
      const rows = page.getByTestId('action-item');
      await expect(rows).toHaveCount(25);
      const first = rows.first();
      const evidence = first.getByRole('button', { name: /^Show evidence for / });
      const actionId = (await first.getAttribute('data-action-id'))!;
      await keyboard.activate(evidence);
      await expect(evidence).toHaveAttribute('aria-expanded', 'true');
      const details = first.getByRole('region', { name: `Evidence for ${actionId}`, exact: true });
      await expect(details).toBeVisible();
      await keyboard.checkpoint('action evidence expanded', first);
      await keyboard.activate(evidence);
      await expect(evidence).toHaveAttribute('aria-expanded', 'false');
      await expect(details).toHaveCount(0);

      const more = page.getByRole('button', { name: 'Load 25 more', exact: true });
      let previousIds = await rows.evaluateAll((items) =>
        items.map((item) => item.getAttribute('data-action-id')),
      );
      for (const expected of [50, 75, 85]) {
        await keyboard.activate(more);
        await expect(rows).toHaveCount(expected);
        await expect(more).toBeFocused();
        const ids = await rows.evaluateAll((items) =>
          items.map((item) => item.getAttribute('data-action-id')),
        );
        expect(new Set(ids).size).toBe(expected);
        expect(ids.slice(0, previousIds.length)).toEqual(previousIds);
        previousIds = ids;
        await keyboard.checkpoint(`pagination ${expected} unique rows, retained focus`, more);
      }
      await expect(more).toBeDisabled();
      await expect(page.getByText('Showing 85 of 85 action items', { exact: true })).toBeVisible();

      const notify = page
        .getByRole('button', { name: 'Notify owner', exact: true })
        .and(page.locator('button:not([disabled])'))
        .first();
      const notificationId = (await notify
        .locator('xpath=ancestor::li[1]')
        .getAttribute('data-action-id'))!;
      const notificationRow = page.locator(`[data-action-id="${notificationId}"]`);
      await keyboard.activate(notify);
      const panel = notificationRow.getByRole('region', {
        name: `Notification for ${notificationId}`,
        exact: true,
      });
      const subject = panel.getByLabel('Subject', { exact: true });
      const message = panel.getByLabel('Message', { exact: true });
      await expect(subject).toBeVisible();
      await keyboard.type(subject, '   ');
      await keyboard.type(message, '   ');
      const send = panel.getByRole('button', { name: /^Send to / });
      await keyboard.activate(send);
      await expect(subject).toBeFocused();
      await linkedError(subject, 'A subject is required.');
      await linkedError(message, 'A message is required.');
      await keyboard.checkpoint('inline notification validation blocked', panel);
      await keyboard.type(subject, 'Session-only keyboard notification');
      await keyboard.activate(send);
      await expect(message).toBeFocused();
      await keyboard.type(message, 'Simulated local-only keyboard message.');
      const email = panel.getByRole('checkbox', { name: 'Use Email', exact: true });
      await keyboard.reach(email);
      if (!(await email.isChecked())) await keyboard.press('Space');
      await expect(email).toBeChecked();
      await keyboard.activate(send);
      await expect(panel.getByText(/Simulated \/ local only · \d/)).toBeVisible();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await keyboard.checkpoint('notification simulated locally without a dialog', panel);
      const close = notificationRow.getByRole('button', {
        name: 'Close notification',
        exact: true,
      });
      await keyboard.activate(close);
      await expect(panel).toHaveCount(0);
      await expect(notificationRow.getByRole('button', { name: 'Notify owner' })).toBeFocused();
    });
  });
}
