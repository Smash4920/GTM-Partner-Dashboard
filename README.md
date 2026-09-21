# GTM Partner Dashboard

Mockup of a partner revenue pipeline dashboard for the GTM team. Two views over
one data model: an internal **GTM Leadership** view aggregating all partner
performance, and a **Partner Portal** view scoped to a single partner.

![GTM Leadership view](docs/screenshots/leadership.png)
![Partner Portal view](docs/screenshots/partner.png)

The interface follows Factory's external brand system: near-black canvas
(#101010), bone type (#EEEEEE), Geist / Geist Mono, 1px hairline borders, no
shadows, and two functional accents only — signal orange for live status and
metric green for positive data.

## Views

### GTM Leadership (internal)

- KPI row: open pipeline, closed-won YTD (with YoY delta), pipeline coverage vs.
  remaining quota, deal-reg approval rate, registration → qualified-opportunity
  conversion, win rate, active partners, average open deal size
- Fiscal phase toggles: FY, Q1, Q2, Q3, Q4 for a February-start fiscal year
- Partner Manager View: aggregate or partner-specific performance for a selected
  manager, with Salesforce-style Account.Partner_Manager__c assignments
- Deal registration funnel: submitted → approved → converted, with rejected and
  pending alongside
- Pipeline by sales stage: Discovery → Scope → Tech Validation → Business Case →
  Vendor of Choice → Deal Desk Review, plus won / lost outcomes
- Revenue vs. target by quarter
- Pipeline by opportunity type: Sell To / Sell With / Allocate (the type filter
  applies to KPIs, stages, revenue, and the leaderboard)
- Registrations awaiting review — the actionable queue
- Weekly partner activity tracker with Google Calendar-style meeting types
- Partner leaderboard

### Partner Portal (partner-facing)

- Simulates the partner-scoped view; in production this sits behind partner SSO
  and the picker does not exist
- Shows Sell With and Allocate opportunities only — Sell To is internal-only
- Partner Strategists and Partner Engineers certified against goal
- Deal registrations above a quarter-scoped opportunity table
- Salesforce-shaped opportunity fields: client, Factory Account Director, stage,
  forecasted revenue, and close date
- Their stage progression and revenue vs. their fiscal target

## Running locally

```bash
npm install
npm run dev       # http://localhost:5173
npm run lint
npm run build     # type-checks, then bundles to dist/
npm run preview
```

## Data contract (the integration seam)

The UI only talks to the `DataProvider` interface
([`src/data/DataProvider.ts`](src/data/DataProvider.ts)):

| Method                | Returns                 | Future source                              |
| --------------------- | ----------------------- | ----------------------------------------- |
| `listPartnerManagers()` | `PartnerManager[]`     | Salesforce Account owner alignment        |
| `listPartners()`      | `Partner[]`             | PRM / CRM partner accounts                |
| `listRegistrations()` | `DealRegistration[]`    | CRM "Deal Registration" custom object     |
| `listOpportunities()`  | `Opportunity[]`         | Salesforce opportunities                  |
| `getTargets()`        | `Target[]`              | Quota objects or warehouse                |
| `listActivities()`    | `ActivityMeeting[]`     | Google Calendar events                    |
| `listCertifications()` | `PartnerCertification[]` | Partner enablement system               |

`MockDataProvider` fills the seam with deterministic, seeded data today. To go
live, implement the interface against your CRM (HubSpot, Salesforce) or
warehouse (Snowflake, Looker) and swap the provider in `App.tsx`. No view code
changes.

## Mock data

- Deterministic: mulberry32, seed `20260918` — identical on every load and build
- Fixed snapshot: 2026-09-18 (`SNAPSHOT_DATE`) so numbers never drift
- 5 partner managers, each aligned to 5 partners through a Salesforce-style
  account relationship
- 25 partners, 180 registrations, ~185 opportunities across FY27 fiscal phases
  (February 2026 → January 2027)
- 148 mock calendar meetings across the current and previous seven weeks
- Approval rate ~85%, registration → opportunity conversion ~70%, win rate ~55%
  of closed deals
- Volumes and weights are tuned in
  [`src/data/mock/generate.ts`](src/data/mock/generate.ts)

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

CI (`ci.yml`) runs lint + build on every pull request.
