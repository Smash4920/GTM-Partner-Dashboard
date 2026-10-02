import { useState } from 'react';
import ActionNotificationPanel from './ActionNotificationPanel';
import { ACTION_CATEGORY_LABELS } from '../data/actionCenter';
import { actionDestination } from '../data/actionNavigation';
import type { DataProvider } from '../data/DataProvider';
import type { QueryMeta } from '../data/queryMetadata';
import type { ActionCenterScope } from '../data/actionCenter';
import type { ActionItem, DashboardNotification } from '../data/types';
import { actionEvidence } from '../lib/actionEvidence';
import { formatDate, formatUsd } from '../lib/format';
import type { NotificationSender } from '../lib/notifications';
import type { WorkflowActions } from '../data/workflows';

const CONTROL_CLASS =
  'rounded border border-ash px-3 py-2 text-xs text-stone hover:bg-ash/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bone disabled:opacity-40';

export default function ActionItemRow({
  item,
  meta,
  provider,
  roster,
  notifications,
  onSendNotification,
  onOpenContext,
  onWorkflow,
}: {
  item: ActionItem;
  meta: QueryMeta;
  provider: DataProvider;
  roster?: ActionCenterScope['roster'];
  notifications: DashboardNotification[];
  onSendNotification?: NotificationSender;
  onOpenContext?: (item: ActionItem) => void;
} & WorkflowActions) {
  const [expanded, setExpanded] = useState(false);
  const [composing, setComposing] = useState(false);
  const destination = actionDestination(item);
  return (
    <li
      data-testid="action-item"
      data-action-id={item.id}
      className="space-y-3 py-5 text-xs text-stone"
    >
      <h3 className="break-all font-mono text-sm text-bone">{item.id}</h3>
      <p>{item.reasons.map((reason) => ACTION_CATEGORY_LABELS[reason.category]).join(' · ')}</p>
      <dl className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <dt className="inline text-granite">Severity: </dt>
          <dd className="inline">{item.severity}</dd>
        </div>
        <div>
          <dt className="inline text-granite">Due: </dt>
          <dd className="inline">{item.dueAt ? formatDate(item.dueAt) : 'No due date'}</dd>
        </div>
        <div>
          <dt className="inline text-granite">Exposure: </dt>
          <dd className="inline">{formatUsd(item.exposure)}</dd>
        </div>
        <div>
          <dt className="inline text-granite">Owner: </dt>
          <dd className="inline">
            {item.owner?.userId ?? 'Unowned'}
            {item.owner?.userId && ` · ${item.owner.basis}`}
          </dd>
        </div>
      </dl>
      {!item.owner?.userId && (
        <p className="text-signal">Unowned — no eligible active demo recipient.</p>
      )}
      <ul className="space-y-1">
        {item.reasons.map((reason) => (
          <li key={reason.category}>
            <span className="text-granite">Recommended action: </span>
            {reason.recommendedAction}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          className={CONTROL_CLASS}
          aria-label={`Show evidence for ${item.id}`}
          aria-expanded={expanded}
          aria-controls={`evidence-${item.id}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Hide evidence' : 'Show evidence'}
        </button>
        <a
          className={CONTROL_CLASS}
          href={destination.href}
          onClick={(event) => {
            if (!onOpenContext) return;
            event.preventDefault();
            onOpenContext(item);
          }}
        >
          {destination.label}
        </a>
        {onSendNotification && (
          <button
            type="button"
            className={CONTROL_CLASS}
            disabled={!item.owner?.userId}
            aria-expanded={composing}
            aria-controls={`notification-${item.id}`}
            onClick={() => setComposing(!composing)}
          >
            {composing ? 'Close notification' : 'Notify owner'}
          </button>
        )}
        {item.entityKind === 'registration' && onWorkflow && (
          <button
            type="button"
            className={CONTROL_CLASS}
            onClick={() => onWorkflow({ kind: 'registration', entityIds: [item.entityId] })}
          >
            Record registration decision
          </button>
        )}
      </div>
      {expanded && (
        <section
          id={`evidence-${item.id}`}
          aria-label={`Evidence for ${item.id}`}
          className="space-y-3 border-l border-ash pl-4"
        >
          <p>
            As of {formatDate(meta.asOf)} · provider {meta.providerId} · {meta.completeness} ·
            partner {item.partnerId}
          </p>
          <p>
            Lineage:{' '}
            {meta.lineage.map((source) => `${source.source} — ${source.description}`).join('; ')}
          </p>
          <ul className="space-y-3">
            {item.reasons.map((reason) => (
              <li key={reason.category}>
                <h4 className="font-medium text-bone">{ACTION_CATEGORY_LABELS[reason.category]}</h4>
                <p>{actionEvidence(reason)}</p>
                <p>
                  {reason.severity} · due{' '}
                  {reason.dueAt ? formatDate(reason.dueAt) : 'not specified'}
                </p>
                <p>Recommended action: {reason.recommendedAction}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
      {composing && onSendNotification && (
        <section
          id={`notification-${item.id}`}
          aria-label={`Notification for ${item.id}`}
          className="max-w-2xl border-t border-ash pt-3"
        >
          <ActionNotificationPanel
            action={item}
            provider={provider}
            roster={roster}
            onSend={onSendNotification}
            notifications={notifications}
          />
        </section>
      )}
    </li>
  );
}
