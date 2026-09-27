import {
  REGISTRATION_SLA_BUSINESS_DAYS,
  REGISTRATION_SLA_WARNING_BUSINESS_DAYS,
} from '../data/constants';
import type { DashboardNotification, TeamUser } from '../data/types';
import { formatDate, formatTime } from '../lib/format';
import type { RegistrationSlaAlert } from '../lib/metrics';
import { SendIcon } from './icons';

/**
 * The rule the notification service runs, the registrations it fires on right
 * now, and what has actually been sent this session.
 *
 * The queue is derived, not stored: every pending registration is measured
 * against the response SLA at the snapshot, and the ones inside the warning
 * window or past the deadline surface with the owner they route to. Sending is
 * what writes a record — and in the demo that record lives only for the
 * session, which is exactly the gap the persistence roadmap item names.
 */

interface SlaAlertPanelProps {
  alerts: RegistrationSlaAlert[];
  users: TeamUser[];
  notifications: DashboardNotification[];
  onNotify: (alert: RegistrationSlaAlert) => void;
  onNotifyAll: () => void;
}

const QUEUE_LIMIT = 8;
const LOG_LIMIT = 5;

export default function SlaAlertPanel({
  alerts,
  users,
  notifications,
  onNotify,
  onNotifyAll,
}: SlaAlertPanelProps) {
  const approaching = alerts.filter((alert) => alert.state === 'approaching');
  const breached = alerts.filter((alert) => alert.state === 'breached');
  const notifyable = alerts.filter((alert) => alert.owner);
  const userName = (id: string) => users.find((user) => user.id === id)?.name ?? id;
  const shown = alerts.slice(0, QUEUE_LIMIT);

  return (
    <div className="space-y-5">
      <div className="rounded border border-ash/60 bg-carbon/40 p-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
          Rule · deal registrations
        </p>
        <p className="mt-2 max-w-3xl text-sm text-stone">
          Warn the owner {REGISTRATION_SLA_WARNING_BUSINESS_DAYS} business day (24 hours) before the{' '}
          {REGISTRATION_SLA_BUSINESS_DAYS}-business-day response SLA lapses, then again once it has.
          The owner is the partner&apos;s aligned partner manager; the deal desk catches anything
          unaligned, so a registration never goes unowned.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.06em]">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" />
            <span className="text-signal">{approaching.length} at 24 hours</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-graphite" />
            <span className="text-granite">{breached.length} past the SLA</span>
          </span>
          <span className="text-granite">{notifyable.length} with a resolvable owner</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Alert queue · 24-hour warnings first, then most overdue
        </p>
        <button
          type="button"
          onClick={onNotifyAll}
          disabled={notifyable.length === 0}
          className="flex items-center gap-1.5 rounded border border-ash px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone transition-colors hover:bg-ash/30 disabled:opacity-40"
        >
          <SendIcon className="h-3.5 w-3.5" />
          Notify all {notifyable.length} owners
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-carbon">
              <th className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Registration
              </th>
              <th className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Owner
              </th>
              <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Submitted
              </th>
              <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Due
              </th>
              <th className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Clock
              </th>
              <th className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((alert) => (
              <tr key={alert.registration.id} className="border-b border-carbon last:border-0">
                <td className="py-2.5 pr-3">
                  <p className="text-bone">{alert.registration.accountName}</p>
                  <p className="font-mono text-[10px] text-granite">
                    {alert.partner?.name ?? alert.registration.partnerId}
                  </p>
                </td>
                <td className="py-2.5 pr-3">
                  {alert.owner ? (
                    <p className="text-stone">{alert.owner.name}</p>
                  ) : (
                    <p className="text-signal">No owner — add one</p>
                  )}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-xs tabular-nums text-granite">
                  {formatDate(alert.registration.submittedAt)}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-xs tabular-nums text-granite">
                  {formatDate(alert.dueAt)}
                </td>
                <td className="py-2.5 pr-3 text-right font-mono text-xs tabular-nums">
                  {alert.state === 'approaching' ? (
                    <span className="text-signal">24h to SLA</span>
                  ) : (
                    <span className="text-signal">
                      {alert.businessDaysWaiting - REGISTRATION_SLA_BUSINESS_DAYS}d past
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => onNotify(alert)}
                    disabled={!alert.owner}
                    className="rounded border border-ash/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/30 hover:text-bone disabled:opacity-40"
                  >
                    Notify owner
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-granite">
                  Nothing near the SLA — the queue is clear.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {alerts.length > shown.length && (
        <p className="text-xs text-granite">
          Showing the {shown.length} most urgent of {alerts.length} registrations flagged against
          the SLA.
        </p>
      )}

      <div className="border-t border-carbon pt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Sent this session · {notifications.length}
        </p>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-granite">
            Nothing sent yet. Pick a teammate in the notification node above, or send an alert.
          </p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {notifications.slice(0, LOG_LIMIT).map((notification) => (
              <li key={notification.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-[10px] tabular-nums text-granite">
                  {formatTime(notification.sentAt)}
                </span>
                <span className="text-sm text-bone">{userName(notification.userId)}</span>
                <span className="text-sm text-stone">{notification.subject}</span>
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-metric">
                  {notification.channels.join(' + ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
