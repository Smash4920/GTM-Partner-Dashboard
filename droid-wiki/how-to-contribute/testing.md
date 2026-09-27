# Testing

The repository uses two complementary test suites:

- Vitest covers pure fiscal, metric, notification, connection-catalog, and
  deterministic mock-data behavior.
- Playwright runs the complete Vite application in Chromium and verifies
  user journeys that cross providers, React state, views, and components.

## Run the checks

Install the locked dependencies and the Chromium browser once:

```bash
npm ci
npx playwright install chromium
```

Then run the same checks used by CI:

```bash
npm run lint
npm test
npm run test:e2e
npm run build
```

Use `npm test -- <path>` for one Vitest file, or
`npm run test:e2e -- --grep "<name>"` for one Playwright journey.

## Browser coverage

The tests in `tests/e2e/` start Vite through `playwright.config.ts` and cover:

- Editing an open opportunity, including invalid revenue handling, and
  confirming that pipeline and weighted forecast metrics recompute.
- Adding a partner-team user, enforcing the authorization gate, sending a
  notification, and recording its delivery in the session log.
- Switching through every simulated partner account and verifying the
  partner-facing pipeline never exposes internal Sell To opportunities.

These checks deliberately use the rendered application rather than importing
components or mock records. They protect integration boundaries that unit tests
cannot: provider loading, navigation, state propagation, and confidentiality in
the partner portal.

## Determinism and artifacts

The mock provider uses a fixed seed and snapshot date, so browser assertions do
not depend on the wall clock or network. Each Playwright test gets a fresh
browser context because dashboard edits are session-only.

Failure traces, screenshots, and the HTML report are generated under
`test-results/` and `playwright-report/`. Both directories are gitignored.

## Related pages

- [How to contribute](index.md)
- [Development workflow](development-workflow.md)
- [Data provider](../systems/data-provider.md)
