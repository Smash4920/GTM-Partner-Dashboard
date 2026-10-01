# Target-state browser evidence

Run the complete VAL-DATA-002 matrix from the repository root:

```sh
npm run test:e2e -- --grep VAL-DATA-002
```

The runner uses Playwright's own test discovery to preserve grep, file, and
project selection. The three fixture cases run before other selected E2E tests,
serially with one worker and no retries. Existing seeded target smoke tests and
VAL-DATA-001 remain in the ordinary suite. The ordinary suite's current server
default is unchanged; its final production-preview migration is separate.
The serial runner rejects `--shard` rather than silently reassigning tests when
splitting the selected suite into two runs.
Until that migration, `E2E_PRODUCTION_PREVIEW=1 npm run test:e2e` opts the ordinary
suite into a strict, non-reused production preview after the fixture previews
finish. Use this harness-only option for the full gate, so no development server
is started. It is not a browser flag or production application control.

Each case builds a test-only HTML entry in `tests/fixtures/target-states/` into
its own system temporary directory, then starts Vite **production preview** on
`127.0.0.1:4173` with `/` base and `--strictPort`. Keep that port free when
running the matrix. It neither starts development/HMR nor reuses another server.
The runner terminates the exact preview PID, verifies it no longer exists, and
removes only its own temporary output before the next case.

The entries render the real `App`, with normal fonts, styles, error boundary,
StrictMode, and performance initialization. The existing `providerFactory` seam
supplies a real `MockDataProvider` over `makeProviderBook`:

| Fixture      | FY27-Q3 target | Open pipeline | Closed-won | Coverage   |
| ------------ | -------------- | ------------- | ---------- | ---------- |
| `finite`     | $500,000       | $250,000      | $0         | `0.5x`     |
| `no-target`  | No target row  | $250,000      | $0         | No target  |
| `target-met` | $500,000       | $0            | $500,000   | Target met |

The complete route inventory is **Home, Forecasting, Partner Performance, and
Partner View**. Every fixture traverses all four through the real sidebar and
uses their existing manager/partner/phase filters. Assertions distinguish
missing and achieved targets, reject ordinary ratios for both nonnumeric states,
and forbid `Infinity`, `NaN`, or `∞` anywhere in the rendered page.
Partner View's subtitle uses lowercase `no target` / `target met`.

## Evidence

- HTML report: `build-metrics/target-state-fixtures/report/index.html`.
- Twelve explicit full-page screenshots and three JSON evidence attachments:
  `build-metrics/target-state-fixtures/results/`.
- Each JSON attachment records the state, all four observed KPI texts,
  screenshot names, built JS/CSS filenames and SHA-256 hashes, same-origin GET
  requests, console/page errors, runner and preview PIDs, and verified teardown.
- Failure screenshots and traces stay beside the affected case.
- Ordinary browser artifacts use `test-results/e2e/`, preserving the full
  gate's `test-results/vitest-junit.xml`. The opt-in ordinary production-preview
  run records its verified PID teardown in `build-metrics/e2e-preview-lifecycle.json`.

Fixture evidence lives outside the ordinary Playwright output directory so a
subsequent ordinary E2E run does not erase it. These generated artifacts are
ignored, not committed.

For an independent `agent-browser` check, start **one** fixture at a time:

```sh
npm run test:e2e:fixture-preview -- finite
# Repeat serially with no-target and target-met.
```

The command prints a JSON `ready` record with its URL and preview PID. Navigate
to that exact URL using your assigned named browser session. Stop the runner by
its recorded PID (or Ctrl+C locally), wait for its JSON `stopped` record with
`pidStopped: true`, and close the browser session before moving on.

## Isolation

There is no fixture selector, query-string QA mode, or fixture control in the
production application. Ordinary `npm run build` still uses only `index.html`
and `src/main.tsx`. It cannot reach these alternate entries, does not ship their
HTML or `data-target-state` marker, and preserves normal provider choices, seeded
volumes, and the existing Partner View picker. No dependency or production
budget changes are needed. This evidence verifies only the client demo, not
production authorization or an external deployment.
