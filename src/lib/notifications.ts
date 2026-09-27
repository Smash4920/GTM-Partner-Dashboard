/**
 * Notification copy and templates.
 *
 * Pure composition, kept out of the components so the exact words a partner
 * manager receives can be read and tested on their own. One rule shapes all of
 * it: a notification names the account, the owner's next action, and the clock
 * it is racing, because a message without those is noise.
 */

import { REGISTRATION_SLA_BUSINESS_DAYS } from '../data/constants';
import type {
  DealRegistration,
  NotificationChannel,
  NotificationKind,
  Partner,
} from '../data/types';
import { formatDate } from './format';
import { businessDaysWaiting, type RegistrationSlaAlert } from './metrics';

export type NotificationTemplateId = 'sla-alert' | 'registration-note' | 'custom';

export interface NotificationTemplate {
  id: NotificationTemplateId;
  label: string;
  description: string;
}

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  {
    id: 'sla-alert',
    label: 'Deal reg SLA',
    description: 'The response SLA for one registration — warning or lapsed.',
  },
  {
    id: 'registration-note',
    label: 'Registration question',
    description: 'Ask the owner about one pending registration.',
  },
  {
    id: 'custom',
    label: 'Custom note',
    description: 'Anything else; the channels still come from the user.',
  },
];

/** What a composed notification needs before it becomes a sent record. */
export interface NotificationDraft {
  userId: string;
  kind: NotificationKind;
  subject: string;
  body: string;
  channels: NotificationChannel[];
  registrationId?: string;
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

export function slaAlertKind(state: RegistrationSlaAlert['state']): NotificationKind {
  return state === 'approaching' ? 'registration-sla-warning' : 'registration-sla-breach';
}

/**
 * The alert as the owner receives it. Approaching reads as a deadline about to
 * pass; breached reads as one that already has, without softening it.
 */
export function slaAlertCopy(alert: RegistrationSlaAlert): {
  kind: NotificationKind;
  subject: string;
  body: string;
} {
  const { registration, partner, state, dueAt } = alert;
  const account = registration.accountName;
  const partnerName = partner?.name ?? registration.partnerId;
  const submitted = formatDate(registration.submittedAt);

  if (state === 'approaching') {
    return {
      kind: slaAlertKind(state),
      subject: `Deal reg due next business day: ${account}`,
      body: `${account} was registered by ${partnerName} on ${submitted}. The ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day response SLA falls due ${formatDate(
        dueAt,
      )} — ${plural(alert.businessDaysRemaining, 'business day')} left. Approve or reject it in Deal Reg Ops so the partner's exclusivity holds and the pipeline is not blocked on an unanswered registration.`,
    };
  }

  const overdue = alert.businessDaysWaiting - REGISTRATION_SLA_BUSINESS_DAYS;
  return {
    kind: slaAlertKind(state),
    subject: `Deal reg SLA lapsed: ${account}`,
    body: `${account} was registered by ${partnerName} on ${submitted} and is now ${plural(
      overdue,
      'business day',
    )} past the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day response SLA (due ${formatDate(
      dueAt,
    )}). Decide it today: the partner is waiting, and the registration has been sitting in the queue long enough to be a support conversation.`,
  };
}

/** A nudge about one registration that is still inside the SLA. */
export function registrationNoteCopy(
  registration: DealRegistration,
  partner: Partner | undefined,
): { subject: string; body: string } {
  const partnerName = partner?.name ?? registration.partnerId;
  const waiting = businessDaysWaiting(registration);
  return {
    subject: `Question on the ${registration.accountName} registration`,
    body: `${partnerName} registered ${registration.accountName} on ${formatDate(
      registration.submittedAt,
    )} and it is still awaiting review after ${plural(
      waiting,
      'business day',
    )}. Can you confirm where it stands?`,
  };
}

/**
 * The subject and body a template produces for a chosen registration: the SLA
 * copy when the registration is inside an alert, the follow-up otherwise.
 * Editing afterwards is expected; this is only the starting text.
 */
export function composeCopy(params: {
  template: NotificationTemplateId;
  registration?: DealRegistration;
  partner?: Partner;
  alert?: RegistrationSlaAlert;
}): { kind: NotificationKind; subject: string; body: string } {
  const { template, registration, partner, alert } = params;
  if (template === 'sla-alert' && alert) return slaAlertCopy(alert);
  if (template !== 'custom' && registration) {
    return { kind: 'manual', ...registrationNoteCopy(registration, partner) };
  }
  return { kind: 'manual', subject: '', body: '' };
}
