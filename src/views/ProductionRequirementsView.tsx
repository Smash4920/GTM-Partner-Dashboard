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
      'Persist forecast overrides, notes, classifications, and partner additions with author, timestamp, reason, and audit history.',
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
    </div>
  );
}
