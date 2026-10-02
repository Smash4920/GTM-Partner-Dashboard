import { useId, useState } from 'react';
import { NOTIFICATION_CHANNEL_META, TEAM_ROLE_META } from '../data/constants';
import { ACTION_CATEGORY_LABELS } from '../data/actionCenter';
import type {
  ActionItem,
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
import FormField, { focusInvalid } from './FormField';

/** Everything the composer holds; the view owns it so alerts can pre-fill it. */
export interface ComposerState {
  userId: string | null;
  template: NotificationTemplateId;
  registrationId: string | null;
  subject: string;
  body: string;
  channels?: NotificationChannel[];
}

interface NotificationComposerProps {
  users: TeamUser[];
  partners: Partner[];
  registrations: DealRegistration[];
  alerts: RegistrationSlaAlert[];
  state: ComposerState;
  onChange: (next: ComposerState) => void;
  onSend: () => void;
  /** The most recent send this session, shown as a simulated/local-only record. */
  lastSent?: DashboardNotification;
  /** Builds the copy for a template/registration pair. */
  describe: (
    template: NotificationTemplateId,
    registrationId: string | null,
  ) => {
    subject: string;
    body: string;
  };
  /** Routed action context; no registration-picker/whole-record dependency. */
  action?: ActionItem;
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

function NotificationChannels({
  user,
  channels,
  onChange,
}: {
  user: TeamUser | null;
  channels: NotificationChannel[];
  onChange: (channels: NotificationChannel[]) => void;
}) {
  const errorId = useId();
  const invalid = Boolean(user && channels.length === 0);
  return (
    <fieldset aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}>
      <legend className={labelClass}>Channels</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {user ? (
          user.channels.map((channel) => (
            <label
              key={channel}
              className="rounded border border-ash bg-ash/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone"
            >
              <input
                type="checkbox"
                name="channels"
                aria-label={`Use ${NOTIFICATION_CHANNEL_META[channel].label}`}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? errorId : undefined}
                checked={channels.includes(channel)}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? [...channels, channel]
                      : channels.filter((value) => value !== channel),
                  )
                }
                className="mr-1"
              />
              <span>{NOTIFICATION_CHANNEL_META[channel].label}</span>
              <span className="block normal-case tracking-normal">
                {NOTIFICATION_CHANNEL_META[channel].description}
              </span>
            </label>
          ))
        ) : (
          <span className="text-[10px] text-granite">
            Pick a teammate to see the channels they receive on.
          </span>
        )}
      </div>
      <p className="mt-1 text-[10px] text-granite">
        Only selected configured channels are used. Records are session-only. Refresh clears them.
        Simulated / local only — nothing is delivered.
      </p>
      {invalid && (
        <p id={errorId} className="text-xs text-signal">
          Select at least one configured channel.
        </p>
      )}
    </fieldset>
  );
}

function composerErrors(
  user: TeamUser | null,
  state: ComposerState,
  channels: NotificationChannel[],
) {
  return {
    recipient: user ? undefined : 'Select an active teammate.',
    subject: state.subject.trim() ? undefined : 'A subject is required.',
    body: state.body.trim() ? undefined : 'A message is required.',
    channels: channels.length > 0 ? undefined : 'Select at least one configured channel.',
  };
}

/**
 * Send a notification to one named person, from inside the connection map:
 * picking a teammate in the notification node lands here, and the SLA queue
 * pre-fills it. The recipient's own notification channels decide how it would
 * go out. Sends are simulated and local to this session; nothing is delivered.
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
  action,
}: NotificationComposerProps) {
  const [submitted, setSubmitted] = useState(false);
  // Only a teammate with notifications on can be messaged; a paused or
  // not-yet-routing one cannot.
  const notifiableUsers = users.filter((user) => user.status === 'active');
  const user = notifiableUsers.find((candidate) => candidate.id === state.userId) ?? null;
  const templates = action
    ? action.reasons.map((reason) => ({
        id: reason.category,
        label: ACTION_CATEGORY_LABELS[reason.category],
        description: reason.recommendedAction,
      }))
    : NOTIFICATION_TEMPLATES;
  const template = templates.find((item) => item.id === state.template);
  const registration = registrations.find((item) => item.id === state.registrationId);
  const alert = alerts.find((item) => item.registration.id === state.registrationId);
  const partner = registration
    ? partners.find((candidate) => candidate.id === registration.partnerId)
    : undefined;
  const channels = (state.channels ?? user?.channels ?? []).filter((channel) =>
    user?.channels.includes(channel),
  );
  const errors = composerErrors(user, state, channels);
  const shownErrors: Partial<Record<keyof typeof errors, string>> = submitted ? errors : {};

  const setUser = (userId: string) => onChange({ ...state, userId, channels: undefined });

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
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        setSubmitted(true);
        if (focusInvalid(event.currentTarget, errors)) return;
        onSend();
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="To" error={shownErrors.recipient}>
          <select
            name="recipient"
            value={state.userId ?? ''}
            onChange={(event) => setUser(event.target.value)}
            className={`${selectClass} mt-1`}
            disabled={Boolean(action)}
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
        </FormField>
        <FormField label="Template">
          <select
            value={state.template}
            onChange={(event) => setTemplate(event.target.value as NotificationTemplateId)}
            className={`${selectClass} mt-1`}
          >
            {templates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <p className="text-xs text-granite">{template?.description}</p>

      {action ? (
        <p className="text-xs text-stone">Entity: {action.id}</p>
      ) : (
        <FormField label="Registration">
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
        </FormField>
      )}

      <RegistrationStatus registration={registration} alert={alert} partner={partner} />

      <FormField label="Subject" error={shownErrors.subject}>
        <input
          name="subject"
          autoFocus={Boolean(action)}
          value={state.subject}
          onChange={(event) => onChange({ ...state, subject: event.target.value })}
          placeholder="What this is about"
          className={`${selectClass} mt-1`}
        />
      </FormField>

      <FormField label="Message" error={shownErrors.body}>
        <textarea
          name="body"
          value={state.body}
          onChange={(event) => onChange({ ...state, body: event.target.value })}
          rows={5}
          placeholder="Pick a template or write the note"
          className={`${selectClass} mt-1 resize-y leading-relaxed`}
        />
      </FormField>

      <NotificationChannels
        user={user}
        channels={channels}
        onChange={(selected) => onChange({ ...state, channels: selected })}
      />

      <div className="flex flex-wrap items-center gap-3 border-t border-carbon pt-3">
        <button
          type="submit"
          disabled={!user}
          className="flex items-center gap-1.5 rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-bone transition-colors hover:bg-ash/30 disabled:opacity-40"
        >
          <SendIcon className="h-3.5 w-3.5" />
          Send to {user ? user.name : 'a teammate'}
        </button>
        {!user && (
          <span className="text-xs text-granite">
            {users.length === 0
              ? 'Add someone to the roster first.'
              : 'Only a teammate with notifications on can be messaged.'}
          </span>
        )}
        {lastSent && (
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-metric">
            Simulated / local only · {formatTime(lastSent.sentAt)} · {lastSent.channels.join(' + ')}
          </span>
        )}
      </div>
      {user && (
        <p className="text-[10px] text-granite">
          {user.email} · {TEAM_ROLE_META[user.role].label}
          {user.partnerManagerId ? '' : ' · not aligned to one manager'}
        </p>
      )}
    </form>
  );
}
