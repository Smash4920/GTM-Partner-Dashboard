import { useState } from 'react';
import ActionPolicyForm from '../components/ActionPolicyForm';
import ActionNotificationPanel from '../components/ActionNotificationPanel';
import Card from '../components/Card';
import PageFooter from '../components/PageFooter';
import { renderQueryState } from '../components/QueryState';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { ACTION_CATEGORIES, ACTION_CATEGORY_LABELS } from '../data/actionCenter';
import type { ActionCenterScope } from '../data/actionCenter';
import type { DataProvider } from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import { useActionCenterQueries } from '../data/useActionCenterQueries';
import type { ActionPolicy, DashboardNotification } from '../data/types';
import type { NotificationDraft } from '../lib/notifications';
import { formatUsd, formatDate } from '../lib/format';

export default function ActionCenterView({
  provider,
  policy,
  onPolicyChange,
  onSendNotification,
  notifications = [],
  ...sessionScope
}: {
  provider: DataProvider;
  policy: Readonly<ActionPolicy>;
  onPolicyChange: (policy: ActionPolicy) => void;
  onSendNotification?: (draft: NotificationDraft) => void;
  notifications?: DashboardNotification[];
} & Pick<ActionCenterScope, 'edits' | 'roster' | 'classifications' | 'prospects'>) {
  const [filters, setFilters] = useState<NonNullable<ActionCenterScope['filters']>>({});
  const [composingId, setComposingId] = useState<string | null>(null);
  const { summary, items } = useActionCenterQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    scope: { policy, filters, ...sessionScope },
  });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-medium text-bone">Action Center</h1>
      <Card title="Reporting policy">
        <ActionPolicyForm policy={policy} onApply={onPolicyChange} />
      </Card>
      <Card title="Action summary">
        {renderQueryState('Action Center summary', summary, (data) => (
          <>
            <p className="mb-3 text-sm text-bone">{data.totalCount} unique items</p>
            <ul className="grid gap-2 text-xs text-stone sm:grid-cols-2">
              {ACTION_CATEGORIES.map((category) => (
                <li key={category}>
                  {ACTION_CATEGORY_LABELS[category]}: {data.categoryCounts[category]}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-granite">
              Category counts include matching reasons across the full filtered result, not just
              this page. One item can have multiple reasons.
            </p>
          </>
        ))}
      </Card>
      <Card title="Filters">
        <fieldset>
          <legend className="mb-2 text-xs text-stone">Categories (match any selected)</legend>
          <div className="flex flex-wrap gap-4">
            {ACTION_CATEGORIES.map((category) => (
              <label key={category} className="flex items-center gap-2 text-xs text-stone">
                <input
                  type="checkbox"
                  checked={filters.categories?.includes(category) ?? false}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      categories: event.target.checked
                        ? [...(current.categories ?? []), category]
                        : current.categories?.filter((value) => value !== category),
                    }))
                  }
                />
                {ACTION_CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-4">
          <label className="text-xs text-stone">
            Severity
            <select
              value={filters.severity ?? ''}
              className="ml-2 rounded border border-ash bg-canvas p-2"
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  severity: (event.target.value || undefined) as typeof current.severity,
                }))
              }
            >
              <option value="">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
            </select>
          </label>
          <label className="text-xs text-stone">
            Owner ID
            <input
              className="ml-2 rounded border border-ash bg-canvas p-2"
              value={filters.ownerId ?? ''}
              placeholder="All owners; unowned for none"
              onChange={(event) =>
                setFilters((current) => ({ ...current, ownerId: event.target.value || undefined }))
              }
            />
          </label>
        </div>
      </Card>
      <Card title="Action items">
        {renderQueryState('action items', pageWindowAsQuery(items), (rows) => (
          <>
            <ul className="divide-y divide-ash">
              {rows.map((item) => (
                <li
                  key={item.id}
                  data-testid="action-item"
                  data-action-id={item.id}
                  className="py-3 text-xs text-stone"
                >
                  <p className="font-mono text-bone">{item.id}</p>
                  <p>
                    {item.reasons
                      .map((reason) => ACTION_CATEGORY_LABELS[reason.category])
                      .join(' · ')}
                  </p>
                  {!item.owner?.userId && (
                    <p className="text-signal">Unowned — no eligible active demo recipient.</p>
                  )}
                  {onSendNotification && (
                    <>
                      <button
                        type="button"
                        className="mt-2 rounded border border-ash px-3 py-2 disabled:opacity-40"
                        disabled={!item.owner?.userId}
                        aria-expanded={composingId === item.id}
                        aria-controls={`notification-${item.id}`}
                        onClick={() => setComposingId(composingId === item.id ? null : item.id)}
                      >
                        {composingId === item.id ? 'Close notification' : 'Notify owner'}
                      </button>
                      {composingId === item.id && (
                        <section
                          id={`notification-${item.id}`}
                          aria-label={`Notification for ${item.id}`}
                          className="mt-3 max-w-2xl border-t border-ash pt-3"
                        >
                          <ActionNotificationPanel
                            key={item.id}
                            action={item}
                            provider={provider}
                            roster={sessionScope.roster}
                            onSend={onSendNotification}
                            notifications={notifications}
                          />
                        </section>
                      )}
                    </>
                  )}
                  <p>
                    {item.severity} · {item.owner?.userId ?? 'Unowned'} ·{' '}
                    {item.dueAt ? formatDate(item.dueAt) : 'No due date'} ·{' '}
                    {formatUsd(item.exposure)}
                  </p>
                </li>
              ))}
            </ul>
            {rows.length === 0 && <p className="text-xs text-granite">No matching action items.</p>}
            <PageFooter state={items} noun="action items" pageSize={25} />
          </>
        ))}
      </Card>
    </div>
  );
}
