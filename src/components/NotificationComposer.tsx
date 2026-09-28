import { NOTIFICATION_CHANNEL_META, TEAM_ROLE_META } from '../data/constants';
import type {
  DashboardNotification,
  DealRegistration,
  NotificationChannel,
  Partner,
  TeamUser,
} from '../data/types';
import { formatDate, formatTime } from '../lib/format';
import { NOTIFICATION_TEMPLATES, type NotificationTemplateId } from '../lib/notifications';
import type { RegistrationSlaAlert } from '../lib/metrics';
import { SendIcon } from './icons';

/** Everything the composer holds; the view owns it so alerts can pre-fill it. */
export interface ComposerState {
  userId: string | null;
  template: NotificationTemplateId;
  registrationId: string | null;
  subject: string;
  body: string;
}

interface NotificationComposerProps {
  users: TeamUser[];
  partners: Partner[];
  registrations: DealRegistration[];
  alerts: RegistrationSlaAlert[];
  state: ComposerState;
  onChange: (next: ComposerState) => void;
  onSend: () => void;
  /** The most recent send this session, shown as a delivery confirmation. */
  lastSent?: DashboardNotification;
  /** Builds the copy for a template/registration pair. */
  describe: (
    template: NotificationTemplateId,
    registrationId: string | null,
  ) => {
    subject: string;
    body: string;
  };
}

const selectClass =
  'w-full rounded border border-ash bg-canvas px-2 py-1.5 text-sm text-bone focus:border-signal focus:outline-none';
const labelClass = 'font-mono text-[10px] uppercase tracking-[0.06em] text-granite';

function RegistrationStatus({
  registration,
  alert,
  partner,
}: {
  registration?: DealRegistration;
  alert?: RegistrationSlaAlert;
  partner?: Partner;
}) {
  if (!registration) return null;

  if (alert) {
    return (
      <p className="text-[10px] leading-snug text-signal">
        On the SLA clock: {alert.state === 'approaching' ? 'last business day before' : 'past'} the
        5-business-day deadline (due {formatDate(alert.dueAt)}).
      </p>
    );
  }

  return (
    <p className="text-[10px] leading-snug text-metric">
      Inside the SLA — {partner?.name ?? registration.partnerId} still has time before the response
      is due.
    </p>
  );
}

/**
 * Send a notification to one named person, from inside the connection map:
 * picking a teammate in the notification node lands here, and the SLA queue
 * pre-fills it. The user's own authorized channels decide how it goes out.
 */
export default function NotificationComposer({
  users,
  partners,
  registrations,
  alerts,
  state,
  onChange,
  onSend,
  lastSent,
  describe,
}: NotificationComposerProps) {
  // Only an authorized user can be notified; a suspended or invited one cannot.
  const notifiableUsers = users.filter((user) => user.status === 'active');
  const user = notifiableUsers.find((candidate) => candidate.id === state.userId) ?? null;
  const template = NOTIFICATION_TEMPLATES.find((item) => item.id === state.template)!;
  const registration = registrations.find((item) => item.id === state.registrationId);
  const alert = alerts.find((item) => item.registration.id === state.registrationId);
  const partner = registration
    ? partners.find((candidate) => candidate.id === registration.partnerId)
    : undefined;
  const canSend = Boolean(user) && state.subject.trim().length > 0 && state.body.trim().length > 0;

  const setUser = (userId: string) => onChange({ ...state, userId });

  const setTemplate = (nextTemplate: NotificationTemplateId) => {
    const copy = describe(nextTemplate, state.registrationId);
    onChange({ ...state, template: nextTemplate, ...copy });
  };

  const setRegistration = (registrationId: string) => {
    const copy = state.template === 'custom' ? null : describe(state.template, registrationId);
    onChange({
      ...state,
      registrationId,
      ...(copy ?? {}),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>To</span>
          <select
            value={state.userId ?? ''}
            onChange={(event) => setUser(event.target.value)}
            className={`${selectClass} mt-1`}
          >
            <option value="" disabled>
              Pick a teammate
            </option>
            {notifiableUsers.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name} · {TEAM_ROLE_META[candidate.role].label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>Template</span>
          <select
            value={state.template}
            onChange={(event) => setTemplate(event.target.value as NotificationTemplateId)}
            className={`${selectClass} mt-1`}
            title={template.description}
          >
            {NOTIFICATION_TEMPLATES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className={labelClass}>Registration</span>
        <select
          value={state.registrationId ?? ''}
          onChange={(event) => setRegistration(event.target.value)}
          disabled={state.template === 'custom'}
          className={`${selectClass} mt-1 disabled:opacity-40`}
        >
          <option value="" disabled>
            Pick a registration
          </option>
          {registrations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.accountName} · {formatDate(item.submittedAt)}
            </option>
          ))}
        </select>
      </label>

      <RegistrationStatus registration={registration} alert={alert} partner={partner} />

      <label className="block">
        <span className={labelClass}>Subject</span>
        <input
          value={state.subject}
          onChange={(event) => onChange({ ...state, subject: event.target.value })}
          placeholder="What this is about"
          className={`${selectClass} mt-1`}
        />
      </label>

      <label className="block">
        <span className={labelClass}>Message</span>
        <textarea
          value={state.body}
          onChange={(event) => onChange({ ...state, body: event.target.value })}
          rows={5}
          placeholder="Pick a template or write the note"
          className={`${selectClass} mt-1 resize-y leading-relaxed`}
        />
      </label>

      <div>
        <span className={labelClass}>Channels</span>
        <div className="mt-1 flex flex-wrap gap-2">
          {user ? (
            user.channels.map((channel: NotificationChannel) => (
              <span
                key={channel}
                title={NOTIFICATION_CHANNEL_META[channel].description}
                className="rounded border border-ash bg-ash/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone"
              >
                {NOTIFICATION_CHANNEL_META[channel].label}
              </span>
            ))
          ) : (
            <span className="text-[10px] text-granite">
              Pick a teammate to see the channels they are authorized on.
            </span>
          )}
        </div>
        <p className="mt-1 text-[10px] text-granite">
          Only authorized channels are used; email always is. Delivery is simulated in the demo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-carbon pt-3">
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          className="flex items-center gap-1.5 rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone transition-colors hover:bg-ash/30 disabled:opacity-40"
        >
          <SendIcon className="h-3.5 w-3.5" />
          Send to {user ? user.name : 'a teammate'}
        </button>
        {!user && (
          <span className="text-xs text-granite">
            {users.length === 0
              ? 'Add someone to the roster first.'
              : 'Only an authorized user can be notified.'}
          </span>
        )}
        {lastSent && (
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-metric">
            Delivered {formatTime(lastSent.sentAt)} · {lastSent.channels.join(' + ')}
          </span>
        )}
      </div>
      {user && (
        <p className="text-[10px] text-granite">
          {user.email} · {TEAM_ROLE_META[user.role].label}
          {user.partnerManagerId ? '' : ' · not aligned to one manager'}
        </p>
      )}
    </div>
  );
}
