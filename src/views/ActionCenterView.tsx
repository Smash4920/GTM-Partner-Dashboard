import { useState } from 'react';
import ActionPolicyForm from '../components/ActionPolicyForm';
import ActionItemRow from '../components/ActionItemRow';
import ActionPagination from '../components/ActionPagination';
import Card from '../components/Card';
import { renderQueryState } from '../components/QueryState';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { ACTION_CATEGORIES, ACTION_CATEGORY_LABELS } from '../data/actionCenter';
import type { ActionCenterScope } from '../data/actionCenter';
import type { DataProvider } from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import { useActionCenterQueries } from '../data/useActionCenterQueries';
import type { ActionItem, ActionPolicy, DashboardNotification } from '../data/types';
import type { NotificationSender } from '../lib/notifications';
import type { WorkflowActions } from '../data/workflows';

export default function ActionCenterView({
  provider,
  policy,
  onPolicyChange,
  onSendNotification,
  notifications = [],
  onOpenContext,
  onWorkflow,
  ...sessionScope
}: {
  provider: DataProvider;
  policy: Readonly<ActionPolicy>;
  onPolicyChange: (policy: ActionPolicy) => void;
  onSendNotification?: NotificationSender;
  notifications?: DashboardNotification[];
  onOpenContext?: (item: ActionItem) => void;
} & WorkflowActions &
  Pick<ActionCenterScope, 'edits' | 'roster' | 'classifications' | 'prospects'>) {
  const [filters, setFilters] = useState<NonNullable<ActionCenterScope['filters']>>({});
  const { summary, items } = useActionCenterQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    scope: { policy, filters, ...sessionScope },
  });
  return (
    <div className="space-y-6">
      <h1 tabIndex={-1} className="text-2xl font-medium text-bone">
        Action Center
      </h1>
      <p className="max-w-3xl text-sm text-granite">
        Internal demo · policy, routing and notifications are session-only. Refresh loses this
        state. Notifications are simulated/local-only, with no external delivery, persistence or
        write-back. Client filtering is not authorization.
      </p>
      <Card title="Reporting policy">
        <ActionPolicyForm policy={policy} onApply={onPolicyChange} />
      </Card>
      <Card title="Action summary">
        {renderQueryState('Action Center summary', summary, (data) => (
          <>
            <p className="mb-3 text-sm text-bone">{data.totalCount} unique items</p>
            <ul className="grid gap-3 text-xs text-stone sm:grid-cols-2 xl:grid-cols-5">
              {ACTION_CATEGORIES.map((category) => (
                <li key={category} className="rounded border border-ash p-3">
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
          <button
            type="button"
            aria-pressed={filters.ownerId === 'unowned'}
            onClick={() =>
              setFilters((current) => ({
                ...current,
                ownerId: current.ownerId === 'unowned' ? undefined : 'unowned',
              }))
            }
            className="rounded border border-ash px-3 py-2 text-xs text-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-bone"
          >
            Unowned only
          </button>
          <button
            type="button"
            onClick={() => setFilters({})}
            className="rounded border border-ash px-3 py-2 text-xs text-stone focus-visible:outline focus-visible:outline-2 focus-visible:outline-bone"
          >
            Clear filters
          </button>
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
        {renderQueryState('action items', pageWindowAsQuery(items, true), (rows) => (
          <>
            <ul className="divide-y divide-ash">
              {rows.map((item) => (
                <ActionItemRow
                  key={item.id}
                  item={item}
                  meta={items.meta!}
                  provider={provider}
                  roster={sessionScope.roster}
                  onSendNotification={onSendNotification}
                  notifications={notifications}
                  onOpenContext={onOpenContext}
                  onWorkflow={onWorkflow}
                />
              ))}
            </ul>
            {rows.length === 0 && <p className="text-xs text-granite">No matching action items.</p>}
            <ActionPagination state={items} />
          </>
        ))}
      </Card>
    </div>
  );
}
