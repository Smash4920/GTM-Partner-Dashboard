import type { ActivityMeeting } from '../types';
import type { NormalizationIssue, NormalizationResult } from './types';
import {
  asRecord,
  issue,
  malformedRecord,
  readCount,
  readEnum,
  readForeignKey,
  readIdentifier,
  readIsoTimestamp,
} from './validate';

/**
 * Calendar adapter: the representative event export a calendar sync would
 * deliver for partner-facing meetings, normalized to canonical activity
 * meetings. Every event must name its partner and the partner manager who
 * owns it — a meeting with neither is noise the dashboard does not model.
 *
 * All-day calendar events have no intrinsic instant; the adapter pins them
 * to UTC noon on their date rather than to "now" or to midnight-local, so
 * the same event normalizes to the same activity wherever and whenever the
 * adapter runs.
 */

export interface CalendarEventSource {
  event_id: string;
  category:
    | 'Discovery Call'
    | 'PIO Interlock'
    | 'PAO Interlock'
    | 'Interlock Cadence'
    | 'Deal Support'
    | 'Technical Enablement'
    | 'GTM Enablement'
    | 'Partner Cadence';
  partner_slug: string;
  partner_manager_id: string;
  start_at: string | null;
  all_day_date: string | null;
  duration_minutes: number;
}

export interface CalendarContext {
  knownPartnerIds: ReadonlySet<string>;
  knownPartnerManagerIds: ReadonlySet<string>;
}

const EVENT_CATEGORY: Record<string, ActivityMeeting['type']> = {
  'Discovery Call': 'discovery',
  'PIO Interlock': 'pio-interlock',
  'PAO Interlock': 'pao-interlock',
  'Interlock Cadence': 'interlock-cadence',
  'Deal Support': 'deal-support',
  'Technical Enablement': 'technical-enablement',
  'GTM Enablement': 'gtm-enablement',
  'Partner Cadence': 'partner-cadence',
};

/** An all-day date pinned to a stable instant: noon UTC on that day. */
function allDayDateToTimestamp(
  date: string,
  issues: NormalizationIssue[],
  path: string,
): string | undefined {
  return readIsoTimestamp({ value: `${date}T12:00:00Z` }, 'value', issues, path);
}

export function normalizeCalendarEvent(
  input: unknown,
  context: CalendarContext,
): NormalizationResult<ActivityMeeting> {
  const issues: NormalizationIssue[] = [];
  const source = asRecord(input);
  if (source === null) {
    issues.push(malformedRecord('$', 'a calendar event object'));
    return { ok: false, issues };
  }
  const id = readIdentifier(source, 'event_id', issues);
  const type = readEnum(source, 'category', EVENT_CATEGORY, issues);
  const partnerId = readForeignKey(
    source,
    'partner_slug',
    context.knownPartnerIds,
    issues,
    'partner_slug',
  );
  const partnerManagerId = readForeignKey(
    source,
    'partner_manager_id',
    context.knownPartnerManagerIds,
    issues,
    'partner_manager_id',
  );
  const durationMinutes = readCount(source, 'duration_minutes', issues);
  const startAt = source['start_at'];
  const allDayDate = source['all_day_date'];
  let occurredAt: string | undefined;
  if (typeof startAt === 'string' && startAt !== '') {
    occurredAt = readIsoTimestamp(source, 'start_at', issues);
  } else if (typeof allDayDate === 'string' && allDayDate !== '') {
    occurredAt = allDayDateToTimestamp(allDayDate, issues, 'all_day_date');
  } else {
    issue(issues, 'missing-field', 'start_at', 'expected a start timestamp or an all-day date');
  }
  if (
    id === undefined ||
    type === undefined ||
    partnerId === undefined ||
    partnerManagerId === undefined ||
    durationMinutes === undefined ||
    occurredAt === undefined
  ) {
    return { ok: false, issues };
  }
  const record: ActivityMeeting = {
    id,
    partnerId,
    partnerManagerId,
    type,
    occurredAt,
    durationMinutes,
  };
  // `all_day_date` is the alternate of `start_at`; whichever the event
  // consumed is the one the provenance names.
  const dateField = typeof startAt === 'string' && startAt !== '' ? 'start_at' : 'all_day_date';
  const fields = [
    'category',
    'duration_minutes',
    'event_id',
    'partner_manager_id',
    'partner_slug',
    dateField,
  ];
  fields.sort();
  return {
    ok: true,
    record,
    provenance: { source: 'calendar', sourceRecordId: id, fields },
  };
}
