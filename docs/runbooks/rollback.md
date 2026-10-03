# Rollback runbook

## Signal

A deploy renders a blank page, crashes on load, shows wrong business numbers, or
fails a smoke check after merge.

## Preferred rollback: revert the merge

Because the app has no persisted state, a rollback is a build artifact swap.
Prefer a revert commit to a force-push or a history rewrite.

1. Identify the merge commit on `main` that introduced the problem.
2. Revert it without rewriting history:

   ```bash
   git revert -m 1 <merge-commit-sha>
   ```

3. Push the revert to `main`. Record what was reverted and why in the revert
   commit body.
4. Release Please opens a new release pull request; merge it to tag the revert.

## Platform rollback: redeploy the previous build

If a revert is not possible quickly, redeploy the last known-good deployment in
Vercel, then still land the revert so `main` and production agree.

- Vercel: open the project, choose the previous successful production
  deployment, and promote it.
- GitHub Pages: land the revert on `main`, then run `deploy-pages.yml` from
  `main` with `workflow_dispatch`. Both jobs require `refs/heads/main`; the
  workflow has no arbitrary historical-commit checkout option.

## Confirm recovery

1. Load the production URL and confirm the smoke checks in
   [`deployment.md`](./deployment.md).
2. Confirm charts, KPIs, and the provider selector behave as before.
3. Confirm no new error-level records in the browser console.

## Follow-up

- Open an issue with the failing signal, the change that caused it, and the gap
  in CI that let it through.
- Add a regression test or a budget in `config/` so the same change fails before
  merge.
- If the cause was a dependency, re-run `npm run bundle:check` and review
  `config/dependency-budgets.json`.
