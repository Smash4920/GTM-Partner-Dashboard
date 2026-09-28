import { RoadmapStatusBadge } from '../components/Badge';
import Card from '../components/Card';
import { ROADMAP_LAST_UPDATED, ROADMAP_STATUSES, ROADMAP_STATUS_META } from '../data/constants';
import type { RoadmapItem, RoadmapStatus } from '../data/types';
import { formatDate } from '../lib/format';

/**
 * The server-side foundation required before connecting protected business
 * systems or serving external partners. Statuses are stamped against what the
 * code actually does today, not against intent: `wip` means part of the item
 * has landed (usually the client-side half), `prod-only` means the step needs
 * production connections or infrastructure that do not exist yet.
 */
const REQUIREMENTS: { title: string; items: RoadmapItem[] }[] = [
  {
    title: 'Identity and access control',
    items: [
      {
        text: 'Authenticate internal users and partners through the company identity provider.',
        status: 'prod-only',
      },
      {
        // Client-side partner boundaries are enforced and e2e-tested, and the
        // scoped contract carries the manager scope; the enforcement itself is
        // Phase 3, on a server that does not exist yet.
        text: 'Enforce role, manager, and partner access on the server, with row-level authorization for every query.',
        status: 'wip',
      },
      {
        // Pure client change: gate the picker behind an internal demo mode. The
        // picker still renders unconditionally today.
        text: "Remove the partner picker outside an internal demo mode so a partner never receives another partner's data.",
        status: 'pending',
      },
    ],
  },
  {
    title: 'Source-system integration',
    items: [
      {
        text: 'Connect Salesforce or HubSpot as the opportunity and deal-registration system of record.',
        status: 'prod-only',
      },
      {
        text: "Sync Google Calendar activity and the enablement system's certification records with approved OAuth scopes.",
        status: 'prod-only',
      },
      {
        text: 'Use incremental syncs, webhooks where available, scheduled reconciliation, retries, and dead-letter handling.',
        status: 'prod-only',
      },
    ],
  },
  {
    title: 'Data model, quality, and fiscal controls',
    items: [
      {
        // The canonical model in src/data/types.ts is the app-wide contract
        // and is pinned by tests; what is missing is normalizing real source
        // records into it, which waits on ingestion.
        text: 'Normalize source records into a canonical partner, opportunity, registration, target, activity, and certification model.',
        status: 'wip',
      },
      {
        text: 'Validate stages, statuses, revenue motions, target periods, dates, and foreign-key relationships at ingestion.',
        status: 'prod-only',
      },
      {
        text: 'Make fiscal calendar, timezone, as-of date, attribution rules, and target definitions configurable instead of static.',
        status: 'pending',
      },
      {
        // The Data Connections map exposes per-node source, auth, cadence, and
        // gaps, and Forecasting has per-widget errors; live last-refresh times
        // and incomplete-data errors are not surfaced anywhere yet.
        text: 'Expose source lineage, last-refresh time, and incomplete-data errors in the product.',
        status: 'wip',
      },
    ],
  },
  {
    title: 'Persistence and operating workflows',
    items: [
      {
        // Every edit is session-only React state by design; the audit trail
        // is the Phase 5 write path.
        text: 'Persist forecast overrides, notes, next steps, classifications, and partner additions with author, timestamp, reason, and audit history.',
        status: 'prod-only',
      },
      {
        // The one item here that needs no production access: the decision can
        // be written down now, ahead of the write path that implements it.
        text: 'Define the system of record and write-back workflow for every editable field, including conflict resolution.',
        status: 'pending',
      },
      {
        // Registration SLAs and rejection reasons landed with the ops view;
        // conflict and forecast-change approval workflows did not.
        text: 'Add approvals and SLAs for deal registrations, partner conflicts, and forecast changes where required.',
        status: 'wip',
      },
    ],
  },
  {
    title: 'Security, privacy, and compliance',
    items: [
      {
        text: 'Keep CRM tokens and partner data on the server; never expose them in browser bundles.',
        status: 'prod-only',
      },
      {
        text: 'Apply encryption, secrets management, least-privilege service accounts, audit logging, retention policies, and incident response.',
        status: 'prod-only',
      },
      {
        text: 'Complete privacy, legal, and security review for calendar data and external partner access.',
        status: 'prod-only',
      },
    ],
  },
  {
    title: 'Reliability, scale, and delivery',
    items: [
      {
        // Forecasting reads the scoped contract; the other seven views still
        // take the whole book. This is the Phase 1 migration, one view at a time.
        text: 'Serve aggregated, paginated API responses rather than loading the entire ecosystem into the browser.',
        status: 'wip',
      },
      {
        // Structured logging and per-widget error states landed; sync health,
        // freshness, and authorization failures need the production systems
        // they describe.
        text: 'Add observability for sync health, data freshness, API errors, performance, and authorization failures.',
        status: 'wip',
      },
      {
        // Unit, seam, and Playwright suites are gated in CI; accessibility
        // and security tests, backups, and recovery are not there yet.
        text: 'Add automated unit, integration, end-to-end, accessibility, and security tests, plus backups and recovery procedures.',
        status: 'wip',
      },
      {
        // CI gates every pull request and Vercel serves per-PR previews;
        // separate staging and production environments and monitored rollbacks
        // do not exist yet.
        text: 'Deploy through separate development, staging, and production environments with CI/CD and monitored rollbacks.',
        status: 'wip',
      },
    ],
  },
  {
    title: 'Feature delivery governance',
    items: [
      {
        // The typed registry, safe defaults, environment override, and stable
        // percentage rollout have landed. Review, expiry, and removal policy
        // still need to be designed and adopted.
        text: 'Define a feature-flag methodology covering naming, ownership, safe defaults, environment scope, targeting, rollout and rollback, observability, review, expiration, and removal.',
        status: 'wip',
      },
      {
        // The client-only app has no authentication or server through which a
        // privileged management credential could safely pass.
        text: 'Provide an authenticated control plane where approved nontechnical maintainers can change flags without code changes or redeployment, with role-based access, approvals, audit history, and emergency kill switches.',
        status: 'prod-only',
      },
      {
        text: 'Keep authorization and data-access enforcement independent from feature flags, and define cached fail-safe behavior when the control plane is unavailable.',
        status: 'pending',
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
        status: 'complete',
      },
      {
        // The weekly snapshots already record every call as made; the
        // slippage, aging, and confidence-history reads on top of them are
        // not built.
        text: 'Turn per-deal judgments into trend: close-date slippage, stage aging, and category-confidence history per manager and partner.',
        status: 'pending',
      },
      {
        text: 'MEDDPICC-or-equivalent qualification structured on every open opportunity.',
        status: 'pending',
      },
      {
        text: 'Forecast accuracy by partner, manager, motion, and quarter.',
        status: 'pending',
      },
    ],
  },
  {
    title: 'Partner health and lifecycle',
    items: [
      {
        text: 'Track the recruitment → onboarding → enabled → activated → productive → strategic lifecycle.',
        status: 'pending',
      },
      {
        text: 'Time-to-first-registration, time-to-first-opportunity, time-to-first-win, and time-to-repeat-win.',
        status: 'pending',
      },
      {
        text: 'Engagement recency, executive sponsor coverage, certification velocity, and inactive-partner alerts.',
        status: 'pending',
      },
      {
        text: 'A health score with transparent, visible drivers, not a black box.',
        status: 'pending',
      },
    ],
  },
  {
    title: 'Deal-registration operations',
    items: [
      {
        text: 'Registration SLA, aging buckets, approval/rejection reasons, and duplicate/overlap rate.',
        status: 'complete',
      },
      {
        text: 'Conversion time from submitted → approved → opportunity → win.',
        status: 'complete',
      },
      {
        text: 'Leakage: approved registrations without an opportunity, expired registrations, and partner conflict.',
        status: 'complete',
      },
    ],
  },
  {
    title: 'Actionability',
    items: [
      {
        // Registration SLA warnings and breaches are live with owner routing;
        // the other four alert classes are not built.
        text: 'Alerts for stale high-value deals, missing next steps, slipping close dates, pending registrations beyond SLA, and deteriorating partner health.',
        status: 'wip',
      },
      {
        // Owner, due date, and disposition ride the notification flow; the
        // workflow links need the source systems they point at.
        text: 'Owner, due date, disposition, and workflow links back to Salesforce/HubSpot, PRM, Slack, and calendar.',
        status: 'wip',
      },
      {
        text: 'Saved views and scheduled executive/manager reporting.',
        status: 'pending',
      },
    ],
  },
  {
    title: 'Partner portal utility',
    items: [
      {
        text: 'Shared account plans, mutual action plans, deal collaboration, registration status explanations, enablement recommendations, and support escalation.',
        status: 'pending',
      },
      {
        // The partner scoping that exists today is client-side; the item asks
        // for enforcement on the server, which does not exist yet.
        text: 'Granular, server-enforced visibility rules, not merely a partner-scoped dashboard.',
        status: 'prod-only',
      },
    ],
  },
  {
    title: 'Attribution and crediting',
    items: [
      {
        text: 'Sourced, influenced, assisted, reseller, marketplace, referral, and expansion attribution.',
        status: 'pending',
      },
      {
        text: 'Multi-partner credit splits and sales/partner ownership.',
        status: 'pending',
      },
      {
        text: 'Explicit attribution rules, effective dates, and a deal-credit dispute workflow.',
        status: 'pending',
      },
    ],
  },
  {
    title: 'Services delivery',
    items: [
      {
        text: 'A delivery record per engagement: which partner is delivering which service type — implementation, migration, managed service, custom development, enablement and training, advisory — for which client, with start, go-live, and delivery owner.',
        status: 'pending',
      },
      {
        text: 'The commercial shape of each engagement: Factory revenue attached (license, allocated drawdown, services pass-through) versus no direct revenue, and long-term adoption plays whose return is seat expansion or renewal rather than bookings this quarter.',
        status: 'pending',
      },
      {
        text: 'Engagements linked to their opportunity, partner, and account so delivery reads next to pipeline and closed-won instead of living in a spreadsheet.',
        status: 'pending',
      },
      {
        text: "Outcomes per engagement: adoption and consumption milestones, go-live slippage, post-delivery expansion, and which partners' delivery produces repeat revenue.",
        status: 'pending',
      },
      {
        text: "Delivery capacity by service type: certified practitioners available, engagements in flight, and where demand is outrunning a partner's bench.",
        status: 'pending',
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
        status: 'complete',
      },
      {
        text: 'Coverage went from 27.88% statements overall and 0% across every view, component, App.tsx, and useDashboardData, to 91% — the 5,700 lines Phase 1 was about to move by hand are now watched.',
        status: 'complete',
      },
      {
        text: 'Four correctness bugs found by the first tests, each with a regression test: a cleared next step coming back, a throw in any view blanking the whole app, unguarded division rendering "∞% of goal", and the meeting modal discarding a week of unsubmitted classifications on a stray click.',
        status: 'complete',
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
        status: 'complete',
      },
      {
        text: 'MockDataProvider writes the answers behind the seam, using the same metrics functions the views used to call themselves — so src/lib/metrics is now the specification a server has to match, and its test suite is the conformance check.',
        status: 'complete',
      },
      {
        text: 'listPipelineSnapshots() is gone from the client contract entirely. History was ~87% of the payload at production volume and reached the client as millions of rows to answer a question about fourteen weeks; it now leaves as a ~13-bucket series, and only where a view asks.',
        status: 'complete',
      },
      {
        text: 'Forecasting was migrated first: the hottest edit path and the only view driven by that history. Its aggregate queries return the same kilobytes at 1× and at 100×, and its tables fetch 25 rows at a time per expanded manager.',
        status: 'complete',
      },
      {
        text: 'Two providers behind the same contract: a simulated remote one with ~250 ms round trips and a 15% failure rate, so per-widget loading, error, and retry states are exercised rather than theoretical, and a 100× book — 21,300 opportunities, 191,000 snapshot rows, ~45 MB — so the claim is demonstrated rather than asserted. Swap them from the header.',
        status: 'complete',
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
        status: 'prod-only',
      },
      {
        text: 'Generate the date dimension from the fiscal calendar module so the dashboard and the warehouse cannot disagree about a quarter boundary or a business day.',
        status: 'prod-only',
      },
      {
        text: 'Idempotent weekly snapshot job, keyed so a re-run cannot double-write.',
        status: 'prod-only',
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
        status: 'prod-only',
      },
      {
        text: 'Enforce partner and manager scope in the query itself, so a partner never receives another partner\u2019s data.',
        status: 'prod-only',
      },
      {
        text: 'Run the existing metrics tests against the server implementation as a conformance suite.',
        status: 'prod-only',
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
        status: 'prod-only',
      },
      {
        text: 'Calendar and enablement sync over approved OAuth scopes, with reconciliation and dead-letter handling.',
        status: 'prod-only',
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
        status: 'prod-only',
      },
      {
        text: 'Decide and surface what happens when the source system changes a figure underneath an override.',
        status: 'prod-only',
      },
      {
        // Partly done ahead of the write path: rows render the session's
        // override immediately and aggregates hold their previous figures
        // during a refetch. The full optimistic delta needs the write path to
        // reconcile against.
        text: 'Optimistic client updates, so an edited forecast still moves every metric instantly instead of waiting on a round trip.',
        status: 'wip',
      },
    ],
  },
];

/** One row of the status legend, badge plus its one-line definition. */
function StatusLegendEntry({ status }: { status: RoadmapStatus }) {
  const meta = ROADMAP_STATUS_META[status];
  return (
    <div className="flex items-center gap-2">
      <dt>
        <RoadmapStatusBadge status={status} />
      </dt>
      <dd className="text-xs text-granite">{meta.description}</dd>
    </div>
  );
}

/** Renders one roadmap item: text on the left, its status right-aligned. */
function RoadmapItemRow({ item, dotClass }: { item: RoadmapItem; dotClass: string }) {
  return (
    <li className="flex items-start gap-3">
      <span aria-hidden="true" className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${dotClass}`} />
      <span className="min-w-0 flex-1">{item.text}</span>
      <span className="shrink-0">
        <RoadmapStatusBadge status={item.status} />
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
          item carries its status against what the code does today.
        </p>
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {ROADMAP_STATUSES.map((status) => (
            <StatusLegendEntry key={status} status={status} />
          ))}
        </dl>
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
