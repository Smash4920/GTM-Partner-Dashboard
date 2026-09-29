# Runbooks

Operational procedures for the GTM Partner Dashboard. Every runbook names the
signal to watch, the first diagnostic step, the mitigation, and how to confirm
recovery. Keep them short enough to follow under pressure and specific enough
that a new on-call engineer can execute them without reading the source first.

| Runbook                                          | Use when                                                      |
| ------------------------------------------------ | ------------------------------------------------------------- |
| [`deployment.md`](./deployment.md)               | You are merging to `main`, building, or publishing the app.   |
| [`rollback.md`](./rollback.md)                   | A deploy is bad and you need to restore a known-good build.   |
| [`incident-response.md`](./incident-response.md) | The app is broken, slow, or showing wrong data in production. |
| [`ci-failure.md`](./ci-failure.md)               | A required check is red and the cause is not obvious.         |

## Context you need

- The app is client-only. It reads deterministic mock data through the
  `DataProvider` seam (`src/data/DataProvider.ts`); there is no backend,
  database, or user data to lose.
- The demo book is frozen at `SNAPSHOT_DATE` (2026-09-18). Numbers that look
  "stale" are usually the snapshot, not a data incident.
- User edits live in React state for the session only. A reload discards them by
  design; do not treat a discarded edit as data loss.
- Structured logs come from `src/lib/logging.ts`. Errors are caught by
  `src/components/ErrorBoundary.tsx`.
- The three providers are local mock (default), simulated remote (adds latency
  and a 15% failure rate), and scaled 100x.

## Escalation

The repository is private to the GTM team. Escalate to the on-call owner of the
deployment platform first (Vercel), then to the repository maintainer listed in
`CODEOWNERS` for contract or data-boundary questions.
