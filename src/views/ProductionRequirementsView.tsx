import Card from '../components/Card';

const REQUIREMENTS = [
  {
    title: 'Identity and access control',
    items: [
      'Authenticate internal users and partners through the company identity provider.',
      'Enforce role, manager, and partner access on the server, with row-level authorization for every query.',
      'Remove the partner picker outside an internal demo mode so a partner never receives another partner’s data.',
    ],
  },
  {
    title: 'Source-system integration',
    items: [
      'Connect Salesforce or HubSpot as the opportunity and deal-registration system of record.',
      'Sync Google Calendar activity and the enablement system’s certification records with approved OAuth scopes.',
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
      'Forecast categories with probability weights: Commit (90%), Best Case (50%), Pipeline (25%), and Long Shot (10%), driving a probability-weighted forecast over the open book.',
      'Close-date slippage, stage aging, row-level next steps, and MEDDPICC-or-equivalent qualification on every open opportunity.',
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
          This demo uses deterministic mock data and session-only edits. The capabilities below
          are required before connecting protected business systems or serving external partners.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {REQUIREMENTS.map((requirement) => (
          <Card key={requirement.title} title={requirement.title}>
            <ul className="space-y-3 text-sm text-stone">
              {requirement.items.map((item) => (
                <li key={item} className="flex gap-3">
                  <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
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
            Product roadmap
          </p>
          <h2 className="mt-2 text-2xl tracking-tight text-bone">Utility Improvements</h2>
          <p className="mt-1 max-w-3xl text-sm text-granite">
            The decisions the GTM Partnerships leader needs the tool to make easy. These build on
            the architecture foundation above — none are shown live in the demo beyond their
            forecast-quality and deal-registration-op sketches.
          </p>
        </div>
        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
          {UTILITY_REQUIREMENTS.map((requirement) => (
            <Card key={requirement.title} title={requirement.title}>
              <ul className="space-y-3 text-sm text-stone">
                {requirement.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-metric" />
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
