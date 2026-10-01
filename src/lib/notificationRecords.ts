import type { DashboardNotification } from '../data/types';
import type { NotificationDraft } from './notifications';

/** The shell injects runtime time; this allowlist has no clock, storage or sender. */
export function recordNotification(
  draft: NotificationDraft,
  id: string,
  sentAt: string,
): DashboardNotification {
  return {
    id,
    userId: draft.userId,
    kind: draft.kind,
    subject: draft.subject,
    body: draft.body,
    channels: [...draft.channels],
    sentAt,
    status: 'simulated-local',
    ...(draft.registrationId ? { registrationId: draft.registrationId } : {}),
    ...(draft.actionId ? { actionId: draft.actionId } : {}),
    ...(draft.actionCategory ? { actionCategory: draft.actionCategory } : {}),
    ...(draft.entityKind ? { entityKind: draft.entityKind } : {}),
    ...(draft.entityId ? { entityId: draft.entityId } : {}),
  };
}
