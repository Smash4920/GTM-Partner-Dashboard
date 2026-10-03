import { useMemo, useState } from 'react';
import ActivityTracker from '../components/ActivityTracker';
import AddPartnerForm from '../components/AddPartnerForm';
import Card from '../components/Card';
import MeetingLogModal from '../components/MeetingLogModal';
import ProgressBar from '../components/ProgressBar';
import { renderQueryState } from '../components/QueryState';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import {
  MEETING_TYPES,
  MEETING_TYPE_META,
  SNAPSHOT_DATE,
  WEEKLY_MEETING_GOAL,
  WEEKLY_PIO_GOAL,
} from '../data/constants';
import type { DataProvider } from '../data/DataProvider';
import type { MeetingClassification, Partner } from '../data/types';
import { useActivityQueries } from '../data/useActivityQueries';
import { formatDate } from '../lib/format';
import { startOfWeekUtc } from '../lib/fiscal';

const ADD_PARTNER = '__add_partner__';

interface ActivityTrackingViewProps {
  provider: DataProvider;
  classifications: Record<string, MeetingClassification>;
  onCommitClassifications: (next: Record<string, MeetingClassification>) => void;
  /** Adds a prospect partner to the given manager's book; returns its id. */
  onAddPartner: (name: string, partnerManagerId: string) => string;
  prospects: Partner[];
}

/**
 * Activity Tracking: progress to the weekly goal (10 meetings, 3 PIO
 * interlocks) per partner manager and partner. "Log Meetings" opens the
 * weekly calendar so managers classify every call; submitting feeds the bars.
 *
 * The route reads the scoped contract: the goal, the by-type split, and the
 * volume chart are manager- and partner-scoped aggregates, and the Log
 * Meetings calendar is a cursor-paginated week of raw calls. Every card
 * carries its own loading, error, retry, and metadata state rather than a
 * share of a whole-book load.
 */
export default function ActivityTrackingView({
  provider,
  classifications,
  onCommitClassifications,
  onAddPartner,
  prospects,
}: ActivityTrackingViewProps) {
  // '' means "follow the directory's first manager"; the hook reports back
  // the manager the aggregates actually describe.
  const [managerId, setManagerId] = useState('');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [addingPartner, setAddingPartner] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, MeetingClassification>>({});

  const queries = useActivityQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    managerId,
    partnerId: partnerFilter,
    classifications,
    prospects,
  });

  const directoryManagers = queries.managers.data ?? [];
  const manager = directoryManagers.find((candidate) => candidate.id === queries.managerId);
  // When the directory cannot answer, the manager is a bare id — show it
  // rather than pretending the selection vanished.
  const managerLabel =
    manager?.name ?? (queries.managerId !== '' ? queries.managerId : 'Partner manager');
  const managerPartners = useMemo(
    () => (queries.roster.data ?? []).filter((p) => p.partnerManagerId === queries.managerId),
    [queries.roster.data, queries.managerId],
  );

  const weekStart = useMemo(() => startOfWeekUtc(SNAPSHOT_DATE), []);
  const weekLabel = useMemo(() => {
    const end = new Date(weekStart.getTime() + 6 * 86_400_000);
    return `${formatDate(weekStart.toISOString())} – ${formatDate(end.toISOString())}`;
  }, [weekStart]);

  const seriesTotal = useMemo(
    () => queries.series.data?.reduce((sum, row) => sum + row.total, 0) ?? null,
    [queries.series.data],
  );

  // Whether the draft still differs from what has been submitted, which is
  // what decides if closing the modal would throw work away. Recording an
  // explicit classification that happens to match the calendar's own default
  // counts as a change: the record now says a manager confirmed it, and
  // erring toward keeping the draft is the cheaper mistake.
  const draftDirty = useMemo(() => {
    const ids = new Set([...Object.keys(draft), ...Object.keys(classifications)]);
    for (const id of ids) {
      const drafted = draft[id];
      const committed = classifications[id];
      if (drafted?.partnerId !== committed?.partnerId) return true;
      if (drafted?.type !== committed?.type) return true;
    }
    return false;
  }, [draft, classifications]);

  const openCalendar = () => {
    setDraft({ ...classifications });
    setModalOpen(true);
  };

  const directoryAvailable = queries.managers.data !== null;
  const rosterAvailable = queries.roster.data !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            {managerLabel}
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Activity Tracking</h1>
          <p className="mt-1 text-sm text-granite">
            Weekly goal: {WEEKLY_MEETING_GOAL} partner meetings · {WEEKLY_PIO_GOAL} PIO interlocks
          </p>
        </div>

        <div className="flex flex-wrap items-end justify-end gap-3">
          <div className="flex flex-col items-end gap-2">
            <label className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Partner manager
              </span>
              <select
                value={queries.managerId}
                onChange={(event) => {
                  setManagerId(event.target.value);
                  setPartnerFilter('all');
                  setAddingPartner(false);
                }}
                disabled={!directoryAvailable}
                className="rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none disabled:opacity-50"
              >
                {directoryManagers.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
                {!directoryAvailable && queries.managerId !== '' && (
                  <option value={queries.managerId}>{queries.managerId}</option>
                )}
              </select>
            </label>
            {queries.managers.error !== null && (
              <p className="text-right font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
                {queries.managers.error} ·{' '}
                <button
                  type="button"
                  onClick={queries.managers.retry}
                  className="underline underline-offset-2 hover:text-bone"
                >
                  Retry
                </button>
              </p>
            )}
            <label className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Partner
              </span>
              <select
                value={partnerFilter}
                onChange={(event) => {
                  if (event.target.value === ADD_PARTNER) {
                    setAddingPartner(true);
                    return;
                  }
                  setPartnerFilter(event.target.value);
                }}
                disabled={!rosterAvailable}
                className="max-w-[240px] rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none disabled:opacity-50"
              >
                <option value="all">All Partners ({managerPartners.length})</option>
                {managerPartners
                  .slice()
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
                <option value={ADD_PARTNER}>＋ Add partner…</option>
              </select>
            </label>
            {queries.roster.error !== null && (
              <p className="text-right font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
                {queries.roster.error} ·{' '}
                <button
                  type="button"
                  onClick={queries.roster.retry}
                  className="underline underline-offset-2 hover:text-bone"
                >
                  Retry
                </button>
              </p>
            )}
          </div>

          {addingPartner ? (
            <div className="w-full max-w-xs">
              <AddPartnerForm
                partnerManagerName={manager?.name ?? 'this manager'}
                onAdd={(name) => {
                  const partnerId = onAddPartner(name, queries.managerId);
                  setPartnerFilter(partnerId);
                  setAddingPartner(false);
                }}
                onCancel={() => setAddingPartner(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={openCalendar}
              disabled={!manager || !rosterAvailable}
              className="rounded-card border border-ash bg-carbon px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-bone transition-colors hover:border-stone disabled:opacity-50"
            >
              Log Meetings
            </button>
          )}
        </div>
      </div>

      <Card title="Progress to weekly goal" subtitle={`This week ${weekLabel} · ${managerLabel}`}>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {renderQueryState('weekly goal', queries.goal, (goal) => (
            <div className="space-y-4 md:col-span-2">
              <ProgressBar
                label="Partner meetings"
                value={goal.meetings}
                goal={goal.meetingsGoal}
                hint={`${Math.min(100, Math.round((goal.meetings / goal.meetingsGoal) * 100))}% of goal`}
              />
              <ProgressBar
                label="PIO interlocks"
                value={goal.pioMeetings}
                goal={goal.pioGoal}
                hint={`${Math.min(100, Math.round((goal.pioMeetings / goal.pioGoal) * 100))}% of goal`}
              />
              <p className="text-xs text-granite">
                Classified in Log Meetings. {MEETING_TYPE_META['pio-interlock'].fullLabel}. The goal
                resets every Monday.
              </p>
            </div>
          ))}
          <div>
            {renderQueryState('weekly meeting types', queries.goalWeek, (goalWeek) => {
              // weeklyActivity returns eight weeks oldest-first, so the
              // current week is the last row — the only one this card reports.
              const meetingsByType = goalWeek[goalWeek.length - 1].byType;
              return (
                <>
                  <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                    This week's meetings by type
                  </p>
                  <ul className="mt-3 space-y-1.5">
                    {MEETING_TYPES.map((type) => {
                      const count = meetingsByType[type];
                      if (count === 0) return null;
                      return (
                        <li key={type} className="flex items-center gap-2 text-xs text-stone">
                          <span
                            className="h-2 w-2 rounded-sm"
                            style={{ backgroundColor: MEETING_TYPE_META[type].color }}
                          />
                          <span className="flex-1 truncate">{MEETING_TYPE_META[type].label}</span>
                          <span className="font-mono tabular-nums text-granite">{count}</span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              );
            })}
            {queries.goal.data !== null && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
                {queries.goal.data.meetings} total this week
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card
        title="Weekly meeting volume"
        subtitle="Current and previous seven weeks for this scope"
        action={
          seriesTotal !== null ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              {seriesTotal} meetings in scope
            </span>
          ) : undefined
        }
      >
        {renderQueryState('weekly activity', queries.series, (rows) => (
          <ActivityTracker rows={rows} />
        ))}
      </Card>

      {modalOpen && manager && (
        <MeetingLogModal
          managerName={manager.name}
          meetings={queries.meetings.rows}
          roster={managerPartners}
          classifications={draft}
          onChange={(meetingId, classification) =>
            setDraft((prev) => ({ ...prev, [meetingId]: classification }))
          }
          onAddPartner={(name) => onAddPartner(name, queries.managerId)}
          dirty={draftDirty}
          calendar={{
            totalCount: queries.meetings.totalCount,
            loading: queries.meetings.loading,
            error: queries.meetings.error,
            retry: queries.meetings.retry,
            hasMore: queries.meetings.hasMore,
            loadingMore: queries.meetings.loadingMore,
            loadMore: queries.meetings.loadMore,
          }}
          onClose={() => setModalOpen(false)}
          onSubmit={() => onCommitClassifications(draft)}
        />
      )}

      <p className="text-xs text-granite">
        Meeting classifications and prospect partners are session edits: they move the goal
        immediately and reset on reload. Adding a prospect creates a{' '}
        {formatDate(SNAPSHOT_DATE.toISOString())} registered account under {managerLabel}.
      </p>
    </div>
  );
}
