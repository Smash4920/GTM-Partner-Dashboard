import { useMemo, useRef, useState } from 'react';
import { MEETING_TYPES, MEETING_TYPE_META, SNAPSHOT_DATE } from '../data/constants';
import type { ActivityMeeting, MeetingClassification, MeetingType, Partner } from '../data/types';
import { formatTime } from '../lib/format';
import { startOfWeekUtc } from '../lib/fiscal';
import AddPartnerForm from './AddPartnerForm';
import { XIcon } from './icons';
import { useRetryRecovery } from './QueryState';
import PageFooter from './PageFooter';
import Modal from './Modal';

const ADD_PARTNER = '__add_partner__';

/**
 * The cursor-paginated calendar the modal classifies: how to retry a failed
 * first page and how to walk forward when the week is longer than the page
 * size. Absent when the caller already holds the full week.
 */
interface MeetingCalendar {
  totalCount?: number;
  loading: boolean;
  error: string | null;
  retry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}

interface MeetingLogModalProps {
  managerName: string;
  /** The manager's current-week calendar, as loaded so far. */
  meetings: ActivityMeeting[];
  /** Partners assigned to this manager, including newly added prospects. */
  roster: Partner[];
  classifications: Record<string, MeetingClassification>;
  onChange: (meetingId: string, classification: MeetingClassification) => void;
  /** Adds a prospect partner to this manager's book and returns its id. */
  onAddPartner: (name: string) => string;
  /** True when the draft holds classifications that have not been submitted. */
  dirty: boolean;
  /** Paging surface for the meetings list; omit to render what was passed. */
  calendar?: MeetingCalendar;
  onClose: () => void;
  onSubmit: () => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function classificationFor(
  meeting: ActivityMeeting,
  classifications: Record<string, MeetingClassification>,
): MeetingClassification {
  return classifications[meeting.id] ?? { partnerId: meeting.partnerId, type: meeting.type };
}

/**
 * Weekly calendar for classifying one partner manager's meetings: every call
 * gets a Partner and a Call Type. Submitting feeds the weekly-goal progress
 * bars on the Activity Tracking page.
 */
export default function MeetingLogModal({
  managerName,
  meetings,
  roster,
  classifications,
  onChange,
  onAddPartner,
  dirty,
  calendar,
  onClose,
  onSubmit,
}: MeetingLogModalProps) {
  const [addingPartnerFor, setAddingPartnerFor] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const draftFocus = useRef<HTMLElement | null>(null);

  // A failed calendar page keeps the meetings already loaded — and the draft
  // classifying them — mounted; the failure is named next to them with a
  // retry that repeats only the failed request. The retry unmounts with the
  // failure UI it lives in — and the page request clears the error the
  // moment it starts, so the failure UI goes away before the answer arrives.
  // The recovery region therefore wraps every calendar state (failure,
  // reloading, rows) and never unmounts between them: it claims the orphaned
  // focus whenever the failure clears, and hands it to a stable target
  // inside the dialog.
  const calendarFailed = calendar !== undefined && calendar.error !== null;
  const calendarRecovery = useRetryRecovery('meeting calendar', calendarFailed);

  // Closing with unsubmitted classifications asks first. A backdrop click is
  // easy to do by accident, and the draft is a manager's whole week of work.
  const requestClose = (draftControl?: HTMLElement) => {
    if (confirmingDiscard) setConfirmingDiscard(false);
    else if (dirty) {
      draftFocus.current = draftControl ?? (document.activeElement as HTMLElement);
      setConfirmingDiscard(true);
    } else onClose();
  };

  const weekStart = useMemo(() => startOfWeekUtc(SNAPSHOT_DATE), []);
  const weekLabel = useMemo(() => {
    const start = weekStart;
    const end = new Date(start.getTime() + 4 * 86_400_000);
    const startText = start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const endText = end.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    return `${startText} – ${endText}`;
  }, [weekStart]);

  const byDay = useMemo(() => {
    const columns: ActivityMeeting[][] = Array.from({ length: 5 }, () => []);
    for (const meeting of meetings) {
      const dayIndex = Math.floor(
        (new Date(meeting.occurredAt).getTime() - weekStart.getTime()) / 86_400_000,
      );
      if (dayIndex >= 0 && dayIndex < 5) columns[dayIndex].push(meeting);
    }
    return columns;
  }, [meetings, weekStart]);

  const partnerName = (partnerId: string) =>
    roster.find((partner) => partner.id === partnerId)?.name ?? 'Unknown partner';

  return (
    <Modal
      title={
        confirmingDiscard ? 'Discard unsubmitted classifications?' : `Log meetings · ${managerName}`
      }
      wide
      onDismiss={requestClose}
      returnFocus={confirmingDiscard ? null : draftFocus.current}
    >
      {confirmingDiscard && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setConfirmingDiscard(false)}
            className="rounded border border-ash px-3 py-2 text-sm"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-signal px-3 py-2 text-sm text-signal"
          >
            Discard
          </button>
        </div>
      )}
      <div hidden={confirmingDiscard}>
        <div className="flex items-start justify-between gap-4 border-b border-carbon px-5 py-4">
          <div>
            <p className="mt-1 text-xs text-granite">
              {weekLabel} · weekly view of the manager's calendar. Pick a partner and call type per
              meeting, then submit — classifications feed the weekly goal.
            </p>
          </div>
          <button
            type="button"
            onClick={() => requestClose()}
            aria-label="Close Log meetings"
            className="rounded p-1.5 text-granite transition-colors hover:text-bone"
          >
            <XIcon />
          </button>
        </div>

        {/* One recovery region wraps every calendar state — failure, reload,
            and rows — so a retried failure always has its stable focus
            target, however many renders the recovery takes. */}
        <div ref={calendarRecovery.regionRef} {...calendarRecovery.regionProps}>
          {calendar && meetings.length === 0 && calendar.error !== null ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-signal">{calendar.error}</p>
              <button
                type="button"
                onClick={calendarRecovery.armRetry(calendar.retry)}
                aria-label="Retry meeting calendar"
                className="mt-3 rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20"
              >
                Retry
              </button>
            </div>
          ) : calendar?.loading && meetings.length === 0 ? (
            <p className="px-5 py-10 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-granite">
              Loading meetings…
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 py-4 sm:grid-cols-5">
              {byDay.map((dayMeetings, dayIndex) => (
                <div key={dayIndex} className="min-w-0">
                  <p className="border-b border-carbon pb-2 text-center font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                    {DAY_LABELS[dayIndex]}
                  </p>
                  <div className="mt-2 space-y-2">
                    {dayMeetings.map((meeting) => {
                      const classification = classificationFor(meeting, classifications);
                      const end = new Date(
                        new Date(meeting.occurredAt).getTime() + meeting.durationMinutes * 60_000,
                      );
                      return (
                        <div
                          key={meeting.id}
                          className="rounded border border-l-2 border-carbon bg-carbon/60 p-2"
                          style={{ borderLeftColor: MEETING_TYPE_META[classification.type].color }}
                        >
                          <p className="font-mono text-[10px] tabular-nums text-granite">
                            {formatTime(meeting.occurredAt)}–{formatTime(end.toISOString())}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-stone">
                            {partnerName(classification.partnerId)}
                          </p>
                          <div className="mt-1.5 space-y-1.5">
                            {addingPartnerFor === meeting.id ? (
                              <AddPartnerForm
                                partnerManagerName={managerName}
                                onAdd={(name) => {
                                  const partnerId = onAddPartner(name);
                                  onChange(meeting.id, { ...classification, partnerId });
                                  setAddingPartnerFor(null);
                                }}
                                onCancel={() => setAddingPartnerFor(null)}
                              />
                            ) : null}
                            <div hidden={addingPartnerFor === meeting.id}>
                              <select
                                value={classification.partnerId}
                                onChange={(event) => {
                                  if (event.target.value === ADD_PARTNER) {
                                    setAddingPartnerFor(meeting.id);
                                    return;
                                  }
                                  onChange(meeting.id, {
                                    ...classification,
                                    partnerId: event.target.value,
                                  });
                                }}
                                aria-label={`Partner for ${formatTime(meeting.occurredAt)} meeting`}
                                className="w-full rounded border border-ash bg-canvas px-1.5 py-1 text-xs text-bone focus:border-signal focus:outline-none"
                              >
                                {roster
                                  .slice()
                                  .sort((a, b) => a.name.localeCompare(b.name))
                                  .map((partner) => (
                                    <option key={partner.id} value={partner.id}>
                                      {partner.name}
                                    </option>
                                  ))}
                                <option value={ADD_PARTNER}>＋ Add partner…</option>
                              </select>
                              <select
                                value={classification.type}
                                onChange={(event) =>
                                  onChange(meeting.id, {
                                    ...classification,
                                    type: event.target.value as MeetingType,
                                  })
                                }
                                aria-label={`Call type for ${formatTime(meeting.occurredAt)} meeting`}
                                className="w-full rounded border border-ash bg-canvas px-1.5 py-1 text-xs text-bone focus:border-signal focus:outline-none"
                              >
                                {MEETING_TYPES.map((type) => (
                                  <option key={type} value={type}>
                                    {MEETING_TYPE_META[type].label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {dayMeetings.length === 0 && (
                      <p className="pt-6 text-center font-mono text-[10px] uppercase tracking-[0.05em] text-graphite">
                        —
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {calendar !== undefined && meetings.length > 0 && (
            <div className="border-t border-carbon px-5 py-3">
              <PageFooter
                state={{
                  ...calendar,
                  rows: meetings,
                  totalCount: calendar.totalCount ?? meetings.length,
                  meta: null,
                  refreshing: false,
                }}
                noun="meeting calendar"
                pageSize={25}
                buttonLabel="Load more meetings"
              />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-carbon px-5 py-4">
          <button
            type="button"
            onClick={() => requestClose()}
            className="rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-granite transition-colors hover:text-stone"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onSubmit();
              onClose();
            }}
            className="rounded bg-bone px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-canvas transition-opacity hover:opacity-90"
          >
            Submit classifications
          </button>
        </div>
      </div>
    </Modal>
  );
}
