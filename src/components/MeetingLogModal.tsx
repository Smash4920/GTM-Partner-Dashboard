import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MEETING_TYPES, MEETING_TYPE_META, SNAPSHOT_DATE } from '../data/constants';
import type { ActivityMeeting, MeetingClassification, MeetingType, Partner } from '../data/types';
import { formatTime } from '../lib/format';
import { startOfWeekUtc } from '../lib/fiscal';
import AddPartnerForm from './AddPartnerForm';
import { XIcon } from './icons';

const ADD_PARTNER = '__add_partner__';

interface MeetingLogModalProps {
  managerName: string;
  /** The manager's current-week calendar ("Google Calendar" import). */
  meetings: ActivityMeeting[];
  /** Partners assigned to this manager, including newly added prospects. */
  roster: Partner[];
  classifications: Record<string, MeetingClassification>;
  onChange: (meetingId: string, classification: MeetingClassification) => void;
  /** Adds a prospect partner to this manager's book and returns its id. */
  onAddPartner: (name: string) => string;
  /** True when the draft holds classifications that have not been submitted. */
  dirty: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

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
  onClose,
  onSubmit,
}: MeetingLogModalProps) {
  const [addingPartnerFor, setAddingPartnerFor] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Closing with unsubmitted classifications asks first. A backdrop click is
  // easy to do by accident, and the draft is a manager's whole week of work.
  const requestClose = useCallback(() => {
    if (dirty) setConfirmingDiscard(true);
    else onClose();
  }, [dirty, onClose]);

  // Move focus into the dialog on open and hand it back on close, so keyboard
  // users are not dropped at the top of the document.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Escape closes; Tab cycles within the dialog. `aria-modal` tells assistive
  // tech the background is inert but does nothing about real focus, so the
  // trap has to be implemented rather than declared.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [requestClose]);

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
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-canvas/80 p-4 pt-10 backdrop-blur-sm"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Log meetings"
        tabIndex={-1}
        className="w-full max-w-6xl rounded-card border border-ash bg-canvas focus:outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-carbon px-5 py-4">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.08em] text-bone">
              Log meetings · {managerName}
            </h2>
            <p className="mt-1 text-xs text-granite">
              {weekLabel} · weekly view of the manager's calendar. Pick a partner and call type per
              meeting, then submit — classifications feed the weekly goal.
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close Log meetings"
            className="rounded p-1.5 text-granite transition-colors hover:text-bone"
          >
            <XIcon />
          </button>
        </div>

        <div className="grid grid-cols-5 gap-2 px-5 py-4">
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
                        ) : (
                          <>
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
                          </>
                        )}
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

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-carbon px-5 py-4">
          {confirmingDiscard && (
            <div className="mr-auto flex flex-wrap items-center gap-3" role="alert">
              <p className="text-sm text-bone">Discard unsubmitted classifications?</p>
              <button
                type="button"
                onClick={() => setConfirmingDiscard(false)}
                className="rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:text-bone"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-signal px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-signal transition-opacity hover:opacity-80"
              >
                Discard
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={requestClose}
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
    </div>
  );
}
