# Target-state browser evidence

Run the complete VAL-DATA-002 matrix from the repository root:

```sh
npm run test:e2e -- --grep VAL-DATA-002
```

The runner uses Playwright's own test discovery to preserve grep, file, and
project selection. The three fixture cases run before other selected E2E tests,
serially with one worker and no retries. Existing seeded target smoke tests and
VAL-DATA-001 remain in the ordinary suite. The ordinary suite builds `dist` with
`BASE_PATH=/` and starts strict production preview on `127.0.0.1:4173`.
The serial runner rejects `--shard` rather than silently reassigning tests when
splitting the selected suite into two runs.
Ordinary preview never overlaps the serial fixtures and never reuses a server.
Local and CI ordinary runs use four browser workers, leaving one of the five
validator slots for manual checks. CI retains two retries and the reviewed
45-minute `e2e` job cap, approved on 2026-10-03 in place of 30 minutes.
All other job caps, individual deadlines, assertions, full axe scans, retries,
and workers remain unchanged; no sharding or stronger runner is approved.
Coverage floors remain 95% statements / 90% branches / 96% functions / 96%
lines, and unit timing limits remain 210,000 ms total / 8,000 ms individual.
The cap amendment is not a speed fix or a historical job pass: earlier
30-minute cancellations remain cancellations and historical measurements stay
unchanged. Actual hosted execution under the 45-minute cap remains pending
separate exact-commit publication approval, not authorized by this amendment.

Modal and inline-notification static assets are built once per selected suite,
then shared read-only across workers. Every test retains its own browser context
and fresh session/provider state. The parent removes only its own temporary
fixture directories after browser teardown; it never rewrites `dist`.

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
  gate's `test-results/vitest-junit.xml`. The ordinary production-preview
  run records its verified PID teardown in `build-metrics/e2e-preview-lifecycle.json`.
- Full command wall time and serial/preparation/ordinary phase outcomes are
  retained in `build-metrics/e2e-timing.json`.

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

## Action Center resilience fixture

`npm run test:e2e -- --grep VAL-CROSS-006` also runs
the isolated `action-resilience` input through the same serial preview harness.
It renders the real App without StrictMode replay to make call counts exact:
the initial health probe fails, the Action Center summary fails once, usable
action pages carry a typed partial warning, and the second page fails once.
Focused retries recover only the failed work, keep existing IDs, and restore
focus. The fixture exposes technical call counts only, never raw records.

For a manual check, use `npm run test:e2e:fixture-preview -- action-resilience`
and the printed URL. Its HTML and injection code are test-only, absent from
ordinary `dist`. No runtime QA selector or live API is introduced.
