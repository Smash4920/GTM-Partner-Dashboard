import { useMemo, useState } from 'react';
import ActivityTracker from '../components/ActivityTracker';
import AddPartnerForm from '../components/AddPartnerForm';
import Card from '../components/Card';
import MeetingLogModal from '../components/MeetingLogModal';
import ProgressBar from '../components/ProgressBar';
import {
  MEETING_TYPES,
  MEETING_TYPE_META,
  SNAPSHOT_DATE,
  WEEKLY_MEETING_GOAL,
  WEEKLY_PIO_GOAL,
} from '../data/constants';
import type { DashboardData, MeetingClassification } from '../data/types';
import { formatDate } from '../lib/format';
import { startOfWeekUtc } from '../lib/fiscal';
import { currentWeekMeetings, weeklyActivity, weeklyGoalProgress } from '../lib/metrics';

const ADD_PARTNER = '__add_partner__';

interface ActivityTrackingViewProps {
  data: DashboardData;
  classifications: Record<string, MeetingClassification>;
  onCommitClassifications: (next: Record<string, MeetingClassification>) => void;
  /** Adds a prospect partner to the given manager's book; returns its id. */
  onAddPartner: (name: string, partnerManagerId: string) => string;
}

/**
 * Activity Tracking: progress to the weekly goal (10 meetings, 3 PIO
 * interlocks) per partner manager and partner. "Log Meetings" opens the
 * weekly calendar so managers classify every call; submitting feeds the bars.
 */
export default function ActivityTrackingView({
  data,
  classifications,
  onCommitClassifications,
  onAddPartner,
}: ActivityTrackingViewProps) {
  const [managerId, setManagerId] = useState(() => data.partnerManagers[0]?.id ?? '');
  const [partnerFilter, setPartnerFilter] = useState('all');
  const [addingPartner, setAddingPartner] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, MeetingClassification>>({});

  const manager = data.partnerManagers.find((candidate) => candidate.id === managerId);
  const managerPartners = useMemo(
    () => data.partners.filter((partner) => partner.partnerManagerId === managerId),
    [data.partners, managerId],
  );

  const partnerIds = useMemo(
    () => (partnerFilter === 'all' ? new Set(managerPartners.map((p) => p.id)) : new Set([partnerFilter])),
    [managerPartners, partnerFilter],
  );

  // The weekly goal belongs to the manager, not to one partner: it always
  // aggregates every call across their assigned partners, so narrowing the
  // Partner dropdown re-scopes the charts below but never shrinks the goal.
  const goal = useMemo(
    () => weeklyGoalProgress(data.activities, classifications, managerId),
    [data.activities, classifications, managerId],
  );

  // The by-type split sits inside the goal card, so it follows the same
  // manager-wide scope rather than the partner filter.
  const goalWeekByType = useMemo(
    () => weeklyActivity(data.activities, managerId, undefined, classifications),
    [data.activities, managerId, classifications],
  );

  const weekStart = useMemo(() => startOfWeekUtc(SNAPSHOT_DATE), []);
  const weekLabel = useMemo(() => {
    const end = new Date(weekStart.getTime() + 6 * 86_400_000);
    return `${formatDate(weekStart.toISOString())} – ${formatDate(end.toISOString())}`;
  }, [weekStart]);

  const weekMeetings = useMemo(
    () => currentWeekMeetings(data.activities, managerId),
    [data.activities, managerId],
  );

  const activityRows = useMemo(
    () => weeklyActivity(data.activities, managerId, partnerIds, classifications),
    [data.activities, managerId, partnerIds, classifications],
  );

  // weeklyActivity returns eight weeks oldest-first, so the current week is
  // the last row — the only one the goal card reports.
  const meetingsByType = useMemo(
    () => goalWeekByType[goalWeekByType.length - 1].byType,
    [goalWeekByType],
  );

  const openCalendar = () => {
    setDraft({ ...classifications });
    setModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            {manager?.name ?? 'Partner manager'}
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
                value={managerId}
                onChange={(event) => {
                  setManagerId(event.target.value);
                  setPartnerFilter('all');
                  setAddingPartner(false);
                }}
                className="rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none"
              >
                {data.partnerManagers.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            </label>
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
                className="max-w-[240px] rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none"
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
          </div>

          {addingPartner ? (
            <div className="w-full max-w-xs">
              <AddPartnerForm
                partnerManagerName={manager?.name ?? 'this manager'}
                onAdd={(name) => {
                  const partnerId = onAddPartner(name, managerId);
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
              className="rounded-card border border-ash bg-carbon px-4 py-2.5 font-mono text-[11px] uppercase tracking-[0.08em] text-bone transition-colors hover:border-stone"
            >
              Log Meetings
            </button>
          )}
        </div>
      </div>

      <Card
        title="Progress to weekly goal"
        subtitle={`This week ${weekLabel} · ${manager?.name ?? ''}`}
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
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
              Classified in Log Meetings. {MEETING_TYPE_META['pio-interlock'].fullLabel}. The
              goal resets every Monday.
            </p>
          </div>
          <div>
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
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
              {goal.meetings} total this week
            </p>
          </div>
        </div>
      </Card>

      <Card
        title="Weekly meeting volume"
        subtitle="Current and previous seven weeks for this scope"
        action={
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            {activityRows.reduce((sum, row) => sum + row.total, 0)} meetings in scope
          </span>
        }
      >
        <ActivityTracker rows={activityRows} />
      </Card>

      {modalOpen && manager && (
        <MeetingLogModal
          managerName={manager.name}
          meetings={weekMeetings}
          roster={managerPartners}
          classifications={draft}
          onChange={(meetingId, classification) =>
            setDraft((prev) => ({ ...prev, [meetingId]: classification }))
          }
          onAddPartner={(name) => onAddPartner(name, managerId)}
          onClose={() => setModalOpen(false)}
          onSubmit={() => onCommitClassifications(draft)}
        />
      )}

      <p className="text-xs text-granite">
        Mock Google Calendar import · next step is a real connector. Adding a prospect partner
        creates a {formatDate(SNAPSHOT_DATE.toISOString())} registered account under{' '}
        {manager?.name ?? 'the selected manager'}.
      </p>
    </div>
  );
}
