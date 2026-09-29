## Description

<!-- What changes and why. Link the issue if one exists. -->

## Data contract changes

<!-- Per AGENTS.md: call out any change to DashboardData, ProviderBook,
     DataProvider methods, DATA_PROVIDER_METHODS registration, or
     connections.ts wiring. "None" is a complete answer. -->

- [ ] No changes to the data contract (presentation, test, docs, or tooling only).

## Testing

<!-- Commands run, in the CI order from AGENTS.md. An unchecked box means it
     was not run -- say why. -->

- [ ] `npm run check:file-limits`
- [ ] `npm run format:check`
- [ ] `npm run test:debt`
- [ ] `npm run debt:check`
- [ ] `npm run lint`
- [ ] `npm run dead-code`
- [ ] `npm run lint:duplicates`
- [ ] `npm run test:coverage`
- [ ] `npm run test:e2e`
- [ ] `npm run build`

## Screenshots

<!-- For UI changes: before and after, at desktop and narrow widths. -->

## Risk

<!-- What could break, who notices first, and the blast radius. Call out
     partner-data boundary impact: Partner View must not expose Sell To
     opportunities, conflicting registrations, or another partner's data. -->

## Rollback

<!-- How to unwind the change. This is a client-only app: Vercel previews
     promote with the merge and GitHub Pages deploys are manual, so a revert
     commit is usually the whole story. Say whether anything else needs
     unwinding -- pinned fixtures, coverage thresholds, provider wiring, or
     workflow permissions. -->
