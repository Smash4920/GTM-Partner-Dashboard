import { useState } from 'react';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import type { DataProvider, TeamRosterScope } from '../data/DataProvider';
import { useScopedQuery } from '../data/queryState';
import type { ActionCategory, ActionItem, DashboardNotification } from '../data/types';
import {
  actionNotificationDraft,
  prepareNotificationDraft,
  type NotificationDraft,
} from '../lib/notifications';
import NotificationComposer, { type ComposerState } from './NotificationComposer';
import { renderQueryState } from './QueryState';

/** On-demand bounded roster query, shared local-only composer, no sender. */
export default function ActionNotificationPanel({
  provider,
  roster = {},
  action,
  onSend,
  notifications,
}: {
  provider: DataProvider;
  roster?: TeamRosterScope;
  action: ActionItem;
  onSend: (draft: NotificationDraft) => void;
  notifications: DashboardNotification[];
}) {
  const team = useScopedQuery({
    provider,
    queryKey: `action-notification-roster:${JSON.stringify(roster)}`,
    // Never retain a recipient across changed routing configuration.
    scopeKey: JSON.stringify(roster),
    run: (context) => provider.getTeamRoster(INTERNAL_DEMO_SCOPE, roster, context),
    errorFallback: 'Failed to load the notification roster',
  });
  const [edited, setEdited] = useState<ComposerState | null>(null);
  return renderQueryState('action notification roster', team, (users) => {
    const initial = actionNotificationDraft(action, action.reasons[0].category, users);
    if (!initial)
      return (
        <p className="text-xs text-signal">
          Unowned — no eligible active demo recipient. Owner notification is unavailable.
        </p>
      );
    const state: ComposerState = edited ?? {
      userId: initial.userId,
      template: initial.actionCategory!,
      registrationId: initial.registrationId ?? null,
      subject: initial.subject,
      body: initial.body,
    };
    const draft = actionNotificationDraft(action, state.template as ActionCategory, users);
    const describe = (category: ComposerState['template']) =>
      actionNotificationDraft(action, category as ActionCategory, users) ?? {
        subject: '',
        body: '',
      };
    return (
      <NotificationComposer
        users={users.filter((user) => user.id === initial.userId)}
        partners={[]}
        registrations={[]}
        alerts={[]}
        action={action}
        state={{ ...state, userId: initial.userId }}
        onChange={setEdited}
        describe={describe}
        onSend={() => {
          if (!draft || team.error || team.refreshing) return;
          const recipient = users.find((user) => user.id === draft.userId)!;
          const prepared = prepareNotificationDraft(
            {
              ...draft,
              subject: state.subject,
              body: state.body,
              channels: state.channels ?? recipient.channels,
            },
            recipient,
          );
          if (prepared) onSend(prepared);
        }}
        lastSent={notifications.find((notification) => notification.actionId === action.id)}
      />
    );
  });
}
