# Incident response runbook

## Scope

Use this when the deployed dashboard is unavailable, visibly broken, or showing
business numbers that disagree with the intended contract. It is not for a
single user's session-state edits vanishing on reload; that is expected
behavior.

## Severity

| Severity | Meaning                                                              |
| -------- | -------------------------------------------------------------------- |
| SEV1     | The app does not load for anyone, or exposes another partner's data. |
| SEV2     | A whole view is broken or blank, or a headline KPI is clearly wrong. |
| SEV3     | A single widget, tooltip, or interaction misbehaves.                 |

## First five minutes

1. Confirm the blast radius. Ask whether the reporter sees it in a Vercel preview
   or production, and which provider is selected in the header.
2. Reproduce on the production URL with the default local mock provider.
3. Capture evidence: browser console records, the failing view, the fiscal
   quarter selected, and the partner manager scope.
4. Check whether a deploy or release landed in the last hour. If so, start
   [`rollback.md`](./rollback.md) in parallel with diagnosis.

## Diagnose by symptom

### Blank page or 404s on `/assets/*`

Almost always a base-path mismatch. Confirm the host sets `VERCEL` or that
`BASE_PATH` is correct for the deployment target. See
[`deployment.md`](./deployment.md).

### Crash with an error boundary

- Read the rendered fallback and the console records from
  `src/components/ErrorBoundary.tsx` and `src/lib/logging.ts`.
- The application record uses the component, stable technical classification,
  and fingerprint, not raw exception prose. Capture technical identifiers and
  counts only; never copy names, notes, raw records, messages, or stacks.

### Wrong business number

- Confirm the provider and the selected fiscal phase first.
- Confirm the change did not alter a rule in `src/lib/metrics.ts`. That module
  is the specification a server must match, and its suite plus
  `MockDataProvider.test.ts` are the conformance check.
- Remember the book is frozen at `SNAPSHOT_DATE` (2026-09-18). A number that
  looks days out of date is the snapshot, not a data incident.
- Registrations use a 5-business-day SLA and a 60-calendar-day exclusivity
  window. Compare in the same unit the view reports.

### Slow or flaky view

- Switch the provider to simulated remote to confirm loading, error, and retry
  paths, then back to local mock.
- With Scaled 100×, generation and aggregation still happen locally, but all
  routes now use bounded scoped answers and cursor pages. Diagnose unexpected
  work or regressions rather than accepting a whole-book payload.

### Suspected partner-data boundary breach

Treat as SEV1.

1. Confirm whether Partner View rendered Sell To opportunities, conflicting
   registrations, or records outside the currently selected partner.
   Selecting another partner through the untrusted demo picker is an
   acknowledged limitation, not a failure of that projection. Client filtering
   is not authorization; external use remains blocked on trusted server access.
2. Capture the partner selected and a screenshot before changing anything.
3. Follow [`rollback.md`](./rollback.md) to remove the build from production.
4. Escalate to the repository maintainer before any further deploy.

## Mitigate

Client-only incidents are mitigated by rolling back the build
([`rollback.md`](./rollback.md)). There is no database to fail over and no
persisted user data to restore.

## Recover and follow up

1. Confirm the smoke checks in [`deployment.md`](./deployment.md) pass.
2. Write a short timeline: detection, cause, mitigation, recovery.
3. Add the missing automated check. Candidates: a new budget in `config/`, a new
   assertion in the conformance suite, or a new step in
   `.github/workflows/ci.yml`.
