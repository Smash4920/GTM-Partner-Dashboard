import { useState } from 'react';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import type { DataProvider, TeamRosterScope } from '../data/DataProvider';
import { useScopedQuery } from '../data/queryState';
import type { ActionCategory, ActionItem, DashboardNotification } from '../data/types';
import { actionNotificationDraft, type NotificationSender } from '../lib/notifications';
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
  onSend: NotificationSender;
  notifications: DashboardNotification[];
}) {
  const rosterKey = JSON.stringify(roster);
  const team = useScopedQuery({
    provider,
    queryKey: `action-notification-roster:${rosterKey}`,
    // Never retain a recipient across changed routing configuration.
    scopeKey: rosterKey,
    run: (context) => provider.getTeamRoster(INTERNAL_DEMO_SCOPE, roster, context),
    errorFallback: 'Failed to load the notification roster',
  });
  const [edited, setEdited] = useState<ComposerState | null>(null);
  return renderQueryState('action notification roster', team, (users) => {
    const compose = (category: ComposerState['template']) =>
      actionNotificationDraft(action, category as ActionCategory, users);
    const initial = compose(action.reasons[0].category);
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
    const recipient = users.find((user) => user.id === initial.userId)!;
    const draft = compose(state.template);
    const describe = (category: ComposerState['template']) =>
      compose(category) ?? {
        subject: '',
        body: '',
      };
    return (
      <NotificationComposer
        users={[recipient]}
        partners={[]}
        registrations={[]}
        alerts={[]}
        action={action}
        state={{ ...state, userId: initial.userId }}
        onChange={setEdited}
        describe={describe}
        onSend={() => {
          if (!draft || team.error || team.refreshing) return;
          onSend(
            {
              ...draft,
              subject: state.subject,
              body: state.body,
              channels: state.channels ?? recipient.channels,
            },
            { provider, recipient },
          );
        }}
        lastSent={notifications.find((notification) => notification.actionId === action.id)}
      />
    );
  });
}
