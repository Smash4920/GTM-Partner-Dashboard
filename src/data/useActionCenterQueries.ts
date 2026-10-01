import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { actionCenterScopeKey } from './actionCenter';
import type { ActionCenterScope } from './actionCenter';
import type { DataProvider } from './DataProvider';
import { useScopedQuery } from './queryState';
import { usePaginatedRows } from './paginationState';

export function useActionCenterQueries({
  provider,
  access,
  scope,
}: {
  provider: DataProvider;
  access: DemoAccessScope;
  scope: ActionCenterScope;
}) {
  const key = `action-center|${demoScopeKey(access)}|${actionCenterScopeKey(scope)}`;
  // Notes invalidate the Action Center projection without changing membership
  // or order. Keep its cursor and loaded window; never emit this local key.
  const notes = scope.edits?.notes ?? {};
  const noteKey = JSON.stringify(
    Object.keys(notes)
      .sort()
      .map((id) => [id, notes[id]]),
  );
  const summary = useScopedQuery({
    provider,
    queryKey: `${key}|${noteKey}`,
    scopeKey: key,
    run: (context) => provider.getActionCenterSummary(access, scope, context),
    errorFallback: 'Failed to load the Action Center summary',
  });
  // Policy, filters and effective overlays can change membership or global
  // order. Restart only this collection, never reuse its obsolete cursor.
  const items = usePaginatedRows({
    provider,
    enabled: true,
    resetKey: key,
    refreshKey: noteKey,
    pageSize: 25,
    fetchPage: (page, context) => provider.listActionItems(access, scope, page, context),
    errorFallback: 'Failed to load the action items',
    loadMoreErrorFallback: 'Failed to load more action items',
  });
  return { summary, items };
}
