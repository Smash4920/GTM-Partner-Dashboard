/**
 * Independent object-based final roadmap fixture. Final demo outcomes replace
 * the original WIP checkpoint; unchanged rows, blockers, and omissions stay pinned.
 */
export const ROADMAP_BASELINE = {
  REQUIREMENTS: [
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
          demo: 'complete',
          demoScope:
            'Every data query applies tested demo scope before aggregation and pagination; client filtering is not authorization.',
          production: {
            status: 'prod-only',
            blocker:
              'Server-side row-level authorization needs a trusted API and identity claims; client filtering is presentation, not authorization.',
          },
        },
        {
          text: "Remove the partner picker outside an internal demo mode so a partner never receives another partner's data.",
          demo: 'pending',
          demoScope:
            'The picker is an untrusted demo presentation selector; client-side filtering is not authorization.',
          production: {
            status: 'prod-only',
            blocker: 'External use requires trusted sign-in and server-enforced row access first.',
          },
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
          demo: 'complete',
          demoScope:
            'Pure, strict source-shaped adapters validate canonical records and preserve provenance without connecting a source.',
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
          demo: 'complete',
          demoScope:
            'Scoped answers expose deterministic as-of, lineage, completeness, warnings, and independent widget errors and retries.',
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
          demo: 'complete',
          demoScope:
            'Business-day SLAs and session-only decisions, conflict dispositions, and forecast reviews record actor, reason, and time; actors are not authenticated.',
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
          demo: 'complete',
          demoScope:
            'Every data-bearing route uses bounded scoped answers and cursor pages; the whole-book interface and loader are deleted.',
          production: {
            status: 'prod-only',
            blocker:
              'Serving these responses for real needs a production API with warehouse rollups.',
          },
        },
        {
          text: 'Add observability for sync health, data freshness, API errors, performance, and authorization failures.',
          demo: 'complete',
          demoScope:
            'Local shell/provider health survives startup failure; technical events are allowlisted and every outbound path obeys the telemetry master switch.',
          production: {
            status: 'prod-only',
            blocker:
              'Sync health, data freshness, and authorization-failure signals need the production systems they describe.',
          },
        },
        {
          text: 'Add automated unit, integration, end-to-end, accessibility, and security tests, plus backups and recovery procedures.',
          demo: 'complete',
          demoScope:
            'Unit, provider, and policy suites are CI-gated; keyboard and route/modal axe suites run against production preview; recovery runbooks document session reset and Prod Only blockers.',
          production: {
            status: 'prod-only',
            blocker: 'Backups and recovery procedures need production infrastructure.',
          },
        },
        {
          text: 'Deploy through separate development, staging, and production environments with CI/CD and monitored rollbacks.',
          demo: 'complete',
          demoScope:
            'Blocking CI policy checks enforce immutable actions, least privilege, finite timeouts, and local production-preview parity; remote settings are unverified.',
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
  ],
  UTILITY_REQUIREMENTS: [
    {
      title: 'Forecast quality',
      items: [
        {
          text: 'Live sketch: probability-weighted forecast over the open book, with manager-editable category calls and a "disagrees with stage" call-out.',
          demo: 'complete',
        },
        {
          text: 'Turn per-deal judgments into trend: close-date slippage, stage aging, and category-confidence history per manager and partner.',
          demo: 'pending',
          production: {
            status: 'prod-only',
            blocker:
              'Needs immutable historical partner-manager ownership and authoritative stage-entry events; weekly snapshots, health alerts, and forecast reviews are not substitutes.',
          },
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
          demo: 'complete',
          demoScope:
            'All five alert categories have deterministic evidence, configurable session-only policy, merged items, routing, filters, and cursor pages.',
          production: {
            status: 'prod-only',
            blocker:
              'Continuous production alerting needs connected source data and scheduled server-side evaluation and delivery.',
          },
        },
        {
          text: 'Owner, due date, disposition, and workflow links back to Salesforce/HubSpot, PRM, Slack, and calendar.',
          demo: 'complete',
          demoScope:
            'Owner, due date, session-only workflows, internal context links, and simulated/local-only notification records are available; no external delivery or write-back occurs.',
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
  ],
  MIGRATION_PHASES: [
    {
      phase: 'Phase 0',
      title: 'Test infrastructure',
      subtitle: 'No infrastructure required · landed in demo mode',
      demoMode: true,
      status: 'Done · coverage floors 95/90/96/96%, gated in CI',
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
      status:
        'Done · every route reads scoped queries, and the legacy whole-book contract is deleted',
      items: [
        {
          text: 'DataProvider was split in two — the scoped aggregates and cursor-paginated row lists that are the target shape, and the eight list-everything calls — and every route moved across. The legacy half and its loader are now deleted, so the interface ships only bounded answers.',
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
          text: 'Enforce partner and manager scope in the query itself, so a partner never receives another partner’s data.',
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
          demo: 'complete',
          demoScope:
            "Rows render the session's override immediately and aggregates hold their previous figures during a refetch.",
          production: {
            status: 'prod-only',
            blocker: 'The full optimistic delta needs the write path to reconcile against.',
          },
        },
      ],
    },
  ],
} as const;
