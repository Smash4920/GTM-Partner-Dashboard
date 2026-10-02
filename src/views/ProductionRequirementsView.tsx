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

/** Compact row data; a blocker always denotes the sole production status, Prod Only. */
type RoadmapItemTuple = readonly [
  text: string,
  productionBlocker?: string,
  demo?: RoadmapItem['demo'],
  demoScope?: string,
];

/** Omitted demo statuses and text-only rows share the group's default, normally Pending. */
function roadmapItems(
  rows: readonly (string | RoadmapItemTuple)[],
  defaultDemo: RoadmapItem['demo'] = 'pending',
): RoadmapItem[] {
  return rows.map((row) => {
    const [text, blocker, demo = defaultDemo, demoScope]: RoadmapItemTuple =
      typeof row === 'string' ? [row] : row;
    const item: RoadmapItem = { text, demo };
    // Missing tuple slots stay absent properties, not present-but-undefined.
    if (demoScope !== undefined) item.demoScope = demoScope;
    if (blocker !== undefined) item.production = { status: 'prod-only', blocker };
    return item;
  });
}

/**
 * The server-side foundation required before connecting protected business
 * systems or serving external partners. Statuses are stamped against what the
 * code actually does today, not against intent. Each row carries a Demo status
 * for its verified client behavior and, where a production dependency is
 * intentionally paused, a separate Production status. A finished demo therefore
 * never reads as a finished production step: verified mixed rows render `Demo: Complete`
 * beside `Production: Prod Only` and name both the usable demo portion and the
 * exact production blocker.
 */
export const REQUIREMENTS: { title: string; items: RoadmapItem[] }[] = [
  {
    title: 'Identity and access control',
    items: roadmapItems([
      [
        'Authenticate internal users and partners through the company identity provider.',
        'Requires a company identity provider and trusted sign-in; the client-only demo has no authentication.',
      ],
      [
        'Enforce role, manager, and partner access on the server, with row-level authorization for every query.',
        'Server-side row-level authorization needs a trusted API and identity claims; client filtering is presentation, not authorization.',
        'complete',
        'Every data query applies tested demo scope before aggregation and pagination; client filtering is not authorization.',
      ],
      // Excluded from this mission: the picker itself is unchanged and its
      // client-only limitation is documented rather than implemented, so
      // the demo portion stays Pending.
      [
        "Remove the partner picker outside an internal demo mode so a partner never receives another partner's data.",
        'External use requires trusted sign-in and server-enforced row access first.',
        undefined,
        'The picker is an untrusted demo presentation selector; client-side filtering is not authorization.',
      ],
    ]),
  },
  {
    title: 'Source-system integration',
    items: roadmapItems([
      [
        'Connect Salesforce or HubSpot as the opportunity and deal-registration system of record.',
        'Requires a live CRM connection with server-held OAuth credentials.',
      ],
      [
        "Sync Google Calendar activity and the enablement system's certification records with approved OAuth scopes.",
        'Requires approved OAuth scopes and server-held credentials for calendar and enablement systems.',
      ],
      [
        'Use incremental syncs, webhooks where available, scheduled reconciliation, retries, and dead-letter handling.',
        'Requires a server-side ingestion pipeline against live source systems.',
      ],
    ]),
  },
  {
    title: 'Data model, quality, and fiscal controls',
    items: roadmapItems([
      [
        'Normalize source records into a canonical partner, opportunity, registration, target, activity, and certification model.',
        'Normalizing real source records into it waits on live ingestion and source credentials.',
        'complete',
        'Pure, strict source-shaped adapters validate canonical records and preserve provenance without connecting a source.',
      ],
      [
        'Validate stages, statuses, revenue motions, target periods, dates, and foreign-key relationships at ingestion.',
        'Ingestion-time validation needs a live ingestion pipeline.',
      ],
      'Make fiscal calendar, timezone, as-of date, attribution rules, and target definitions configurable instead of static.',
      [
        'Expose source lineage, last-refresh time, and incomplete-data errors in the product.',
        'Live last-refresh times and real incomplete-data errors need connected source systems.',
        'complete',
        'Scoped answers expose deterministic as-of, lineage, completeness, warnings, and independent widget errors and retries.',
      ],
    ]),
  },
  {
    title: 'Persistence and operating workflows',
    items: roadmapItems([
      [
        'Persist forecast overrides, notes, next steps, classifications, and partner additions with author, timestamp, reason, and audit history.',
        'Durable persistence and audit history need a write path and datastore; edits are session-only React state by design.',
      ],
      'Define the system of record and write-back workflow for every editable field, including conflict resolution.',
      [
        'Add approvals and SLAs for deal registrations, partner conflicts, and forecast changes where required.',
        'Enforced approver identity and durable approvals for conflicts and forecast changes need trusted identity and a write path.',
        'complete',
        'Business-day SLAs and session-only decisions, conflict dispositions, and forecast reviews record actor, reason, and time; actors are not authenticated.',
      ],
    ]),
  },
  {
    title: 'Security, privacy, and compliance',
    items: roadmapItems([
      [
        'Keep CRM tokens and partner data on the server; never expose them in browser bundles.',
        'Requires a server to hold CRM tokens and partner data.',
      ],
      [
        'Apply encryption, secrets management, least-privilege service accounts, audit logging, retention policies, and incident response.',
        'Requires production infrastructure, secrets management, and operational controls.',
      ],
      [
        'Complete privacy, legal, and security review for calendar data and external partner access.',
        'Requires real calendar data and external partner access to review.',
      ],
    ]),
  },
  {
    title: 'Reliability, scale, and delivery',
    items: roadmapItems([
      [
        'Serve aggregated, paginated API responses rather than loading the entire ecosystem into the browser.',
        'Serving these responses for real needs a production API with warehouse rollups.',
        'complete',
        'Every data-bearing route uses bounded scoped answers and cursor pages; the whole-book interface and loader are deleted.',
      ],
      [
        'Add observability for sync health, data freshness, API errors, performance, and authorization failures.',
        'Sync health, data freshness, and authorization-failure signals need the production systems they describe.',
        'complete',
        'Local shell/provider health survives startup failure; technical events are allowlisted and every outbound path obeys the telemetry master switch.',
      ],
      [
        'Add automated unit, integration, end-to-end, accessibility, and security tests, plus backups and recovery procedures.',
        'Backups and recovery procedures need production infrastructure.',
        'complete',
        'Unit, provider, and policy suites are CI-gated; keyboard and route/modal axe suites run against production preview; recovery runbooks document session reset and Prod Only blockers.',
      ],
      [
        'Deploy through separate development, staging, and production environments with CI/CD and monitored rollbacks.',
        'Separate staging and production environments with monitored rollbacks need deployment accounts and infrastructure.',
        'complete',
        'Blocking CI policy checks enforce immutable actions, least privilege, finite timeouts, and local production-preview parity; remote settings are unverified.',
      ],
    ]),
  },
  {
    title: 'Feature delivery governance',
    items: roadmapItems([
      [
        'Define a feature-flag methodology covering naming, ownership, safe defaults, environment scope, targeting, rollout and rollback, observability, review, expiration, and removal.',
        'Flag observability and a managed control plane need production telemetry and identity.',
        'complete',
        'Every flag carries owner, purpose, environment scope, safe default, rollout/rollback triggers, review, expiry, and removal metadata; policy checks fail on gaps or expiry.',
      ],
      [
        'Provide an authenticated control plane where approved nontechnical maintainers can change flags without code changes or redeployment, with role-based access, approvals, audit history, and emergency kill switches.',
        'An authenticated flag control plane needs a server and identity the client-only app cannot provide.',
      ],
      [
        'Keep authorization and data-access enforcement independent from feature flags, and define cached fail-safe behavior when the control plane is unavailable.',
        undefined,
        'complete',
        'Fresh value, then bounded last-known-good cache, then the safe default. Flags are local and non-authoritative: they never alter demo access scope, roles, or returned rows.',
      ],
    ]),
  },
];

/**
 * Product-level roadmap for what the GTM Partnerships leader needs from the
 * tool, additive to the architecture foundation above. Nothing here is
 * required to ship the demo — it is the backlog that turns raw pipeline data
 * into a decisions-first product.
 */
export const UTILITY_REQUIREMENTS: { title: string; items: RoadmapItem[] }[] = [
  {
    title: 'Forecast quality',
    items: roadmapItems([
      [
        'Live sketch: probability-weighted forecast over the open book, with manager-editable category calls and a "disagrees with stage" call-out.',
        undefined,
        'complete',
      ],
      // Deferred: weekly snapshots record every call as made, but they lack
      // immutable historical partner-manager ownership and authoritative
      // stage-entry events, so the manager/partner trend cannot be built
      // honestly yet. No narrower substitute is presented as this item.
      [
        'Turn per-deal judgments into trend: close-date slippage, stage aging, and category-confidence history per manager and partner.',
        'Needs immutable historical partner-manager ownership and authoritative stage-entry events; weekly snapshots, health alerts, and forecast reviews are not substitutes.',
      ],
      'MEDDPICC-or-equivalent qualification structured on every open opportunity.',
      'Forecast accuracy by partner, manager, motion, and quarter.',
    ]),
  },
  {
    title: 'Partner health and lifecycle',
    items: roadmapItems([
      'Track the recruitment → onboarding → enabled → activated → productive → strategic lifecycle.',
      'Time-to-first-registration, time-to-first-opportunity, time-to-first-win, and time-to-repeat-win.',
      'Engagement recency, executive sponsor coverage, certification velocity, and inactive-partner alerts.',
      'A health score with transparent, visible drivers, not a black box.',
    ]),
  },
  {
    title: 'Deal-registration operations',
    items: roadmapItems(
      [
        'Registration SLA, aging buckets, approval/rejection reasons, and duplicate/overlap rate.',
        'Conversion time from submitted → approved → opportunity → win.',
        'Leakage: approved registrations without an opportunity, expired registrations, and partner conflict.',
      ],
      'complete',
    ),
  },
  {
    title: 'Actionability',
    items: roadmapItems([
      [
        'Alerts for stale high-value deals, missing next steps, slipping close dates, pending registrations beyond SLA, and deteriorating partner health.',
        'Continuous production alerting needs connected source data and scheduled server-side evaluation and delivery.',
        'complete',
        'All five alert categories have deterministic evidence, configurable session-only policy, merged items, routing, filters, and cursor pages.',
      ],
      [
        'Owner, due date, disposition, and workflow links back to Salesforce/HubSpot, PRM, Slack, and calendar.',
        'Workflow links back to Salesforce/HubSpot, PRM, Slack, and calendar need those connected systems.',
        'complete',
        'Owner, due date, session-only workflows, internal context links, and simulated/local-only notification records are available; no external delivery or write-back occurs.',
      ],
      'Saved views and scheduled executive/manager reporting.',
    ]),
  },
  {
    title: 'Partner portal utility',
    items: roadmapItems([
      'Shared account plans, mutual action plans, deal collaboration, registration status explanations, enablement recommendations, and support escalation.',
      [
        'Granular, server-enforced visibility rules, not merely a partner-scoped dashboard.',
        "Server-enforced visibility needs a trusted API and identity; today's partner scoping is client-side presentation.",
      ],
    ]),
  },
  {
    title: 'Attribution and crediting',
    items: roadmapItems([
      'Sourced, influenced, assisted, reseller, marketplace, referral, and expansion attribution.',
      'Multi-partner credit splits and sales/partner ownership.',
      'Explicit attribution rules, effective dates, and a deal-credit dispute workflow.',
    ]),
  },
  {
    title: 'Services delivery',
    items: roadmapItems([
      'A delivery record per engagement: which partner is delivering which service type — implementation, migration, managed service, custom development, enablement and training, advisory — for which client, with start, go-live, and delivery owner.',
      'The commercial shape of each engagement: Factory revenue attached (license, allocated drawdown, services pass-through) versus no direct revenue, and long-term adoption plays whose return is seat expansion or renewal rather than bookings this quarter.',
      'Engagements linked to their opportunity, partner, and account so delivery reads next to pipeline and closed-won instead of living in a spreadsheet.',
      "Outcomes per engagement: adoption and consumption milestones, go-live slippage, post-delivery expansion, and which partners' delivery produces repeat revenue.",
      "Delivery capacity by service type: certified practitioners available, engagements in flight, and where demand is outrunning a partner's bench.",
    ]),
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
 * than the price of a warehouse. The answer was yes: all eight routes migrated,
 * and the legacy whole-book contract is deleted.
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

export const MIGRATION_PHASES: MigrationPhase[] = [
  {
    phase: 'Phase 0',
    title: 'Test infrastructure',
    subtitle: 'No infrastructure required · landed in demo mode',
    demoMode: true,
    status: 'Done · coverage floors 95/90/96/96%, gated in CI',
    items: roadmapItems(
      [
        'jsdom, Testing Library, and a coverage provider, with the thresholds in vite.config.ts as a ratchet and CI running coverage rather than a bare test run.',
        'Coverage went from 27.88% statements overall and 0% across every view, component, App.tsx, and useDashboardData, to 91% — the 5,700 lines Phase 1 was about to move by hand are now watched.',
        'Four correctness bugs found by the first tests, each with a regression test: a cleared next step coming back, a throw in any view blanking the whole app, unguarded division rendering "∞% of goal", and the meeting modal discarding a week of unsubmitted classifications on a stray click.',
      ],
      'complete',
    ),
  },
  {
    phase: 'Phase 1',
    title: 'Contract rewrite against the mock',
    subtitle: 'No infrastructure required · landed in demo mode',
    demoMode: true,
    status:
      'Done · every route reads scoped queries, and the legacy whole-book contract is deleted',
    items: roadmapItems(
      [
        'DataProvider was split in two — the scoped aggregates and cursor-paginated row lists that are the target shape, and the eight list-everything calls — and every route moved across. The legacy half and its loader are now deleted, so the interface ships only bounded answers.',
        'MockDataProvider writes the answers behind the seam, using the same metrics functions the views used to call themselves — so src/lib/metrics is now the specification a server has to match, and its test suite is the conformance check.',
        'listPipelineSnapshots() is gone from the client contract entirely. History was ~87% of the payload at production volume and reached the client as millions of rows to answer a question about fourteen weeks; it now leaves as a ~13-bucket series, and only where a view asks.',
        'Forecasting was migrated first: the hottest edit path and the only view driven by that history. Its aggregate queries return the same kilobytes at 1× and at 100×, and its tables fetch 25 rows at a time per expanded manager.',
        'Two providers behind the same contract: a simulated remote one with ~250 ms round trips and a 15% failure rate, so per-widget loading, error, and retry states are exercised rather than theoretical, and a 100× book — 21,300 opportunities, 191,000 snapshot rows, ~45 MB — so the claim is demonstrated rather than asserted. Swap them from the header.',
      ],
      'complete',
    ),
  },
  {
    phase: 'Phase 2',
    title: 'Warehouse and fiscal calendar',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: roadmapItems([
      [
        'Fact and dimension model, with weekly pipeline snapshots partitioned by week and write-once — the "a snapshot already written never changes" invariant becomes a database permission rather than a comment.',
        'Requires a warehouse with partitioned, write-once snapshot storage.',
      ],
      [
        'Generate the date dimension from the fiscal calendar module so the dashboard and the warehouse cannot disagree about a quarter boundary or a business day.',
        'Requires a warehouse date dimension to generate against.',
      ],
      [
        'Idempotent weekly snapshot job, keyed so a re-run cannot double-write.',
        'Requires a scheduled server-side job against warehouse storage.',
      ],
    ]),
  },
  {
    phase: 'Phase 3',
    title: 'API with row-level authorization',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: roadmapItems([
      [
        'Serve the Phase 1 contract for real, with pre-aggregated rollups rather than live aggregation over millions of snapshot rows.',
        'Requires a production API and warehouse rollups.',
      ],
      [
        'Enforce partner and manager scope in the query itself, so a partner never receives another partner\u2019s data.',
        'Requires server-side row-level authorization backed by trusted identity claims.',
      ],
      [
        'Run the existing metrics tests against the server implementation as a conformance suite.',
        'Requires a server implementation to run the conformance suite against.',
      ],
    ]),
  },
  {
    phase: 'Phase 4',
    title: 'Incremental ingestion',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: roadmapItems([
      [
        'Watermark-based incremental sync from the CRM, with bulk backfill inside API quota.',
        'Requires a live CRM connection and server-held credentials.',
      ],
      [
        'Calendar and enablement sync over approved OAuth scopes, with reconciliation and dead-letter handling.',
        'Requires approved OAuth scopes and a server-side ingestion pipeline.',
      ],
    ]),
  },
  {
    phase: 'Phase 5',
    title: 'Write path and audit',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: roadmapItems([
      [
        'Persist overrides with author, timestamp, reason, and the source version they were made against.',
        'Requires a durable write path and datastore.',
      ],
      [
        'Decide and surface what happens when the source system changes a figure underneath an override.',
        'Requires a connected source system and write path to reconcile against.',
      ],
      [
        'Optimistic client updates, so an edited forecast still moves every metric instantly instead of waiting on a round trip.',
        'The full optimistic delta needs the write path to reconcile against.',
        'complete',
        "Rows render the session's override immediately and aggregates hold their previous figures during a refetch.",
      ],
    ]),
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
            <span className="font-mono text-[11px] text-stone">docs/migration-plan.md</span>.{' '}
            Production continuation requires trusted identity first, then warehouse and scoped
            API/RLS, ingestion, persisted writes/audit, and operations; all remain Prod Only.
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
            calls), deal-registration operations, and the session-only Action Center; the rest of
            this backlog turns raw pipeline data into those decisions.
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
