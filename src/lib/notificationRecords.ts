import type { DashboardNotification, TeamUser } from '../data/types';
import type { TeamRosterScope } from '../data/DataProvider';
import type { NotificationDraft } from './notifications';

/** Resolve only this evidenced recipient, never reroute or invent roster membership. */
export function prepareNotificationDraft(
  draft: NotificationDraft,
  evidence: TeamUser | undefined,
  roster: TeamRosterScope = {},
): NotificationDraft | null {
  if (!evidence || evidence.id !== draft.userId) return null;
  const recipient = roster.added?.find((user) => user.id === evidence.id) ?? {
    ...evidence,
    ...roster.overrides?.[evidence.id],
  };
  const subject = draft.subject.trim();
  const body = draft.body.trim();
  const channels = [...new Set(draft.channels)].filter((channel) =>
    recipient.channels.includes(channel),
  );
  if (
    recipient.id !== draft.userId ||
    recipient.status !== 'active' ||
    !subject ||
    !body ||
    channels.length === 0
  )
    return null;
  return recordFields({ ...draft, subject, body, channels });
}

/** Explicit local field allowlist, never a spread of caller/provider records. */
function recordFields(draft: NotificationDraft): NotificationDraft {
  return {
    userId: draft.userId,
    kind: draft.kind,
    subject: draft.subject,
    body: draft.body,
    channels: [...draft.channels],
    ...(draft.registrationId ? { registrationId: draft.registrationId } : {}),
    ...(draft.actionId ? { actionId: draft.actionId } : {}),
    ...(draft.actionCategory ? { actionCategory: draft.actionCategory } : {}),
    ...(draft.entityKind ? { entityKind: draft.entityKind } : {}),
    ...(draft.entityId ? { entityId: draft.entityId } : {}),
  };
}

/** The shell injects runtime time; this allowlist has no clock, storage or sender. */
export function recordNotification(
  draft: NotificationDraft,
  id: string,
  sentAt: string,
): DashboardNotification {
  return {
    ...recordFields(draft),
    id,
    sentAt,
    status: 'simulated-local',
  };
}
