import { RoadmapStatusBadge } from '../components/Badge';
import Card from '../components/Card';
import {
  ROADMAP_DEMO_STATUSES,
  ROADMAP_LAST_UPDATED,
  ROADMAP_PRODUCTION_STATUSES,
  ROADMAP_SCOPE_LABELS,
  ROADMAP_STATUS_META,
} from '../data/constants';
import type { RoadmapItem, RoadmapScope, RoadmapStatus } from '../data/types';
import { formatDate } from '../lib/format';

/**
 * The server-side foundation required before connecting protected business
 * systems or serving external partners. Statuses are stamped against what the
 * code actually does today, not against intent. Each row carries a Demo status
 * for its verified client behavior and, where a production dependency is
 * intentionally paused, a separate Production status. A finished demo therefore
 * never reads as a finished production step: mixed rows render `Demo: WIP`
 * beside `Production: Prod Only` and name both the usable demo portion and the
 * exact production blocker.
 */
const REQUIREMENTS: { title: string; items: RoadmapItem[] }[] = [
  {
    title: 'Identity and access control',
    items: [
      {
        text: 'Authenticate internal users and partners through the company identity provider.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker:
            'Requires a company identity provider and trusted sign-in; the client-only demo has no authentication.',
        },
      },
      {
        text: 'Enforce role, manager, and partner access on the server, with row-level authorization for every query.',
        demo: 'wip',
        demoScope:
          'Client-side partner boundaries are enforced and e2e-tested, and the scoped contract carries the manager scope.',
        production: {
          status: 'prod-only',
          blocker:
            'Server-side row-level authorization needs a trusted API and identity claims; client filtering is presentation, not authorization.',
        },
      },
      {
        // Excluded from this mission: the picker still renders unconditionally
        // today and its client-only limitation is documented rather than
        // implemented, so it stays a not-yet-built demo change.
        text: "Remove the partner picker outside an internal demo mode so a partner never receives another partner's data.",
        demo: 'pending',
      },
    ],
  },
  {
    title: 'Source-system integration',
    items: [
      {
        text: 'Connect Salesforce or HubSpot as the opportunity and deal-registration system of record.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a live CRM connection with server-held OAuth credentials.',
        },
      },
      {
        text: "Sync Google Calendar activity and the enablement system's certification records with approved OAuth scopes.",
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker:
            'Requires approved OAuth scopes and server-held credentials for calendar and enablement systems.',
        },
      },
      {
        text: 'Use incremental syncs, webhooks where available, scheduled reconciliation, retries, and dead-letter handling.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a server-side ingestion pipeline against live source systems.',
        },
      },
    ],
  },
  {
    title: 'Data model, quality, and fiscal controls',
    items: [
      {
        text: 'Normalize source records into a canonical partner, opportunity, registration, target, activity, and certification model.',
        demo: 'wip',
        demoScope:
          'The canonical model in src/data/types.ts is the app-wide contract and is pinned by tests.',
        production: {
          status: 'prod-only',
          blocker:
            'Normalizing real source records into it waits on live ingestion and source credentials.',
        },
      },
      {
        text: 'Validate stages, statuses, revenue motions, target periods, dates, and foreign-key relationships at ingestion.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Ingestion-time validation needs a live ingestion pipeline.',
        },
      },
      {
        text: 'Make fiscal calendar, timezone, as-of date, attribution rules, and target definitions configurable instead of static.',
        demo: 'pending',
      },
      {
        text: 'Expose source lineage, last-refresh time, and incomplete-data errors in the product.',
        demo: 'wip',
        demoScope:
          'The Data Connections map exposes per-node source, auth, cadence, and gaps, and Forecasting has per-widget errors.',
        production: {
          status: 'prod-only',
          blocker:
            'Live last-refresh times and real incomplete-data errors need connected source systems.',
        },
      },
    ],
  },
  {
    title: 'Persistence and operating workflows',
    items: [
      {
        text: 'Persist forecast overrides, notes, next steps, classifications, and partner additions with author, timestamp, reason, and audit history.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker:
            'Durable persistence and audit history need a write path and datastore; edits are session-only React state by design.',
        },
      },
      {
        text: 'Define the system of record and write-back workflow for every editable field, including conflict resolution.',
        demo: 'pending',
      },
      {
        text: 'Add approvals and SLAs for deal registrations, partner conflicts, and forecast changes where required.',
        demo: 'wip',
        demoScope: 'Registration SLAs and rejection reasons landed with the ops view.',
        production: {
          status: 'prod-only',
          blocker:
            'Enforced approver identity and durable approvals for conflicts and forecast changes need trusted identity and a write path.',
        },
      },
    ],
  },
  {
    title: 'Security, privacy, and compliance',
    items: [
      {
        text: 'Keep CRM tokens and partner data on the server; never expose them in browser bundles.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a server to hold CRM tokens and partner data.',
        },
      },
      {
        text: 'Apply encryption, secrets management, least-privilege service accounts, audit logging, retention policies, and incident response.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker:
            'Requires production infrastructure, secrets management, and operational controls.',
        },
      },
      {
        text: 'Complete privacy, legal, and security review for calendar data and external partner access.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires real calendar data and external partner access to review.',
        },
      },
    ],
  },
  {
    title: 'Reliability, scale, and delivery',
    items: [
      {
        text: 'Serve aggregated, paginated API responses rather than loading the entire ecosystem into the browser.',
        demo: 'wip',
        demoScope:
          'Forecasting reads the scoped, cursor-paginated contract against the mock provider; the other seven views are mid-migration.',
        production: {
          status: 'prod-only',
          blocker:
            'Serving these responses for real needs a production API with warehouse rollups.',
        },
      },
      {
        text: 'Add observability for sync health, data freshness, API errors, performance, and authorization failures.',
        demo: 'wip',
        demoScope: 'Structured logging and per-widget error states have landed.',
        production: {
          status: 'prod-only',
          blocker:
            'Sync health, data freshness, and authorization-failure signals need the production systems they describe.',
        },
      },
      {
        text: 'Add automated unit, integration, end-to-end, accessibility, and security tests, plus backups and recovery procedures.',
        demo: 'wip',
        demoScope: 'Unit, seam, and Playwright suites are gated in CI.',
        production: {
          status: 'prod-only',
          blocker: 'Backups and recovery procedures need production infrastructure.',
        },
      },
      {
        text: 'Deploy through separate development, staging, and production environments with CI/CD and monitored rollbacks.',
        demo: 'wip',
        demoScope: 'CI gates every pull request and Vercel serves per-PR previews.',
        production: {
          status: 'prod-only',
          blocker:
            'Separate staging and production environments with monitored rollbacks need deployment accounts and infrastructure.',
        },
      },
    ],
  },
  {
    title: 'Feature delivery governance',
    items: [
      {
        text: 'Define a feature-flag methodology covering naming, ownership, safe defaults, environment scope, targeting, rollout and rollback, observability, review, expiration, and removal.',
        demo: 'complete',
        demoScope:
          'Every flag carries owner, purpose, environment scope, safe default, rollout/rollback triggers, review, expiry, and removal metadata; policy checks fail on gaps or expiry.',
        production: {
          status: 'prod-only',
          blocker:
            'Flag observability and a managed control plane need production telemetry and identity.',
        },
      },
      {
        text: 'Provide an authenticated control plane where approved nontechnical maintainers can change flags without code changes or redeployment, with role-based access, approvals, audit history, and emergency kill switches.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker:
            'An authenticated flag control plane needs a server and identity the client-only app cannot provide.',
        },
      },
      {
        text: 'Keep authorization and data-access enforcement independent from feature flags, and define cached fail-safe behavior when the control plane is unavailable.',
        demo: 'complete',
        demoScope:
          'Fresh value, then bounded last-known-good cache, then the safe default. Flags are local and non-authoritative: they never alter demo access scope, roles, or returned rows.',
      },
    ],
  },
];

/**
 * Product-level roadmap for what the GTM Partnerships leader needs from the
 * tool, additive to the architecture foundation above. Nothing here is
 * required to ship the demo — it is the backlog that turns raw pipeline data
 * into a decisions-first product.
 */
const UTILITY_REQUIREMENTS: { title: string; items: RoadmapItem[] }[] = [
  {
    title: 'Forecast quality',
    items: [
      {
        text: 'Live sketch: probability-weighted forecast over the open book, with manager-editable category calls and a "disagrees with stage" call-out.',
        demo: 'complete',
      },
      {
        // Deferred: weekly snapshots record every call as made, but they lack
        // immutable historical partner-manager ownership and authoritative
        // stage-entry events, so the manager/partner trend cannot be built
        // honestly yet.
        text: 'Turn per-deal judgments into trend: close-date slippage, stage aging, and category-confidence history per manager and partner.',
        demo: 'pending',
      },
      {
        text: 'MEDDPICC-or-equivalent qualification structured on every open opportunity.',
        demo: 'pending',
      },
      {
        text: 'Forecast accuracy by partner, manager, motion, and quarter.',
        demo: 'pending',
      },
    ],
  },
  {
    title: 'Partner health and lifecycle',
    items: [
      {
        text: 'Track the recruitment → onboarding → enabled → activated → productive → strategic lifecycle.',
        demo: 'pending',
      },
      {
        text: 'Time-to-first-registration, time-to-first-opportunity, time-to-first-win, and time-to-repeat-win.',
        demo: 'pending',
      },
      {
        text: 'Engagement recency, executive sponsor coverage, certification velocity, and inactive-partner alerts.',
        demo: 'pending',
      },
      {
        text: 'A health score with transparent, visible drivers, not a black box.',
        demo: 'pending',
      },
    ],
  },
  {
    title: 'Deal-registration operations',
    items: [
      {
        text: 'Registration SLA, aging buckets, approval/rejection reasons, and duplicate/overlap rate.',
        demo: 'complete',
      },
      {
        text: 'Conversion time from submitted → approved → opportunity → win.',
        demo: 'complete',
      },
      {
        text: 'Leakage: approved registrations without an opportunity, expired registrations, and partner conflict.',
        demo: 'complete',
      },
    ],
  },
  {
    title: 'Actionability',
    items: [
      {
        text: 'Alerts for stale high-value deals, missing next steps, slipping close dates, pending registrations beyond SLA, and deteriorating partner health.',
        demo: 'wip',
        demoScope: 'Registration SLA warnings and breaches are live with owner routing.',
        production: {
          status: 'prod-only',
          blocker:
            'Continuous production alerting needs connected source data and scheduled server-side evaluation and delivery.',
        },
      },
      {
        text: 'Owner, due date, disposition, and workflow links back to Salesforce/HubSpot, PRM, Slack, and calendar.',
        demo: 'wip',
        demoScope: 'Owner, due date, and disposition ride the session-only notification flow.',
        production: {
          status: 'prod-only',
          blocker:
            'Workflow links back to Salesforce/HubSpot, PRM, Slack, and calendar need those connected systems.',
        },
      },
      {
        text: 'Saved views and scheduled executive/manager reporting.',
        demo: 'pending',
      },
    ],
  },
  {
    title: 'Partner portal utility',
    items: [
      {
        text: 'Shared account plans, mutual action plans, deal collaboration, registration status explanations, enablement recommendations, and support escalation.',
        demo: 'pending',
      },
      {
        text: 'Granular, server-enforced visibility rules, not merely a partner-scoped dashboard.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker:
            "Server-enforced visibility needs a trusted API and identity; today's partner scoping is client-side presentation.",
        },
      },
    ],
  },
  {
    title: 'Attribution and crediting',
    items: [
      {
        text: 'Sourced, influenced, assisted, reseller, marketplace, referral, and expansion attribution.',
        demo: 'pending',
      },
      {
        text: 'Multi-partner credit splits and sales/partner ownership.',
        demo: 'pending',
      },
      {
        text: 'Explicit attribution rules, effective dates, and a deal-credit dispute workflow.',
        demo: 'pending',
      },
    ],
  },
  {
    title: 'Services delivery',
    items: [
      {
        text: 'A delivery record per engagement: which partner is delivering which service type — implementation, migration, managed service, custom development, enablement and training, advisory — for which client, with start, go-live, and delivery owner.',
        demo: 'pending',
      },
      {
        text: 'The commercial shape of each engagement: Factory revenue attached (license, allocated drawdown, services pass-through) versus no direct revenue, and long-term adoption plays whose return is seat expansion or renewal rather than bookings this quarter.',
        demo: 'pending',
      },
      {
        text: 'Engagements linked to their opportunity, partner, and account so delivery reads next to pipeline and closed-won instead of living in a spreadsheet.',
        demo: 'pending',
      },
      {
        text: "Outcomes per engagement: adoption and consumption milestones, go-live slippage, post-delivery expansion, and which partners' delivery produces repeat revenue.",
        demo: 'pending',
      },
      {
        text: "Delivery capacity by service type: certified practitioners available, engagements in flight, and where demand is outrunning a partner's bench.",
        demo: 'pending',
      },
    ],
  },
];

/**
 * The order the two roadmaps above get built in, and the reason for it.
 *
 * Phases 0 and 1 needed no infrastructure and no production data, and both have
 * landed in demo mode against MockDataProvider. That is deliberate. Phase 1 was
 * a refactor of the view layer, and the view layer was the least tested part of
 * the codebase, so the test harness came first. Doing both against mock data
 * answered the only question that really matters — do the views survive
 * pagination and server-side aggregation? — for the price of a refactor rather
 * than the price of a warehouse. The answer was yes, with one view migrated and
 * seven to go.
 */
interface MigrationPhase {
  phase: string;
  title: string;
  subtitle: string;
  items: RoadmapItem[];
  /** Where the phase stands, shown in green when it has landed. */
  status?: string;
  /** True when the work needs no infrastructure and can be built against the mock. */
  demoMode: boolean;
}

const MIGRATION_PHASES: MigrationPhase[] = [
  {
    phase: 'Phase 0',
    title: 'Test infrastructure',
    subtitle: 'No infrastructure required · landed in demo mode',
    demoMode: true,
    status: 'Done · 202 tests, 91.7% statements, gated in CI',
    items: [
      {
        text: 'jsdom, Testing Library, and a coverage provider, with the thresholds in vite.config.ts as a ratchet and CI running coverage rather than a bare test run.',
        demo: 'complete',
      },
      {
        text: 'Coverage went from 27.88% statements overall and 0% across every view, component, App.tsx, and useDashboardData, to 91% — the 5,700 lines Phase 1 was about to move by hand are now watched.',
        demo: 'complete',
      },
      {
        text: 'Four correctness bugs found by the first tests, each with a regression test: a cleared next step coming back, a throw in any view blanking the whole app, unguarded division rendering "∞% of goal", and the meeting modal discarding a week of unsubmitted classifications on a stray click.',
        demo: 'complete',
      },
    ],
  },
  {
    phase: 'Phase 1',
    title: 'Contract rewrite against the mock',
    subtitle: 'No infrastructure required · landed in demo mode',
    demoMode: true,
    status: 'Done for Forecasting · seven views still on the old contract',
    items: [
      {
        text: 'DataProvider is split in two: the scoped aggregates and cursor-paginated row lists that are the target shape, and the eight list-everything calls still being retired. Forecasting reads only the first.',
        demo: 'complete',
      },
      {
        text: 'MockDataProvider writes the answers behind the seam, using the same metrics functions the views used to call themselves — so src/lib/metrics is now the specification a server has to match, and its test suite is the conformance check.',
        demo: 'complete',
      },
      {
        text: 'listPipelineSnapshots() is gone from the client contract entirely. History was ~87% of the payload at production volume and reached the client as millions of rows to answer a question about fourteen weeks; it now leaves as a ~13-bucket series, and only where a view asks.',
        demo: 'complete',
      },
      {
        text: 'Forecasting was migrated first: the hottest edit path and the only view driven by that history. Its aggregate queries return the same kilobytes at 1× and at 100×, and its tables fetch 25 rows at a time per expanded manager.',
        demo: 'complete',
      },
      {
        text: 'Two providers behind the same contract: a simulated remote one with ~250 ms round trips and a 15% failure rate, so per-widget loading, error, and retry states are exercised rather than theoretical, and a 100× book — 21,300 opportunities, 191,000 snapshot rows, ~45 MB — so the claim is demonstrated rather than asserted. Swap them from the header.',
        demo: 'complete',
      },
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Warehouse and fiscal calendar',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      {
        text: 'Fact and dimension model, with weekly pipeline snapshots partitioned by week and write-once — the "a snapshot already written never changes" invariant becomes a database permission rather than a comment.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a warehouse with partitioned, write-once snapshot storage.',
        },
      },
      {
        text: 'Generate the date dimension from the fiscal calendar module so the dashboard and the warehouse cannot disagree about a quarter boundary or a business day.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a warehouse date dimension to generate against.',
        },
      },
      {
        text: 'Idempotent weekly snapshot job, keyed so a re-run cannot double-write.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a scheduled server-side job against warehouse storage.',
        },
      },
    ],
  },
  {
    phase: 'Phase 3',
    title: 'API with row-level authorization',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      {
        text: 'Serve the Phase 1 contract for real, with pre-aggregated rollups rather than live aggregation over millions of snapshot rows.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a production API and warehouse rollups.',
        },
      },
      {
        text: 'Enforce partner and manager scope in the query itself, so a partner never receives another partner\u2019s data.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker:
            'Requires server-side row-level authorization backed by trusted identity claims.',
        },
      },
      {
        text: 'Run the existing metrics tests against the server implementation as a conformance suite.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a server implementation to run the conformance suite against.',
        },
      },
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Incremental ingestion',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      {
        text: 'Watermark-based incremental sync from the CRM, with bulk backfill inside API quota.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a live CRM connection and server-held credentials.',
        },
      },
      {
        text: 'Calendar and enablement sync over approved OAuth scopes, with reconciliation and dead-letter handling.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires approved OAuth scopes and a server-side ingestion pipeline.',
        },
      },
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Write path and audit',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      {
        text: 'Persist overrides with author, timestamp, reason, and the source version they were made against.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a durable write path and datastore.',
        },
      },
      {
        text: 'Decide and surface what happens when the source system changes a figure underneath an override.',
        demo: 'pending',
        production: {
          status: 'prod-only',
          blocker: 'Requires a connected source system and write path to reconcile against.',
        },
      },
      {
        text: 'Optimistic client updates, so an edited forecast still moves every metric instantly instead of waiting on a round trip.',
        demo: 'wip',
        demoScope:
          "Rows render the session's override immediately and aggregates hold their previous figures during a refetch.",
        production: {
          status: 'prod-only',
          blocker: 'The full optimistic delta needs the write path to reconcile against.',
        },
      },
    ],
  },
];

/** One row of the status legend, badge plus its one-line definition. */
function StatusLegendEntry({ scope, status }: { scope: RoadmapScope; status: RoadmapStatus }) {
  const meta = ROADMAP_STATUS_META[status];
  return (
    <div className="flex items-center gap-2">
      <dt>
        <RoadmapStatusBadge scope={scope} status={status} />
      </dt>
      <dd className="text-xs text-granite">{meta.description}</dd>
    </div>
  );
}

/**
 * Renders one roadmap item: text on the left with the usable demo portion and
 * the exact production blocker beneath it, and its labeled Demo and (optional)
 * Production status badges right-aligned.
 */
function RoadmapItemRow({ item, dotClass }: { item: RoadmapItem; dotClass: string }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <div className="min-w-0 flex-1 space-y-1">
        <span className="block">{item.text}</span>
        {item.demoScope && (
          <p className="text-xs text-granite">
            <span className="font-mono uppercase tracking-[0.06em] text-metric">Demo today: </span>
            {item.demoScope}
          </p>
        )}
        {item.production && (
          <p className="text-xs text-granite">
            <span className="font-mono uppercase tracking-[0.06em] text-stone">
              Production blocker:{' '}
            </span>
            {item.production.blocker}
          </p>
        )}
      </div>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <RoadmapStatusBadge scope="demo" status={item.demo} />
        {item.production && (
          <RoadmapStatusBadge scope="production" status={item.production.status} />
        )}
      </span>
    </li>
  );
}

/** Documents the intentional boundary between this deterministic demo and a live data product. */
export default function ProductionRequirementsView() {
  return (
    <div className="space-y-6">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
          Architecture roadmap
        </p>
        <h1 className="mt-2 text-3xl tracking-tight text-bone">Production Requirements</h1>
        <p className="mt-1 max-w-3xl text-sm text-granite">
          This demo uses deterministic mock data and session-only edits. The capabilities below are
          required before connecting protected business systems or serving external partners. Every
          row carries a Demo status for what the client-only demo verifiably does today, and a
          separate Production status wherever a production dependency is intentionally paused. Demo
          completion never means the production step is done.
        </p>
        <div className="mt-4 space-y-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              {ROADMAP_SCOPE_LABELS.demo} status
            </p>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {ROADMAP_DEMO_STATUSES.map((status) => (
                <StatusLegendEntry key={status} scope="demo" status={status} />
              ))}
            </dl>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              {ROADMAP_SCOPE_LABELS.production} status
            </p>
            <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {ROADMAP_PRODUCTION_STATUSES.map((status) => (
                <StatusLegendEntry key={status} scope="production" status={status} />
              ))}
            </dl>
          </div>
        </div>
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Statuses last updated {formatDate(ROADMAP_LAST_UPDATED.toISOString())}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {REQUIREMENTS.map((requirement) => (
          <Card key={requirement.title} title={requirement.title}>
            <ul className="space-y-3 text-sm text-stone">
              {requirement.items.map((item) => (
                <RoadmapItemRow key={item.text} item={item} dotClass="bg-signal" />
              ))}
            </ul>
          </Card>
        ))}
      </div>

      <div className="pt-6">
        <div className="border-t border-carbon pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-granite">
            Delivery plan
          </p>
          <h2 className="mt-2 text-2xl tracking-tight text-bone">Migration Path</h2>
          <p className="mt-1 max-w-3xl text-sm text-granite">
            The order the architecture work gets built in. The first two phases need no
            infrastructure and no production data — they are done in demo mode against the mock
            provider, and they are what make every phase after them safe. Full reasoning in{' '}
            <span className="font-mono text-[11px] text-stone">docs/migration-plan.md</span>.
          </p>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {MIGRATION_PHASES.map((phase) => (
            <Card
              key={phase.phase}
              title={`${phase.phase} · ${phase.title}`}
              subtitle={phase.subtitle}
            >
              {phase.status && (
                <p className="mb-4 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.06em] text-metric">
                  <span
                    aria-hidden="true"
                    className="inline-block h-1.5 w-1.5 rounded-full bg-metric"
                  />
                  {phase.status}
                </p>
              )}
              <ul className="space-y-3 text-sm text-stone">
                {phase.items.map((item) => (
                  <RoadmapItemRow
                    key={item.text}
                    item={item}
                    dotClass={phase.demoMode ? 'bg-metric' : 'bg-graphite'}
                  />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>

      <div className="pt-6">
        <div className="border-t border-carbon pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-granite">
            Product roadmap
          </p>
          <h2 className="mt-2 text-2xl tracking-tight text-bone">Utility Improvements</h2>
          <p className="mt-1 max-w-3xl text-sm text-granite">
            The decisions the GTM Partnerships leader needs the tool to make easy. The demo's live
            sketch covers forecast quality (a weighted forecast driven by manager-editable category
            calls) and deal-registration operations; the rest of this backlog turns raw pipeline
            data into those decisions.
          </p>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {UTILITY_REQUIREMENTS.map((requirement) => (
            <Card key={requirement.title} title={requirement.title}>
              <ul className="space-y-3 text-sm text-stone">
                {requirement.items.map((item) => (
                  <RoadmapItemRow key={item.text} item={item} dotClass="bg-metric" />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
