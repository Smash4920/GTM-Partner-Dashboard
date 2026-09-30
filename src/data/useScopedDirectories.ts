import type { DataProvider } from './DataProvider';
import { demoScopeKey } from './accessScope';
import type { DemoAccessScope } from './accessScope';
import { prospectsKey, useScopedQuery } from './queryState';
import type { QueryState } from './queryState';
import type { Partner, PartnerManager } from './types';

/**
 * The small dimension lookups the scoped routes render their selectors and
 * row labels from, fetched as scoped queries rather than read off a folded
 * book.
 *
 * Both are dimensions, not facts: they do not move when an aggregate does,
 * so nothing invalidates them except the session's prospect roster (a
 * prospect is a roster entry the provider does not know yet) and the
 * provider itself. Each keeps its own loading, error, and retry state, so a
 * failed directory degrades exactly the selector or partner column that
 * reads it.
 */

/** The partner-manager directory the drill-down selects from. */
export function useManagerDirectory(
  provider: DataProvider,
  access: DemoAccessScope,
): QueryState<PartnerManager[]> {
  return useScopedQuery({
    provider,
    queryKey: `manager-directory|access:${demoScopeKey(access)}`,
    run: (context) => provider.getManagerDirectory(access, context),
    errorFallback: 'Failed to load the manager directory',
  });
}

/**
 * The partner roster — provider partners plus the session's prospects. The
 * prospects are part of the key because adding one is the only session
 * change that can alter the answer.
 */
export function usePartnerRoster(
  provider: DataProvider,
  access: DemoAccessScope,
  prospects: Partner[],
): QueryState<Partner[]> {
  return useScopedQuery({
    provider,
    queryKey: `partner-roster|access:${demoScopeKey(access)}|prospects:${prospectsKey(prospects)}`,
    run: (context) => provider.getPartnerRoster(access, { prospects }, context),
    errorFallback: 'Failed to load the partner roster',
  });
}
