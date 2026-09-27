import Card from '../components/Card';

const REQUIREMENTS = [
  {
    title: 'Identity and access control',
    items: [
      'Authenticate internal users and partners through the company identity provider.',
      'Enforce role, manager, and partner access on the server, with row-level authorization for every query.',
      "Remove the partner picker outside an internal demo mode so a partner never receives another partner's data.",
    ],
  },
  {
    title: 'Source-system integration',
    items: [
      'Connect Salesforce or HubSpot as the opportunity and deal-registration system of record.',
      "Sync Google Calendar activity and the enablement system's certification records with approved OAuth scopes.",
      'Use incremental syncs, webhooks where available, scheduled reconciliation, retries, and dead-letter handling.',
    ],
  },
  {
    title: 'Data model, quality, and fiscal controls',
    items: [
      'Normalize source records into a canonical partner, opportunity, registration, target, activity, and certification model.',
      'Validate stages, statuses, revenue motions, target periods, dates, and foreign-key relationships at ingestion.',
      'Make fiscal calendar, timezone, as-of date, attribution rules, and target definitions configurable instead of static.',
      'Expose source lineage, last-refresh time, and incomplete-data errors in the product.',
    ],
  },
  {
    title: 'Persistence and operating workflows',
    items: [
      'Persist forecast overrides, notes, next steps, classifications, and partner additions with author, timestamp, reason, and audit history.',
      'Define the system of record and write-back workflow for every editable field, including conflict resolution.',
      'Add approvals and SLAs for deal registrations, partner conflicts, and forecast changes where required.',
    ],
  },
  {
    title: 'Security, privacy, and compliance',
    items: [
      'Keep CRM tokens and partner data on the server; never expose them in browser bundles.',
      'Apply encryption, secrets management, least-privilege service accounts, audit logging, retention policies, and incident response.',
      'Complete privacy, legal, and security review for calendar data and external partner access.',
    ],
  },
  {
    title: 'Reliability, scale, and delivery',
    items: [
      'Serve aggregated, paginated API responses rather than loading the entire ecosystem into the browser.',
      'Add observability for sync health, data freshness, API errors, performance, and authorization failures.',
      'Add automated unit, integration, end-to-end, accessibility, and security tests, plus backups and recovery procedures.',
      'Deploy through separate development, staging, and production environments with CI/CD and monitored rollbacks.',
    ],
  },
];

/**
 * Product-level roadmap for what the GTM Partnerships leader needs from the
 * tool, additive to the architecture foundation above. Nothing here is
 * required to ship the demo — it is the backlog that turns raw pipeline data
 * into a decisions-first product.
 */
const UTILITY_REQUIREMENTS = [
  {
    title: 'Forecast quality',
    items: [
      'Live sketch: probability-weighted forecast over the open book, with manager-editable category calls and a "disagrees with stage" call-out.',
      'Turn per-deal judgments into trend: close-date slippage, stage aging, and category-confidence history per manager and partner.',
      'MEDDPICC-or-equivalent qualification structured on every open opportunity.',
      'Forecast accuracy by partner, manager, motion, and quarter.',
    ],
  },
  {
    title: 'Partner health and lifecycle',
    items: [
      'Track the recruitment → onboarding → enabled → activated → productive → strategic lifecycle.',
      'Time-to-first-registration, time-to-first-opportunity, time-to-first-win, and time-to-repeat-win.',
      'Engagement recency, executive sponsor coverage, certification velocity, and inactive-partner alerts.',
      'A health score with transparent, visible drivers, not a black box.',
    ],
  },
  {
    title: 'Deal-registration operations',
    items: [
      'Registration SLA, aging buckets, approval/rejection reasons, and duplicate/overlap rate.',
      'Conversion time from submitted → approved → opportunity → win.',
      'Leakage: approved registrations without an opportunity, expired registrations, and partner conflict.',
    ],
  },
  {
    title: 'Actionability',
    items: [
      'Alerts for stale high-value deals, missing next steps, slipping close dates, pending registrations beyond SLA, and deteriorating partner health.',
      'Owner, due date, disposition, and workflow links back to Salesforce/HubSpot, PRM, Slack, and calendar.',
      'Saved views and scheduled executive/manager reporting.',
    ],
  },
  {
    title: 'Partner portal utility',
    items: [
      'Shared account plans, mutual action plans, deal collaboration, registration status explanations, enablement recommendations, and support escalation.',
      'Granular, server-enforced visibility rules, not merely a partner-scoped dashboard.',
    ],
  },
  {
    title: 'Attribution and crediting',
    items: [
      'Sourced, influenced, assisted, reseller, marketplace, referral, and expansion attribution.',
      'Multi-partner credit splits and sales/partner ownership.',
      'Explicit attribution rules, effective dates, and a deal-credit dispute workflow.',
    ],
  },
  {
    title: 'Services delivery',
    items: [
      'A delivery record per engagement: which partner is delivering which service type — implementation, migration, managed service, custom development, enablement and training, advisory — for which client, with start, go-live, and delivery owner.',
      'The commercial shape of each engagement: Factory revenue attached (license, allocated drawdown, services pass-through) versus no direct revenue, and long-term adoption plays whose return is seat expansion or renewal rather than bookings this quarter.',
      'Engagements linked to their opportunity, partner, and account so delivery reads next to pipeline and closed-won instead of living in a spreadsheet.',
      "Outcomes per engagement: adoption and consumption milestones, go-live slippage, post-delivery expansion, and which partners' delivery produces repeat revenue.",
      "Delivery capacity by service type: certified practitioners available, engagements in flight, and where demand is outrunning a partner's bench.",
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
  /** Where the phase stands, shown in green when it has landed. */
  status?: string;
  /** True when the work needs no infrastructure and can be built against the mock. */
  demoMode: boolean;
  items: string[];
}

const MIGRATION_PHASES: MigrationPhase[] = [
  {
    phase: 'Phase 0',
    title: 'Test infrastructure',
    subtitle: 'No infrastructure required · landed in demo mode',
    status: 'Done · 202 tests, 91.7% statements, gated in CI',
    demoMode: true,
    items: [
      'jsdom, Testing Library, and a coverage provider, with the thresholds in vite.config.ts as a ratchet and CI running coverage rather than a bare test run.',
      'Coverage went from 27.88% statements overall and 0% across every view, component, App.tsx, and useDashboardData, to 91% — the 5,700 lines Phase 1 was about to move by hand are now watched.',
      'Four correctness bugs found by the first tests, each with a regression test: a cleared next step coming back, a throw in any view blanking the whole app, unguarded division rendering "∞% of goal", and the meeting modal discarding a week of unsubmitted classifications on a stray click.',
    ],
  },
  {
    phase: 'Phase 1',
    title: 'Contract rewrite against the mock',
    subtitle: 'No infrastructure required · landed in demo mode',
    status: 'Done for Forecasting · seven views still on the old contract',
    demoMode: true,
    items: [
      'DataProvider is split in two: the scoped aggregates and cursor-paginated row lists that are the target shape, and the eight list-everything calls still being retired. Forecasting reads only the first.',
      'MockDataProvider writes the answers behind the seam, using the same metrics functions the views used to call themselves — so src/lib/metrics is now the specification a server has to match, and its test suite is the conformance check.',
      'listPipelineSnapshots() is gone from the client contract entirely. History was ~87% of the payload at production volume and reached the client as millions of rows to answer a question about fourteen weeks; it now leaves as a ~13-bucket series, and only where a view asks.',
      'Forecasting was migrated first: the hottest edit path and the only view driven by that history. Its aggregate queries return the same kilobytes at 1× and at 100×, and its tables fetch 25 rows at a time per expanded manager.',
      'Two providers behind the same contract: a simulated remote one with ~250 ms round trips and a 15% failure rate, so per-widget loading, error, and retry states are exercised rather than theoretical, and a 100× book — 21,300 opportunities, 191,000 snapshot rows, ~45 MB — so the claim is demonstrated rather than asserted. Swap them from the header.',
    ],
  },
  {
    phase: 'Phase 2',
    title: 'Warehouse and fiscal calendar',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      'Fact and dimension model, with weekly pipeline snapshots partitioned by week and write-once — the "a snapshot already written never changes" invariant becomes a database permission rather than a comment.',
      'Generate the date dimension from the fiscal calendar module so the dashboard and the warehouse cannot disagree about a quarter boundary or a business day.',
      'Idempotent weekly snapshot job, keyed so a re-run cannot double-write.',
    ],
  },
  {
    phase: 'Phase 3',
    title: 'API with row-level authorization',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      'Serve the Phase 1 contract for real, with pre-aggregated rollups rather than live aggregation over millions of snapshot rows.',
      'Enforce partner and manager scope in the query itself, so a partner never receives another partner\u2019s data.',
      'Run the existing metrics tests against the server implementation as a conformance suite.',
    ],
  },
  {
    phase: 'Phase 4',
    title: 'Incremental ingestion',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      'Watermark-based incremental sync from the CRM, with bulk backfill inside API quota.',
      'Calendar and enablement sync over approved OAuth scopes, with reconciliation and dead-letter handling.',
    ],
  },
  {
    phase: 'Phase 5',
    title: 'Write path and audit',
    subtitle: 'Requires infrastructure',
    demoMode: false,
    items: [
      'Persist overrides with author, timestamp, reason, and the source version they were made against.',
      'Decide and surface what happens when the source system changes a figure underneath an override.',
      'Optimistic client updates, so an edited forecast still moves every metric instantly instead of waiting on a round trip.',
    ],
  },
];

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
          required before connecting protected business systems or serving external partners.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {REQUIREMENTS.map((requirement) => (
          <Card key={requirement.title} title={requirement.title}>
            <ul className="space-y-3 text-sm text-stone">
              {requirement.items.map((item) => (
                <li key={item} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal"
                  />
                  <span>{item}</span>
                </li>
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
                  <li key={item} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                        phase.demoMode ? 'bg-metric' : 'bg-graphite'
                      }`}
                    />
                    <span>{item}</span>
                  </li>
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
                  <li key={item} className="flex gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-metric"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
