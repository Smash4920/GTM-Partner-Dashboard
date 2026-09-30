/**
 * The integration map: every system the dashboard reads from or writes to, and
 * every wire between them.
 *
 * This is deliberately not part of the DataProvider. The provider hands the UI
 * business data; this file documents the *shape of the plumbing* that has to
 * exist before that data can be real, which is architecture rather than
 * content. The `methods` field on each node names the DataProvider method the
 * connection fills, so the catalog and the contract in DataProvider.ts can be
 * read against each other — a method with no wire is a connection nobody
 * planned for.
 *
 * Node positions are a fixed grid (single diagram, no auto-layout) rendered by
 * WireDiagram; keeping them here means the wires and the boxes always agree on
 * where a node sits.
 */

import { DATA_PROVIDER_METHODS } from './DataProvider';

export type ConnectionStatus = 'live' | 'required' | 'planned';

/** Column a node belongs to, left to right in the flow of data. */
export type ConnectionTier = 'source' | 'platform' | 'destination';

export interface ConnectionNode {
  id: string;
  label: string;
  tier: ConnectionTier;
  status: ConnectionStatus;
  /** What the system is, in one line. */
  summary: string;
  /** What it contributes to the dashboard. */
  supplies: string[];
  /** DataProvider methods this connection fills. */
  methods: string[];
  /** Object or API surface the data comes off. */
  source?: string;
  /** How the dashboard authenticates to it. */
  auth?: string;
  /** How fresh the data would be. */
  cadence?: string;
  /** What is missing, and which roadmap track owns it. */
  blocker?: string;
  owner?: 'architecture' | 'product';
  /** Layout on the fixed grid, in px. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Renders the partner-team roster inside this node (notification routing). */
  hostsTeam?: boolean;
}

export interface ConnectionEdge {
  id: string;
  from: string;
  to: string;
  /** What crosses the wire. */
  label: string;
  status: ConnectionStatus;
  direction: 'one-way' | 'two-way';
  detail: string;
}

export const CONNECTION_STATUS_META: Record<
  ConnectionStatus,
  {
    label: string;
    description: string;
    color: string;
    dotClass: string;
    textClass: string;
  }
> = {
  live: {
    label: 'Live',
    description:
      'Active in this demo as in-process mock/provider behavior only; no external system is connected.',
    color: '#a0ca92',
    dotClass: 'bg-metric',
    textClass: 'text-metric',
  },
  required: {
    label: 'Required',
    description: 'Must be connected before the dashboard serves real partner data.',
    color: '#ee6018',
    dotClass: 'bg-signal',
    textClass: 'text-signal',
  },
  planned: {
    label: 'Planned',
    description: 'Roadmap: valuable, but not blocking a first live release.',
    color: '#4d4947',
    dotClass: 'bg-graphite',
    textClass: 'text-granite',
  },
};

export const CONNECTION_TIER_META: Record<
  ConnectionTier,
  { label: string; caption: string; x: number; w: number }
> = {
  source: { label: 'Sources', caption: 'Systems of record', x: 0, w: 220 },
  platform: { label: 'Dashboard platform', caption: 'What we build and run', x: 272, w: 286 },
  destination: { label: 'Outbound', caption: 'Where judgment and alerts go', x: 656, w: 336 },
};

export const CONNECTION_NODES: ConnectionNode[] = [
  {
    id: 'salesforce',
    label: 'Salesforce',
    tier: 'source',
    status: 'required',
    summary: 'System of record for the opportunity book, deal registrations, accounts, and quota.',
    supplies: [
      'Opportunity book and stages',
      'Deal registrations and decisions',
      'Targets and fiscal periods',
    ],
    methods: [
      'listOpportunities()',
      'listQuarterOpportunities()',
      'listRegistrations()',
      'getTargets()',
      'getPerformanceSummary()',
      'getRegistrationFunnel()',
      'getStageBreakdown()',
      'getTypeBreakdown()',
      'getQuarterlyRevenueTrend()',
      'getRegistrationOpsSummary()',
      'getPartnerLeaderboard()',
      'listScopedOpportunities()',
      'listPendingRegistrations()',
      'listUnconvertedRegistrations()',
      'listDuplicateRegistrationGroups()',
    ],
    source: 'Opportunity, Deal_Registration__c, Account, quota objects',
    auth: 'Connected app, OAuth 2.0 JWT bearer, service account',
    cadence: '15-minute incremental sync plus webhooks',
    blocker:
      'No server-side token store and no row-level authorization yet (Architecture roadmap: identity and access control, source-system integration).',
    owner: 'architecture',
    x: 0,
    y: 56,
    w: 220,
    h: 62,
  },
  {
    id: 'hubspot',
    label: 'HubSpot (alternate CRM)',
    tier: 'source',
    status: 'planned',
    summary: 'Second CRM adapter for teams that run the partner motion on HubSpot.',
    supplies: ['The same canonical book, read from HubSpot'],
    methods: ['listOpportunities()', 'listRegistrations()', 'getTargets()'],
    source: 'Deals and custom objects',
    auth: 'Private app token, held server-side',
    cadence: 'Per tenant, on demand',
    blocker:
      'One system of record per deployment is enough to start, so the second adapter waits on tenant selection.',
    owner: 'product',
    x: 0,
    y: 132,
    w: 220,
    h: 62,
  },
  {
    id: 'calendar',
    label: 'Google Calendar',
    tier: 'source',
    status: 'required',
    summary: 'Partner meetings, imported per manager and classified into call types.',
    supplies: ['Weekly activity and meeting goals', 'PIO interlock counting'],
    methods: [
      'listActivities()',
      'getWeeklyActivitySeries()',
      'getWeeklyGoalProgress()',
      'listWeeklyClassificationMeetings()',
    ],
    source: 'Event resources, one primary calendar per partner manager',
    auth: 'OAuth 2.0 offline access, domain-wide delegation',
    cadence: 'Daily sync plus push notification channels',
    blocker:
      'Google OAuth verification and the calendar-data privacy review are outstanding (Architecture roadmap: security, privacy, and compliance).',
    owner: 'architecture',
    x: 0,
    y: 208,
    w: 220,
    h: 62,
  },
  {
    id: 'enablement',
    label: 'Enablement system',
    tier: 'source',
    status: 'required',
    summary: 'Partner Strategist and Partner Engineer certification records against goal.',
    supplies: ['Certified practitioners per partner', 'Certification attainment'],
    methods: ['listCertifications()', 'getPartnerCertification()'],
    source: 'Certification records by partner and by practitioner',
    auth: 'Service credential, read-only scope',
    cadence: 'Nightly reconciliation',
    blocker:
      'Source system not chosen yet; the certification contract is already defined by the demo model.',
    owner: 'product',
    x: 0,
    y: 284,
    w: 220,
    h: 62,
  },
  {
    id: 'prm',
    label: 'Partner PRM',
    tier: 'source',
    status: 'planned',
    summary: 'Partner accounts, lifecycle stage, and the manager alignment that routes work.',
    supplies: ['Partner roster and lifecycle', 'Account → partner manager alignment'],
    methods: [
      'listPartners()',
      'listPartnerManagers()',
      'getPartnerDirectory()',
      'getPartnerRoster()',
      'getManagerDirectory()',
    ],
    source: 'Partner account and Account.Partner_Manager__c',
    auth: 'OAuth 2.0, read scope',
    cadence: 'Hourly',
    blocker:
      'CRM account data covers this today; a PRM becomes the source when lifecycle tracking ships (Product roadmap: partner health and lifecycle).',
    owner: 'product',
    x: 0,
    y: 360,
    w: 220,
    h: 62,
  },
  {
    id: 'warehouse',
    label: 'Warehouse (Snowflake)',
    tier: 'source',
    status: 'planned',
    summary:
      'Weekly snapshots of the open book — the only source of pipeline history, and the only collection that can never ship whole.',
    supplies: [
      'Week-over-week pipeline movement as ~14 weekly buckets, not 2.3 M rows',
      'Forecast accuracy, once calls can be scored',
    ],
    methods: ['getWeeklyForecastSeries()'],
    source: 'OpportunityHistory, or a weekly fact table',
    auth: 'Service account with a read-only role',
    cadence: 'Weekly job after each Monday recording',
    blocker:
      'The snapshot job does not exist yet; the demo fabricates a deterministic history instead. The client contract is already shaped around it: the old listPipelineSnapshots() call is gone, and history leaves the seam only as the aggregate below.',
    owner: 'architecture',
    x: 0,
    y: 436,
    w: 220,
    h: 62,
  },
  {
    id: 'ingest',
    label: 'Ingest & sync',
    tier: 'platform',
    status: 'required',
    summary:
      'Per-source connectors with incremental syncs, webhooks, retries, and dead-letter handling.',
    supplies: ['Raw source records, validated on the way in', 'Sync health and freshness'],
    methods: [],
    source: 'One adapter per source system above',
    auth: 'All credentials held server-side, never in the browser bundle',
    cadence: 'Scheduled and event-driven',
    blocker:
      'There is no server yet: the browser reads the mock provider directly (Architecture roadmap: source-system integration, reliability).',
    owner: 'architecture',
    x: 272,
    y: 120,
    w: 286,
    h: 84,
  },
  {
    id: 'canonical',
    label: 'Canonical data model',
    tier: 'platform',
    status: 'live',
    summary:
      'One validated partner / opportunity / registration / target / activity / certification model, served in-process by the mock provider.',
    supplies: ['The single book every view renders', 'A deterministic snapshot (as-of) date'],
    methods: ['MockDataProvider — this demo'],
    source: 'Normalized tables behind the DataProvider interface',
    cadence: 'In-process and snapshot-dated; no sync runs in the demo',
    blocker:
      'Live only over mock data. A real deployment swaps the provider for the synced store without touching a view — see DataProvider.ts.',
    owner: 'architecture',
    x: 272,
    y: 248,
    w: 286,
    h: 96,
  },
  {
    id: 'api',
    label: 'Dashboard API & UI',
    tier: 'platform',
    status: 'live',
    summary:
      'Aggregated, paginated reads computed in-process, plus every session edit layered on top of the provider book. Row authorization is not a client concern: in production a scoped API would enforce it, so the browser receives kilobytes.',
    supplies: [
      'Screens, exports, and scheduled reporting',
      'Pre-aggregated forecast figures per scope',
    ],
    methods: [
      'getForecastSummary()',
      'getWeightedForecast()',
      'getForecastQuality()',
      'getManagerForecastGroups()',
      'DashboardData — every view',
    ],
    blocker:
      'Writes are session-only in the demo: revenue overrides, forecast calls, notes, next steps, meeting classifications, and added prospects are not persisted (Architecture roadmap: persistence and operating workflows).',
    owner: 'architecture',
    x: 272,
    y: 400,
    w: 286,
    h: 84,
  },
  {
    id: 'idp',
    label: 'Identity provider (SSO)',
    tier: 'destination',
    status: 'required',
    summary:
      'Authenticates internal users and partners, and owns the roster, roles, and manager alignment.',
    supplies: ['Sign-in and role claims', 'The partner-team roster in Access below'],
    methods: ['listTeamUsers()'],
    source: 'OIDC/SAML application plus SCIM directory sync',
    auth: 'OIDC for sessions, SCIM token for provisioning',
    cadence: 'SCIM in real time, just-in-time on first sign-in',
    blocker:
      'Not connected: the roster below is a current-session notification-routing simulation — roster changes never provision, authorize, revoke, or restore sign-in or data access. SSO, roles, and row-level authorization are the first architecture item for a reason: nothing else can be exposed safely without them.',
    owner: 'architecture',
    x: 656,
    y: 40,
    w: 336,
    h: 96,
  },
  {
    id: 'notifications',
    label: 'Notification service',
    tier: 'destination',
    status: 'required',
    summary:
      'Delivers SLA alerts and ad-hoc notes to one named owner over the channels they are configured for.',
    supplies: ['Deal-registration SLA warnings and breaches', 'Hand-sent notes about a record'],
    methods: ['sendNotification()'],
    source: 'Slack app for direct messages, transactional email provider',
    auth: 'Bot token with chat:write; email through the transactional provider',
    cadence: 'Event-driven, evaluated when the alert rule fires',
    blocker:
      'Not connected: demo sends are simulated, local-only session records and are never delivered. A real service needs identity to know who owns a registration, the registration sync to know what is late, and a scheduler to evaluate the rule each business day.',
    owner: 'architecture',
    x: 656,
    y: 164,
    w: 336,
    h: 252,
    hostsTeam: true,
  },
  {
    id: 'writeback',
    label: 'CRM write-back',
    tier: 'destination',
    status: 'planned',
    summary:
      'Persists a manager\u2019s judgment — revenue, forecast call, note, next step, decision — back to the system of record.',
    supplies: ['Editable fields with author, timestamp, reason, and audit history'],
    methods: ['Updates on the source objects'],
    source: 'Opportunity and Deal_Registration__c updates',
    auth: 'Write scope on the service account, least privilege',
    cadence: 'Immediately on save, with conflict resolution',
    blocker:
      'Needs a decision on which side wins a conflicting edit and field-level audit history before anything writes back.',
    owner: 'architecture',
    x: 656,
    y: 452,
    w: 336,
    h: 96,
  },
];

export const CONNECTION_EDGES: ConnectionEdge[] = [
  {
    id: 'salesforce-ingest',
    from: 'salesforce',
    to: 'ingest',
    label: 'Opps, regs, targets',
    status: 'required',
    direction: 'one-way',
    detail:
      'The one source with no substitute: without the CRM the dashboard has no book, no registrations, and no quota.',
  },
  {
    id: 'hubspot-ingest',
    from: 'hubspot',
    to: 'ingest',
    label: 'Alternate CRM path',
    status: 'planned',
    direction: 'one-way',
    detail: 'A second adapter behind the same interface; only one runs in a deployment.',
  },
  {
    id: 'calendar-ingest',
    from: 'calendar',
    to: 'ingest',
    label: 'Meetings to classify',
    status: 'required',
    direction: 'one-way',
    detail: 'Feeds Activity Tracking; a meeting is only counted once a manager classifies it.',
  },
  {
    id: 'enablement-ingest',
    from: 'enablement',
    to: 'ingest',
    label: 'Certifications',
    status: 'required',
    direction: 'one-way',
    detail: 'Certification counts sit beside each partner in the performance and portal views.',
  },
  {
    id: 'prm-ingest',
    from: 'prm',
    to: 'ingest',
    label: 'Partners + managers',
    status: 'planned',
    direction: 'one-way',
    detail: 'The roster and its manager alignment; CRM accounts stand in until a PRM is chosen.',
  },
  {
    id: 'warehouse-canonical',
    from: 'warehouse',
    to: 'canonical',
    label: 'Weekly snapshots',
    status: 'planned',
    direction: 'one-way',
    detail:
      'History joins the canonical model rather than the live book: snapshots are append-only and never corrected.',
  },
  {
    id: 'ingest-canonical',
    from: 'ingest',
    to: 'canonical',
    label: 'Validated records',
    status: 'live',
    direction: 'one-way',
    detail:
      'In the demo the mock generator plays both roles: seeded records arrive already canonical.',
  },
  {
    id: 'canonical-api',
    from: 'canonical',
    to: 'api',
    label: 'One book per request',
    status: 'live',
    direction: 'two-way',
    detail:
      'Reads flow out; session edits flow back into the same merged book, which is why every view moves together.',
  },
  {
    id: 'idp-api',
    from: 'idp',
    to: 'api',
    label: 'SSO session + roster',
    status: 'required',
    direction: 'one-way',
    detail:
      'Authorization cannot be a client-side filter. The partner picker has to go behind a real sign-in.',
  },
  {
    id: 'api-notifications',
    from: 'api',
    to: 'notifications',
    label: 'SLA alerts, notes',
    status: 'required',
    direction: 'one-way',
    detail:
      'The alert rule rides on data that is only trustworthy once the registration sync and the roster are real.',
  },
  {
    id: 'api-writeback',
    from: 'api',
    to: 'writeback',
    label: 'Edits to persist',
    status: 'planned',
    direction: 'two-way',
    detail:
      'Closes the loop: today an edit changes the screen and nothing else, and is gone on reload.',
  },
];

/**
 * The DataProvider methods the map claims to cover, for the coverage check in
 * tests.
 *
 * Derived from the contract rather than written out, so the two cannot drift:
 * `DATA_PROVIDER_METHODS` is keyed by `keyof DataProvider`, which means a new
 * method on the seam is a compile error there and a test failure here until it
 * has a wire or a box on this map. The check is the map's whole reason for
 * existing — a method with no wire is a connection nobody planned for — and it
 * only works if nobody has to remember to update a second list.
 */
export const CONNECTION_METHOD_COVERAGE = DATA_PROVIDER_METHODS.map((method) => `${method}()`);
