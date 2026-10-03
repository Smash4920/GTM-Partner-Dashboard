import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { actionCenterScopeKey } from './actionCenter';
import type { ActionCenterScope } from './actionCenter';
import type { DataProvider } from './DataProvider';
import { editMapKey, useScopedQuery } from './queryState';
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
  // UI scope changes reset depth; edits refresh it even when eligibility or
  // global ordering changes. Provider cursors still use the full scope key.
  const resetKey = `${demoScopeKey(access)}|${actionCenterScopeKey({ ...scope, edits: undefined })}`;
  const refreshKey = `${actionCenterScopeKey(scope)}|${editMapKey(scope.edits?.notes ?? {})}`;
  const summary = useScopedQuery({
    provider,
    queryKey: `${resetKey}|${refreshKey}`,
    scopeKey: resetKey,
    run: (context) => provider.getActionCenterSummary(access, scope, context),
    errorFallback: 'Failed to load the Action Center summary',
  });
  const items = usePaginatedRows({
    provider,
    enabled: true,
    resetKey,
    refreshKey,
    pageSize: 25,
    fetchPage: (page, context) => provider.listActionItems(access, scope, page, context),
    errorFallback: 'Failed to load the action items',
    loadMoreErrorFallback: 'Failed to load more action items',
  });
  return { summary, items };
}
