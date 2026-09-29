/**
 * Per-envelope field allowlists: the privacy policy the transport enforces at
 * the single egress boundary before anything enters the send queue.
 *
 * Every envelope type has a registered set of technical fields — opaque IDs,
 * route/provider IDs, enums, counts, durations, status codes, release, and
 * coarse metadata. Anything else is dropped at queue time, and an
 * unregistered analytics event drops the whole envelope, so names, emails,
 * account or customer prose, notes, next steps, reasons, notification
 * bodies, raw provider records, secrets, query-bearing URLs, and raw error
 * messages or stacks can never sit in the queue or leave the browser,
 * whatever a caller passed. Field redaction (src/lib/redact.ts) then runs as
 * a second, defense-in-depth pass over what survived.
 */

export type TelemetryEnvelopeType =
  'log' | 'metric' | 'event' | 'trace' | 'error' | 'alert' | 'health';

/**
 * Registered product analytics events and the only properties each may
 * carry. An event name exists because the product decided to measure it, and
 * its property list is the privacy review of what that measurement includes.
 */
// Entry pairs, not an object literal: the snake_case event names are the
// wire format and would trip the camelCase property rule as keys.
const ANALYTICS_EVENT_ENTRIES = [
  ['route_view', ['route']],
  ['provider_selected', ['providerId']],
  ['forecast_revenue_edited', ['opportunityId']],
  ['forecast_call_changed', ['opportunityId', 'category']],
  ['meeting_classifications_committed', ['count']],
  ['partner_added', ['partnerId', 'partnerManagerId']],
  ['team_user_invited', ['role', 'partnerManagerId']],
  ['notification_sent', ['kind', 'channels']],
] as const satisfies ReadonlyArray<readonly [string, readonly string[]]>;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_ENTRIES)[number][0];

const analyticsEventRegistry = new Map<AnalyticsEventName, readonly string[]>();
for (const [event, keys] of ANALYTICS_EVENT_ENTRIES) {
  analyticsEventRegistry.set(event, keys);
}

export const ANALYTICS_EVENT_PROPERTIES: ReadonlyMap<AnalyticsEventName, readonly string[]> =
  analyticsEventRegistry;

/**
 * Structured-log fields that are safe to ship when log shipping is enabled:
 * identifiers, enums, counts, and durations. Deliberately absent — because
 * they carry prose, people, secrets, or business values — are `name`,
 * `email`, `error`, `message`, `reason`, `title`, `checks`, `endpoint`,
 * `componentStack`, `revenue`, and `configuredValue`.
 */
const LOG_FIELDS = [
  'time',
  'level',
  'msg',
  'component',
  'operation',
  'requestId',
  'traceId',
  'spanId',
  'parentSpanId',
  'durationMs',
  'route',
  'providerId',
  'status',
  'severity',
  'kind',
  'alertKey',
  'suppressed',
  'failureKind',
  'environment',
  'sampleRate',
  'role',
  'channels',
  'notificationId',
  'opportunityId',
  'partnerId',
  'partnerManagerId',
  'userId',
  'envelopes',
  'activities',
  'certifications',
  'opportunities',
  'partners',
  'partnerManagers',
  'registrations',
  'targets',
  'teamUsers',
] as const;

const METRIC_FIELDS = [
  'kind',
  'name',
  'attributes',
  'delta',
  'count',
  'totalMs',
  'minMs',
  'maxMs',
] as const;
const METRIC_ATTRIBUTE_KEYS = [
  'method',
  'status',
  'providerId',
  'category',
  'fingerprint',
  'severity',
] as const;

const TRACE_FIELDS = [
  'name',
  'traceId',
  'spanId',
  'parentSpanId',
  'traceFlags',
  'status',
  'startedAt',
  'endedAt',
  'durationMs',
  'attributes',
] as const;
const TRACE_ATTRIBUTE_KEYS = ['providerId', 'method', 'operation', 'status'] as const;

/**
 * Errors ship as a stable classification, never as the thrown prose: class
 * name, grouping fingerprint, operation category, severity, and where the
 * session was. The message, stack, cause, breadcrumbs, and user agent stay
 * in the browser for the local error insights.
 */
const ERROR_FIELDS = [
  'name',
  'fingerprint',
  'category',
  'severity',
  'route',
  'providerId',
] as const;

/**
 * Alerts ship keyed and counted; the human-readable title and summary stay
 * local with the in-app handlers, because alert prose can interpolate
 * runtime detail. `detail` is allowlisted one level down.
 */
const ALERT_FIELDS = [
  'id',
  'key',
  'severity',
  'suppressed',
  'timestamp',
  'release',
  'environment',
  'sessionId',
  'detail',
] as const;
const ALERT_DETAIL_FIELDS = [
  'fingerprint',
  'category',
  'route',
  'providerId',
  'sessionCount',
  'status',
  'failureKind',
  'checks',
] as const;

const HEALTH_FIELDS = [
  'status',
  'service',
  'release',
  'environment',
  'sessionId',
  'route',
  'providerId',
  'generatedAt',
  'uptimeMs',
  'checks',
] as const;
/** Check detail strings can embed local failure text; they never ship. */
const HEALTH_CHECK_FIELDS = ['name', 'status', 'latencyMs'] as const;

function isTechnicalPrimitive(value: unknown): value is string | number | boolean {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  // NaN and Infinity are not JSON values; a duration or count that produced
  // one is a bug to fix, not a value to ship.
  return typeof value === 'number' && Number.isFinite(value);
}

function technicalValue(value: unknown): unknown {
  if (isTechnicalPrimitive(value)) return value;
  if (Array.isArray(value)) {
    return value.filter(isTechnicalPrimitive);
  }
  return undefined;
}

/** Copies only the allowlisted primitive (or primitive-array) fields. */
function pickFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in record)) continue;
    const value = technicalValue(record[key]);
    if (value !== undefined) picked[key] = value;
  }
  return picked;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pickAttributes(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  return isRecord(value) ? pickFields(value, allowed) : {};
}

function pickChecks(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((check) => pickFields(check, HEALTH_CHECK_FIELDS));
}

/**
 * The one place analytics properties are filtered, shared by the transport
 * boundary and the facade's analytics bridge, so neither path can carry an
 * unregistered property out of the browser.
 */
export function allowlistEventProperties(
  event: string,
  properties: Record<string, unknown>,
): Record<string, unknown> | null {
  const allowed = ANALYTICS_EVENT_PROPERTIES.get(event as AnalyticsEventName);
  if (!allowed) return null;
  return pickFields(properties, allowed);
}

/**
 * Filters one envelope's payload to its registered fields. Returns null when
 * the envelope must not ship at all (an unregistered analytics event);
 * unknown fields otherwise drop out of the returned copy.
 */
export function allowlistEnvelope(
  type: TelemetryEnvelopeType,
  data: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (type) {
    case 'log':
      return pickFields(data, LOG_FIELDS);
    case 'metric': {
      const picked = pickFields(data, METRIC_FIELDS);
      if ('attributes' in data) {
        picked.attributes = pickAttributes(data.attributes, METRIC_ATTRIBUTE_KEYS);
      }
      return picked;
    }
    case 'trace': {
      const picked = pickFields(data, TRACE_FIELDS);
      if ('attributes' in data) {
        picked.attributes = pickAttributes(data.attributes, TRACE_ATTRIBUTE_KEYS);
      }
      return picked;
    }
    case 'event': {
      const event = data.event;
      if (typeof event !== 'string') return null;
      const properties = allowlistEventProperties(
        event,
        isRecord(data.properties) ? data.properties : {},
      );
      return properties === null ? null : { event, properties };
    }
    case 'error':
      return pickFields(data, ERROR_FIELDS);
    case 'alert': {
      const picked = pickFields(data, ALERT_FIELDS);
      if (isRecord(data.detail)) {
        const detail = pickFields(data.detail, ALERT_DETAIL_FIELDS);
        if (Array.isArray(data.detail.checks)) detail.checks = pickChecks(data.detail.checks);
        picked.detail = detail;
      }
      return picked;
    }
    case 'health': {
      const picked = pickFields(data, HEALTH_FIELDS);
      if (Array.isArray(data.checks)) picked.checks = pickChecks(data.checks);
      return picked;
    }
    default:
      return null;
  }
}
