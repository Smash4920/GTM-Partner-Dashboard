import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ROUTES } from '../../src/data/routes';
import {
  JOURNEY_VIEWPORTS,
  keyboardJourney,
  productionObservations,
  retain,
  settled,
} from './support/accessibility-journeys';

// The registry is the closed inventory, not a manually maintained sample.
// Production Requirements must be visible under the default production flag.
for (const viewport of JOURNEY_VIEWPORTS) {
  for (const route of ROUTES) {
    test(`VAL-A11Y-012 VAL-QUAL-005: ${route.id} full-page axe ${viewport.width}x${viewport.height}`, async ({
      page,
    }, info) => {
      const check = productionObservations(page);
      const keyboard = keyboardJourney(page);
      try {
        await page.setViewportSize(viewport);
        await page.goto('/');
        await settled(page);
        await keyboard.press('Tab');
        await keyboard.navigate(route.label);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('');
        await expect(page).toHaveTitle(`${route.label} | Gantry`);
        await expect(
          page
            .getByRole('navigation', { name: 'Primary', includeHidden: true })
            .getByRole('button', {
              name: route.label,
              exact: true,
              includeHidden: true,
            }),
        ).toHaveAttribute('aria-current', 'page');
        const result = await new AxeBuilder({ page }).analyze();
        await retain(info, `axe-route-${route.id}-${viewport.width}x${viewport.height}`, {
          validationId: 'VAL-A11Y-012',
          route,
          viewport,
          title: await page.title(),
          url: page.url(),
          state: 'default deterministic local provider; production flags unchanged',
          violationCount: result.violations.length,
          violations: result.violations,
        });
        expect(result.violations).toEqual([]);
      } finally {
        await check(info);
      }
    });
  }
}

// Action Center is the Settings route's second tab rather than a registry
// entry, so it gets the same sweep with its own two selectors: the tab for
// the control, the Settings route for the current-page mark.
for (const viewport of JOURNEY_VIEWPORTS) {
  test(`VAL-A11Y-012 VAL-QUAL-005: action-center tab full-page axe ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    const check = productionObservations(page);
    const keyboard = keyboardJourney(page);
    try {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await settled(page);
      await keyboard.press('Tab');
      await keyboard.navigate('Action Center');
      await expect(page.getByRole('heading', { name: 'Action Center', level: 2 })).toBeVisible();
      await expect(page).toHaveTitle('Settings | Gantry');
      await expect(page.getByRole('tab', { name: 'Action Center', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page
          .getByRole('navigation', { name: 'Primary', includeHidden: true })
          .getByRole('button', { name: 'Settings', exact: true, includeHidden: true }),
      ).toHaveAttribute('aria-current', 'page');
      const result = await new AxeBuilder({ page }).analyze();
      await retain(info, `axe-action-center-tab-${viewport.width}x${viewport.height}`, {
        validationId: 'VAL-A11Y-012',
        route: { id: 'action-center', label: 'Action Center' },
        viewport,
        title: await page.title(),
        url: page.url(),
        state: 'default deterministic local provider; Settings route, Action Center tab',
        violationCount: result.violations.length,
        violations: result.violations,
      });
      expect(result.violations).toEqual([]);
    } finally {
      await check(info);
    }
  });
}
