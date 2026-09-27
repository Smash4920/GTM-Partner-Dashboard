# GTM Partner Dashboard

Mockup of a partner revenue pipeline dashboard for the GTM team. Seven views over
one data model, reached through a collapsible left sidebar: **Home** (ecosystem
summary), **Partner Performance** (per-manager / per-partner drill-down),
**Forecasting** (the VP's in-quarter view with a weighted forecast),
**Deal Reg Ops** (registration SLAs, conversion time, exclusivity, and
conflicts), **Activity Tracking** (weekly meeting goals and calendar logging),
**Partner View** (the partner-facing sharing surface), **Production
Requirements** (the architecture + utility roadmap), and **Data Connections**
(the integration map, partner-team access, and registration SLA notifications).

![Home view](docs/screenshots/home.png)
![Forecasting view](docs/screenshots/forecasting.png)
![Data Connections view](docs/screenshots/data-connections.png)

The interface follows Factory's external brand system: near-black canvas
(#101010), bone type (#EEEEEE), Geist / Geist Mono, 1px hairline borders, no
shadows, and two functional accents only — signal orange for live status and
metric green for positive data.

## Navigation

A collapsible sidebar on the left carries the four pages; the icon in the upper
left expands and collapses it to an icon rail.

## Pages

### Home

High-level summary statistics for the whole partner ecosystem. Always scoped to
**All Partners** — per-manager drill-downs live on Partner Performance.

- KPI row: open pipeline, closed-won for the selected phase (with a prior-year
  delta), pipeline coverage vs. remaining quota, deal-reg approval rate,
  registration → qualified-opportunity conversion, win rate, active partners,
  average open deal size
- Fiscal phase toggles: FY, Q1, Q2, Q3, Q4 for a February-start fiscal year.
  Phase-filtered pipeline spans the whole selected phase — open deals
  scheduled after the snapshot still count — while closed outcomes accrue only
  through the snapshot
- Deal registration funnel: submitted → approved → converted, with rejected and
  pending alongside
- Pipeline by sales stage: Discovery → Scope → Tech Validation → Business Case →
  Vendor of Choice → Deal Desk Review, plus won / lost outcomes
- Revenue vs. target by quarter
- Pipeline by opportunity type: Sell To / Sell With / Allocate (the type filter
  applies to KPIs, stages, revenue, and the leaderboard)
- Registrations awaiting review — the actionable queue
- Weekly partner activity tracker, fed by Activity Tracking classifications
- Partner leaderboard

### Partner Performance

Drill-down into specific partnership metrics. Two dropdowns on the right pick
the scope: **Partner manager** (all managers or one) and **Partner** (All
Partners aligned to that manager, or a single partner, via Salesforce-style
`Account.Partner_Manager__c` assignments).

- The same KPI row, registration funnel, stage breakdown, and revenue-vs-target
  chart, all scoped to the selection
- Meeting tracker alongside progress to the weekly goal for that scope
- Salesforce-shaped opportunity table: client, Factory Account Director, stage,
  forecasted revenue, and close date (actual close once closed, expected close
  while open)
- Pending registrations, scoped leaderboard, and — for a single partner —
  Partner Strategist / Partner Engineer certification against goal. When the
  scope includes multiple partners, the leaderboard shows each partner's
  certified counts and attainment beneath the count.
- Registrations awaiting review are colored against the **5-business-day
  response SLA**, and the waiting counter is quoted in the same unit —
  business days, not calendar days. A Friday submission is one business day
  old on Monday, not three, so the number and the color can never disagree
- After the awaiting-review block: **Exclusivity lapsed** flags every approved
  registration that never became an opportunity, with the 60-day window from
  approval shown per row
- Registration **conversion time** (submitted → approved → opportunity → win)
  and **leakage** counts (approved without an opportunity, exclusivity lapsed,
  pending past SLA, duplicate clients)
- **Duplicate & conflicting registrations** — clients registered by more than
  one partner, with submission dates so the first partner to submit is visible.
  Internal only; never rendered in the partner portal

### Forecasting

The VP of Partnerships' in-quarter read on FY27-Q3.

- Callout tiles: partner sourced pipeline, closed-won (with % attainment to the
  quarterly goal), pipeline coverage to goal, average deal size, and days left
  in the quarter
- **Weighted forecast call-outs**: every open deal carries a forecast category
  — Commit (90%), Best Case (50%), Pipeline (25%), Long Shot (10%) — and each
  category's probability-weighted contribution is summed into a total expected
  revenue, above the raw pipeline numbers
- **Week-over-week pipeline** sits directly below the call-outs: one cluster per
  week of the quarter, the open pipeline stacked by forecast category (solid)
  beside the same book weighted by close probability (faded), with the quarter's
  revenue goal as a dashed line. Dollars on the Y axis, weeks on the X, and the
  axis spans the whole quarter — weeks that have not begun are empty slots, so a
  new bar appears as each week starts. Hovering a week gives both totals and the
  week-over-week change.

  Closed weeks are read from the **weekly pipeline snapshot** (see Data
  contract), not reconstructed from today's book, and that distinction is the
  point: a snapshot already written never moves, so correcting a revenue figure
  or re-calling a deal today shifts the live week and leaves history alone.
  Reading the past off current state instead would backdate every later change —
  an amount raised this week would rewrite the weeks before it, a re-call would
  re-color them, and a deal that slipped out of the quarter would vanish from
  the weeks it was in rather than showing the drop. The tooltip names which kind
  of week you are looking at; where no history exists, a week falls back to the
  reconstruction and says so
- In-quarter opportunities grouped into a collapsible section per partner
  manager; each header shows their opportunity count, open pipeline, and
  closed-won, and expands to their book
- Table fields: Client, Partner, Revenue Forecast, Opportunity Type, Stage,
  Forecast Category, Close Date, Next Step, and Notes
- **Revenue Forecast**, **Forecast Category**, **Notes**, and **Next Step**
  each carry a pencil. An edited revenue forecast overrides the Salesforce
  figure and immediately updates every metric across the app, so a manager's
  number can differ from the CRM's. Notes never render inline — they are stored
  as comments and appear on hover over the comment icon. Next Step is an
  inline editable text field per row
- **Forecast Category is an editable call, not a derived badge.** The deal's
  stage supplies a starting point (Discovery → Long Shot, Scope → Pipeline,
  Tech Validation → Best Case, late funnel → Commit), but the call belongs to
  the manager: clicking the pencil opens a dropdown of the four probability
  buckets — Commit (90%), Best Case (50%), Pipeline (25%), Long Shot (10%) —
  and picking one re-calls the deal, which recalculates the weighted forecast
  and every category tile immediately. Closed rows carry no pencil — the call
  stops mattering once the deal resolves
- **Calls that disagree with stage** sits above the table: deals called *above*
  their stage (more confident than the funnel supports — a stale stage or an
  optimistic call) and *below* it (late-funnel deals the manager has downgraded,
  which still read as healthy on any stage report). Where category and stage
  agree, the category adds no information, so these disagreements are the
  forecast conversation. Individual rows are tagged "off stage". Forecast
  accuracy by partner, manager, motion, and quarter remains on the roadmap

### Deal Reg Ops

The ops-led read on the registration book, whole-org and time-agnostic so
leakage spanning quarters stays visible.

- KPI tiles: average days per hop of the chain **submitted → approved →
  opportunity created → win**, pending registrations past the 5-business-day
  SLA, and registrations past the 60-day **exclusivity window**
- Conversion-time bars with the SLA and exclusivity windows annotated against
  each hop
- Pending registrations queue with the SLA-colored day counters
- **Exclusivity window**: approved registrations still without an opportunity,
  flagged "Exclusivity lapsed" once the 60 days from approval pass — the lead
  keeps exclusivity until the partner introduces it
- **Duplicate & conflicting registrations**: all clients registered by more
  than one partner, with every submission date so the earliest submission is
  obvious. Internal only
- The same section appears inside Partner View, scoped to that partner's own
  registrations (timeline + exclusivity), with conflicts and other partners'
  submissions excluded

### Activity Tracking

Organized by partner manager and their assigned partners, with dropdowns for
**Partner manager** and **Partner** (All Partners, each assigned partner, or
**＋ Add partner…** to log a call with a new prospect mid-week).

- Progress to weekly goal: 10 partner meetings per week, 3 of them Partner-
  Identified Opportunity Interlocks, plus this week's split by call type
- **Log Meetings** opens a Google Calendar-style weekly view of that manager's
  calendar. Every call is a tile within its day carrying two dropdowns,
  **Partner** and **Call Type**; Submit commits the classifications, which feed
  the progress bars and the weekly activity charts
- Call types: Discovery, PIO Interlock, PAO Interlock, Interlock Cadence, Deal
  Support, Technical Enablement, GTM Enablement, and Partner Cadence

In-app edits (revenue, forecast-category calls, notes, next steps,
classifications, added prospects, roster changes, sent notifications) live in
React state for the session; a write-capable provider is the next step.

### Partner View

The partner-facing sharing surface, designed for a future partner SSO boundary.
The picker simulates which partner is viewing the shared platform today.

- Sell With and Allocate opportunities only; Sell To remains internal-only
- Partner-scoped pipeline, closed-won, win rate, awaiting-review registrations,
  opportunity details, revenue-vs-target trend, stage pipeline, and revenue
  motion breakdown
- **Deal registration timeline**: average conversion time across the partner's
  own registrations (submitted → approved → opportunity → win)
- **Exclusivity window**: the partner's approved registrations still without an
  opportunity, flagged once the 60-day introduction window lapses
- Partner Strategist and Partner Engineer certification counts with goal
  attainment

### Production Requirements

Two tracked backlogs. The **Architecture roadmap** documents the server-side
foundation required before connecting protected systems (identity and row-level
authorization, source-system integration, persistence and audit, security and
compliance, reliability). The **Utility Improvements** section is the GTM
Partnerships leader's product roadmap — forecast quality, partner health and
lifecycle, deal-registration operations, actionability, partner portal utility,
attribution and crediting, and services delivery (which partner delivers which
service type for which client, whether Factory revenue is attached or it is a
long-term adoption play, and what the engagement produced) — separated from the
architecture work so the two tracks can be prioritized independently.

### Data Connections

The integration map and the two things that hang off it: who on the partner
team can be told about the data, and the rule that tells them.

- **Data connection map** — a wire diagram of every system the dashboard reads
  from or writes to, drawn from one catalog
  ([`src/data/connections.ts`](src/data/connections.ts)) so the boxes and the
  wires cannot disagree about where a node sits. Boxes are systems, wires are
  data. Color is state only: **required** (signal) is a connection that has to
  exist before real partner data can be served, **live** (metric) is flowing
  through the DataProvider seam today, **planned** (graphite, dashed) is
  roadmap. Click a box for what it supplies, the DataProvider methods it fills,
  its source object, auth, cadence, and — the point of the view — what is still
  missing and which roadmap track owns it. Each node's `methods` name the
  DataProvider method it fills, so the map and the contract in
  `DataProvider.ts` can be read against each other; a test asserts every method
  there is covered here
- **Partner team access** — the internal roster the identity provider owns,
  projected into the dashboard. Adding a person puts them on the roster
  *awaiting authorization*; authorizing is a second, separate step, which is
  the split a real IdP enforces between knowing who should have access and
  granting it. A user is either a Partnership Lead, a Partner Manager (aligned
  to one partner manager, which is what routes a registration to them), Deal
  Desk Ops (the whole queue), or an Analyst; each carries the notification
  channels they are authorized on. Access can be revoked and restored, and a
  user added this session can be removed
- **Deal-registration SLA alerts** — the notification rule, the registrations
  it fires on, and what has been sent this session. Every pending registration
  is measured against the 5-business-day response SLA at the snapshot; one
  business day (24 hours) before the deadline the owner is warned, and once it
  has passed the breach is raised. The owner is the submitting partner's
  aligned partner manager, with the deal desk catching anything unaligned, so a
  registration never goes unowned. The 24-hour warnings lead the queue — they
  are the ones with a working day left in them
- **Notifications** are sent from inside the map: pick a teammate in the
  notification node and it loads their own most urgent alert, or pick a
  registration from the alert queue, or write a free-form note. Delivery goes
  out over the user's authorized channels only, and the send is logged. Sends
  are timestamped off the session clock, not the fixed snapshot: the demo data
  is frozen at Sep 18, but an action taken now happened now

## Running locally

Requires **Node 22.13+** (`engines.node` in `package.json`). Node 20 reached
end-of-life in April 2026 and the current Vite / Vitest / ESLint majors no
longer support it.

```bash
npm install
npm run dev       # http://localhost:5173
npm run lint
npm test          # vitest: fiscal/metric helpers + the mock data contract
npm run build     # type-checks, then bundles to dist/
npm run preview
```

### Dev container

Open the repository in VS Code with the
[Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)
or create a GitHub Codespace to use the checked-in development environment.
The container provides Node.js 22 on Debian, installs the locked dependencies
with `npm ci`, and configures ESLint, Tailwind CSS, and the workspace TypeScript
version. Start the app with `npm run dev`; port 5173 is forwarded and opens in
the browser automatically.

## Data contract (the integration seam)

The UI only talks to the `DataProvider` interface
([`src/data/DataProvider.ts`](src/data/DataProvider.ts)):

| Method                | Returns                 | Future source                              |
| --------------------- | ----------------------- | ----------------------------------------- |
| `listPartnerManagers()` | `PartnerManager[]`     | Salesforce Account owner alignment        |
| `listPartners()`      | `Partner[]`             | PRM / CRM partner accounts                |
| `listRegistrations()` | `DealRegistration[]`    | CRM "Deal Registration" custom object     |
| `listOpportunities()`  | `Opportunity[]`         | Salesforce opportunities                  |
| `listPipelineSnapshots()` | `PipelineSnapshot[]` | `OpportunityHistory` / weekly fact table |
| `getTargets()`        | `Target[]`              | Quota objects or warehouse                |
| `listActivities()`    | `ActivityMeeting[]`     | Google Calendar events                    |
| `listCertifications()` | `PartnerCertification[]` | Partner enablement system               |
| `listTeamUsers()`     | `TeamUser[]`            | Identity provider / SCIM directory        |

`MockDataProvider` fills the seam with deterministic, seeded data today. To go
live, implement the interface against your CRM (HubSpot, Salesforce) or
warehouse (Snowflake, Looker) and swap the provider in `App.tsx`. No view code
changes.

The interface is read-only. `App.tsx` layers the session's in-app edits —
revenue overrides, forecast-category calls, notes, next steps, meeting
classifications, added prospects, roster changes, and sent notifications — on
top of the provider's book before handing a single merged
`DashboardData` to every page, so writes are the one thing a live provider
still needs to add.

`listPipelineSnapshots()` is the one collection that is history rather than
current state: an append-only weekly recording of the open book, carrying each
open deal's amount, called category, stage, and expected close as they stood.
An `Opportunity` holds one of each, so current state cannot answer a question
about a past week, and any view that tries to derive one backdates every later
change. Snapshots are also what makes forecast accuracy measurable at all — a
call can only be scored against an outcome if the call as made was kept. A
provider with no history may return an empty array; views that can degrade fall
back to what create and close dates alone support, and say which weeks those
are. In Salesforce the equivalent lives in `OpportunityHistory` and
`OpportunityFieldHistory`; a warehouse would model it as a weekly fact table
written by a scheduled job.

## Mock data

- Deterministic: mulberry32, seed `20260918` — identical on every load, build,
  and `generateDashboardData()` call
- Fixed snapshot: 2026-09-18 (`SNAPSHOT_DATE`) so numbers never drift
- 5 partner managers, each aligned to 5 partners through a Salesforce-style
  account relationship, each with an authorized Partner Manager user aligned to
  them; the 8-person roster also carries a partnership lead, a deal-desk ops
  user, and an analyst still awaiting authorization
- 25 partners, 180 registrations, 213 opportunities — the FY27 book
  (February 2026 → January 2027) plus a closed prior-year FY26 book that only
  feeds the prior-year delta tiles — and 163 mock calendar meetings: a seeded
  pool across the previous seven weeks, plus a full current week per partner
  manager (7–12 calls each) so the weekly goal and Log Meetings have a real
  calendar to work from
- Every opportunity carries a forecast category; open deals carry a manager's
  called category, roughly one in five deliberately off its stage-implied
  bucket in both directions (deterministic from the id, so no PRNG sequence or
  pinned volume shifts), and close-date-adjacent deals with no explicit call
  fall back to the stage heuristic. Open opportunities also carry a row-level
  next step (about half of them, seeded deterministically from the id)
- 1,911 weekly pipeline snapshot rows: the open book recorded every Monday of
  FY27 through the snapshot date (33 recordings). Amounts, calls, stages, and
  expected close dates drift week to week — most deals never move, a minority
  were a bucket more cautious and a stage earlier a few weeks back, some grew as
  scope firmed up while others were cut, and a handful crossed a quarter
  boundary (7 deals slipped out of Q3, 4 were pulled in). Without that movement
  a snapshot series is just today's numbers repeated and the week-over-week
  chart shows nothing but deals entering and closing. Drift is derived from the
  opportunity id and week index rather than the seeded PRNG, so history shifts
  no existing volume or amount
- Every approved registration gets a 2–12 day document-handling dwell before
  its opportunity is created, so the submitted → approved → opportunity → win
  chain reads as real time; a fixed set of registrations deliberately shares a
  client with another partner so the duplicate/conflict views have rows, and
  older approved registrations are left unconverted so the exclusivity window
  has lapsed and still-current rows
- A few still-pending registrations are re-dated to one business day before
  their response SLA — one per partner — so the 24-hours-out notification rule
  has owners to reach at the snapshot. The warning window is only a day wide,
  and a natural distribution can contain none of it; the seeded working date is
  derived from the snapshot, and no PRNG is consumed, so no volume shifts
- Realized FY27 win rate: 20 of 44 closed deals won (~45%)
- Volumes and weights are tuned in
  [`src/data/mock/generate.ts`](src/data/mock/generate.ts); the exact volumes
  and the data contract are pinned by `src/data/mock/generate.test.ts`

## Deployment

### Vercel (current path)

The repo is private, so Vercel handles hosting and per-PR previews. One-time
setup: import the repo at vercel.com (framework **Vite**, build
`npm run build`, output `dist`), then enable **Settings → Deployment
Protection → Vercel Authentication** so only authorized users can open the
URLs. After that, every pull request gets its own preview URL automatically.

Note that Vercel's Hobby (free) plan is limited to non-commercial use; a
dashboard the GTM team actually relies on belongs on Pro.

### GitHub Pages (manual, currently blocked)

`deploy-pages.yml` is kept but runs only via **workflow_dispatch**. Pages
cannot publish from a private repo on a GitHub Free plan — the deploy step
fails with a 404. It becomes viable if the repo goes public or the account
moves to Pro; then enable Settings → Pages → Source: **GitHub Actions** and
run the workflow, which publishes to
`https://smash4920.github.io/GTM-Partner-Dashboard/`.

### Base path

Assets resolve differently per host, so `vite.config.ts` picks the base path
from the environment: `/` when `VERCEL` is set (Vercel serves at a domain
root), and `/GTM-Partner-Dashboard/` otherwise (Pages serves project sites
under the repo name). Set `BASE_PATH` to override for any other host.

CI (`ci.yml`) runs lint + test + build on every pull request and on every push
to `main`.
