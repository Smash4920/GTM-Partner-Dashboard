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

type ConnectionNodeTuple = [
  id: string,
  label: string,
  tier: ConnectionTier,
  status: ConnectionStatus,
  summary: string,
  supplies: string[],
  methods: (number | string)[],
  details: [
    blocker: string,
    source?: string,
    auth?: string,
    cadence?: string,
    owner?: ConnectionNode['owner'],
  ],
  y: number,
  h?: number,
];

// Columns share geometry; metadata defaults to architecture and keeps missing fields absent.
export const CONNECTION_NODES: ConnectionNode[] = (
  [
    [
      'salesforce',
      'Salesforce',
      'source',
      'required',
      'System of record for the opportunity book, deal registrations, accounts, and quota.',
      [
        'Opportunity book and stages',
        'Deal registrations and decisions',
        'Targets and fiscal periods',
      ],
      [7, 9, 10, 11, 12, 13, 16, 17, 18, 22, 23, 24, 25, 26],
      [
        'No server-side token store and no row-level authorization yet (Architecture roadmap: identity and access control, source-system integration).',
        'Opportunity, Deal_Registration__c, Account, quota objects',
        'Connected app, OAuth 2.0 JWT bearer, service account',
        '15-minute incremental sync plus webhooks',
      ],
      56,
    ],
    [
      'hubspot',
      'HubSpot (alternate CRM)',
      'source',
      'planned',
      'Second CRM adapter for teams that run the partner motion on HubSpot.',
      ['The same scoped contract as Salesforce, read from HubSpot'],
      [],
      [
        'One system of record per deployment is enough to start, so the second adapter waits on tenant selection.',
        'Deals and custom objects',
        'Private app token, held server-side',
        'Per tenant, on demand',
        'product',
      ],
      132,
    ],
    [
      'calendar',
      'Google Calendar',
      'source',
      'required',
      'Partner meetings, imported per manager and classified into call types.',
      ['Weekly activity and meeting goals', 'PIO interlock counting'],
      [14, 15, 29],
      [
        'Google OAuth verification and the calendar-data privacy review are outstanding (Architecture roadmap: security, privacy, and compliance).',
        'Event resources, one primary calendar per partner manager',
        'OAuth 2.0 offline access, domain-wide delegation',
        'Daily sync plus push notification channels',
      ],
      208,
    ],
    [
      'enablement',
      'Enablement system',
      'source',
      'required',
      'Partner Strategist and Partner Engineer certification records against goal.',
      ['Certified practitioners per partner', 'Certification attainment'],
      [21],
      [
        'Source system not chosen yet; the certification contract is already defined by the demo model.',
        'Certification records by partner and by practitioner',
        'Service credential, read-only scope',
        'Nightly reconciliation',
        'product',
      ],
      284,
    ],
    [
      'prm',
      'Partner PRM',
      'source',
      'planned',
      'Partner accounts, lifecycle stage, and the manager alignment that routes work.',
      ['Partner roster and lifecycle', 'Account → partner manager alignment'],
      [8, 20, 19],
      [
        'CRM account data covers this today; a PRM becomes the source when lifecycle tracking ships (Product roadmap: partner health and lifecycle).',
        'Partner account and Account.Partner_Manager__c',
        'OAuth 2.0, read scope',
        'Hourly',
        'product',
      ],
      360,
    ],
    [
      'warehouse',
      'Warehouse (Snowflake)',
      'source',
      'planned',
      'Weekly snapshots of the open book — the only source of pipeline history, and the only collection that can never ship whole.',
      [
        'Week-over-week pipeline movement as ~14 weekly buckets, not 2.3 M rows',
        'Forecast accuracy, once calls can be scored',
      ],
      [6],
      [
        'The snapshot job does not exist yet; the demo fabricates a deterministic history instead. The client contract is already shaped around it: the old listPipelineSnapshots() call is gone, and history leaves the seam only as the aggregate below.',
        'OpportunityHistory, or a weekly fact table',
        'Service account with a read-only role',
        'Weekly job after each Monday recording',
      ],
      436,
    ],
    [
      'ingest',
      'Ingest & sync',
      'platform',
      'required',
      'Per-source connectors with incremental syncs, webhooks, retries, and dead-letter handling.',
      ['Raw source records, validated on the way in', 'Sync health and freshness'],
      [],
      [
        'There is no server yet: the browser reads the mock provider directly (Architecture roadmap: source-system integration, reliability).',
        'One adapter per source system above',
        'All credentials held server-side, never in the browser bundle',
        'Scheduled and event-driven',
      ],
      120,
      84,
    ],
    [
      'canonical',
      'Canonical data model',
      'platform',
      'live',
      'One validated partner / opportunity / registration / target / activity / certification model, served in-process by the mock provider.',
      ['The single book every view renders', 'A deterministic snapshot (as-of) date'],
      ['MockDataProvider — this demo'],
      [
        'Live only over mock data. A real deployment swaps the provider for the synced store without touching a view — see DataProvider.ts.',
        'Normalized tables behind the DataProvider interface',
        undefined,
        'In-process and snapshot-dated; no sync runs in the demo',
      ],
      248,
      96,
    ],
    [
      'api',
      'Dashboard API & UI',
      'platform',
      'live',
      'Aggregated, paginated reads computed in-process, plus every session edit layered on top of the provider book. Row authorization is not a client concern: in production a scoped API would enforce it, so the browser receives kilobytes.',
      [
        'Screens, exports, and scheduled reporting',
        'Pre-aggregated forecast figures per scope',
        'Scoped Action Center counts and cursor pages under session-only demo policy',
      ],
      [2, 3, 4, 5, 0, 1],
      [
        'Writes are session-only in the demo: revenue overrides, forecast calls, notes, next steps, meeting classifications, and added prospects are not persisted (Architecture roadmap: persistence and operating workflows).',
      ],
      400,
      84,
    ],
    [
      'idp',
      'Identity provider (SSO)',
      'destination',
      'required',
      'Authenticates internal users and partners, and owns the roster, roles, and manager alignment.',
      ['Sign-in and role claims', 'The partner-team roster in Access below'],
      [27],
      [
        'Not connected: the roster below is a current-session notification-routing simulation — roster changes never provision, authorize, revoke, or restore sign-in or data access. SSO, roles, and row-level authorization are the first architecture item for a reason: nothing else can be exposed safely without them.',
        'OIDC/SAML application plus SCIM directory sync',
        'OIDC for sessions, SCIM token for provisioning',
        'SCIM in real time, just-in-time on first sign-in',
      ],
      40,
      96,
    ],
    [
      'notifications',
      'Notification service',
      'destination',
      'required',
      'Delivers SLA alerts and ad-hoc notes to one named owner over the channels they are configured for.',
      ['Deal-registration SLA warnings and breaches', 'Hand-sent notes about a record'],
      ['sendNotification()', 28],
      [
        'Not connected: demo sends are simulated, local-only session records and are never delivered. A real service needs identity to know who owns a registration, the registration sync to know what is late, and a scheduler to evaluate the rule each business day.',
        'Slack app for direct messages, transactional email provider',
        'Bot token with chat:write; email through the transactional provider',
        'Event-driven, evaluated when the alert rule fires',
      ],
      246,
      96,
    ],
    [
      'writeback',
      'CRM write-back',
      'destination',
      'planned',
      'Persists a manager\u2019s judgment — revenue, forecast call, note, next step, decision — back to the system of record.',
      ['Editable fields with author, timestamp, reason, and audit history'],
      ['Updates on the source objects'],
      [
        'Needs a decision on which side wins a conflicting edit and field-level audit history before anything writes back.',
        'Opportunity and Deal_Registration__c updates',
        'Write scope on the service account, least privilege',
        'Immediately on save, with conflict resolution',
      ],
      452,
      96,
    ],
  ] satisfies ConnectionNodeTuple[]
).map(
  ([
    id,
    label,
    tier,
    status,
    summary,
    supplies,
    methods,
    [blocker, source, auth, cadence, owner = 'architecture' as const],
    y,
    h = 62,
  ]) => ({
    id,
    label,
    tier,
    status,
    summary,
    supplies,
    // Numeric references use the ordered seam registry instead of shipping a
    // second copy of its names. Full-record parity and the closed method-order
    // test pin every reference, including these caller-specific display orders.
    methods: methods.map((method) =>
      typeof method === 'number' ? `${DATA_PROVIDER_METHODS[method]}()` : method,
    ),
    ...(source === undefined ? {} : { source }),
    ...(auth === undefined ? {} : { auth }),
    ...(cadence === undefined ? {} : { cadence }),
    blocker,
    owner,
    x: CONNECTION_TIER_META[tier].x,
    y,
    w: CONNECTION_TIER_META[tier].w,
    h,
  }),
);

type ConnectionEdgeTuple = [
  fromNode: number,
  toNode: number,
  label: string,
  status: ConnectionStatus,
  detail: string,
  twoWay?: boolean,
];

export const CONNECTION_EDGES: ConnectionEdge[] = (
  [
    [
      0,
      6,
      'Opps, regs, targets',
      'required',
      'The one source with no substitute: without the CRM the dashboard has no book, no registrations, and no quota.',
    ],
    [
      1,
      6,
      'Alternate CRM path',
      'planned',
      'A second adapter behind the same interface; only one runs in a deployment.',
    ],
    [
      2,
      6,
      'Meetings to classify',
      'required',
      'Feeds Activity Tracking; a meeting is only counted once a manager classifies it.',
    ],
    [
      3,
      6,
      'Certifications',
      'required',
      'Certification counts sit beside each partner in the performance and portal views.',
    ],
    [
      4,
      6,
      'Partners + managers',
      'planned',
      'The roster and its manager alignment; CRM accounts stand in until a PRM is chosen.',
    ],
    [
      5,
      7,
      'Weekly snapshots',
      'planned',
      'History joins the canonical model rather than the live book: snapshots are append-only and never corrected.',
    ],
    [
      6,
      7,
      'Validated records',
      'live',
      'In the demo the mock generator plays both roles: seeded records arrive already canonical.',
    ],
    [
      7,
      8,
      'One book per request',
      'live',
      'Reads flow out; session edits flow back into the same merged book, which is why every view moves together.',
      true,
    ],
    [
      9,
      8,
      'SSO session + roster',
      'required',
      'Authorization cannot be a client-side filter. The partner picker has to go behind a real sign-in.',
    ],
    [
      8,
      10,
      'SLA alerts, notes',
      'required',
      'The alert rule rides on data that is only trustworthy once the registration sync and the roster are real.',
    ],
    [
      8,
      11,
      'Edits to persist',
      'planned',
      'Closes the loop: today an edit changes the screen and nothing else, and is gone on reload.',
      true,
    ],
  ] satisfies ConnectionEdgeTuple[]
).map(([fromNode, toNode, label, status, detail, twoWay]) => {
  const from = CONNECTION_NODES[fromNode].id;
  const to = CONNECTION_NODES[toNode].id;
  return {
    id: `${from}-${to}`,
    from,
    to,
    label,
    status,
    direction: twoWay ? 'two-way' : 'one-way',
    detail,
  };
});

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
