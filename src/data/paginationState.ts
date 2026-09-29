import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataProvider, Page, PageRequest } from './DataProvider';
import type { QueryMeta, QueryResult } from './queryMetadata';
import { messageOf } from './queryState';

/**
 * The independent state of one cursor-paginated row collection — one
 * manager's book, one page at a time.
 *
 * The guarantees this primitive exists to keep:
 *
 * - One request per cursor. A `loadMore` while any fetch for this collection
 *   is in flight is a no-op, so two fast clicks cannot issue the same page
 *   twice or append the same rows twice.
 * - A failed page keeps the pages already loaded; `retry` then repeats the
 *   failed page request (same cursor), not the whole collection.
 * - A data-only change (an edit that cannot change which rows belong to the
 *   collection) refetches the loaded window in place — one request sized to
 *   the rows on screen — instead of resetting to the first page. A failed
 *   window refresh keeps the loaded rows and reports the error alongside.
 * - A membership change (provider, business scope, or page size) resets to
 *   the first page: rows fetched under another membership would read as
 *   members of a collection they do not belong to.
 * - Late answers are dropped by request sequence and read-time identity
 *   gating, and an aborted request writes nothing, so aborts are silent.
 */
export interface PaginationState<T> {
  rows: T[];
  /** Rows matching the scope in total, not the pages fetched. */
  totalCount: number;
  /** Metadata of the most recently landed page, or null before the first. */
  meta: QueryMeta | null;
  /** True only until the first page lands. */
  loading: boolean;
  /** True while the loaded window is being refetched underneath itself. */
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

/** A settled collection, tagged with the exact question it answers. */
interface PageEntry<T> {
  provider: DataProvider;
  resetKey: string;
  rows: T[];
  totalCount: number;
  meta: QueryMeta | null;
  hasMore: boolean;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
}

function emptyEntry<T>(provider: DataProvider, resetKey: string): PageEntry<T> {
  return {
    provider,
    resetKey,
    rows: [],
    totalCount: 0,
    meta: null,
    hasMore: false,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
  };
}

/** What the single in-flight slot is doing. Anything but idle blocks loadMore. */
type Phase = 'idle' | 'initial' | 'refresh' | 'page';

export function usePaginatedRows<T>(args: {
  provider: DataProvider;
  /** False fetches nothing: a collapsed group holds no book. */
  enabled: boolean;
  /** Membership identity: a change resets the collection to its first page. */
  resetKey: string;
  /** Data identity: a change refreshes the loaded window in place. */
  refreshKey: string;
  pageSize: number;
  fetchPage: (page: PageRequest) => Promise<QueryResult<Page<T>>>;
  /** Fallback messages when a rejection carries none. */
  errorFallback: string;
  loadMoreErrorFallback: string;
}): PaginationState<T> {
  const { provider, enabled, resetKey, refreshKey, pageSize } = args;
  const [entry, setEntry] = useState<PageEntry<T>>(() => emptyEntry(provider, resetKey));
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const cursor = useRef<string | undefined>(undefined);
  const phase = useRef<Phase>('idle');
  const lastFailure = useRef<'initial' | 'refresh' | 'page' | null>(null);
  /** Rows currently held, so the effect can size an in-place refresh. */
  const loadedCount = useRef(0);
  const membership = useRef<{
    provider: DataProvider;
    resetKey: string;
    pageSize: number;
    enabled: boolean;
  } | null>(null);
  const fetchPageRef = useRef(args.fetchPage);
  fetchPageRef.current = args.fetchPage;
  const fallbacksRef = useRef({ error: args.errorFallback, more: args.loadMoreErrorFallback });
  fallbacksRef.current = { error: args.errorFallback, more: args.loadMoreErrorFallback };

  useEffect(() => {
    const request = ++latest.current;
    const controller = new AbortController();
    const prev = membership.current;
    const membershipChanged =
      prev === null ||
      prev.provider !== provider ||
      prev.resetKey !== resetKey ||
      prev.pageSize !== pageSize ||
      prev.enabled !== enabled;
    membership.current = { provider, resetKey, pageSize, enabled };

    if (!enabled) {
      cursor.current = undefined;
      phase.current = 'idle';
      lastFailure.current = null;
      loadedCount.current = 0;
      setEntry(emptyEntry(provider, resetKey));
      return () => controller.abort();
    }

    const currentEntry = (): PageEntry<T> => ({
      provider,
      resetKey,
      rows: [],
      totalCount: 0,
      meta: null,
      hasMore: false,
      loading: false,
      refreshing: false,
      loadingMore: false,
      error: null,
    });

    if (membershipChanged || loadedCount.current === 0) {
      // First page of a (new) collection. A stale page from the previous
      // membership is dropped rather than shown under the new question.
      phase.current = 'initial';
      cursor.current = undefined;
      loadedCount.current = 0;
      setEntry({ ...currentEntry(), loading: true });
      fetchPageRef.current({ limit: pageSize }).then(
        (result) => {
          if (controller.signal.aborted || request !== latest.current) return;
          const page = result.data;
          phase.current = 'idle';
          lastFailure.current = null;
          cursor.current = page.nextCursor;
          loadedCount.current = page.rows.length;
          setEntry({
            ...currentEntry(),
            rows: page.rows,
            totalCount: page.totalCount,
            meta: result.meta,
            hasMore: page.nextCursor !== undefined,
          });
        },
        (error: unknown) => {
          if (controller.signal.aborted || request !== latest.current) return;
          phase.current = 'idle';
          lastFailure.current = 'initial';
          setEntry({
            ...currentEntry(),
            error: messageOf(error, fallbacksRef.current.error),
          });
        },
      );
      return () => controller.abort();
    }

    // Same membership, new data: refetch the window already on screen (one
    // request sized to the loaded rows) instead of resetting to page one.
    phase.current = 'refresh';
    setEntry((previous) =>
      previous.provider === provider && previous.resetKey === resetKey
        ? { ...previous, refreshing: true, error: null }
        : previous,
    );
    fetchPageRef.current({ limit: loadedCount.current }).then(
      (result) => {
        if (controller.signal.aborted || request !== latest.current) return;
        const page = result.data;
        phase.current = 'idle';
        lastFailure.current = null;
        cursor.current = page.nextCursor;
        loadedCount.current = page.rows.length;
        setEntry((previous) =>
          previous.provider === provider && previous.resetKey === resetKey
            ? {
                ...previous,
                rows: page.rows,
                totalCount: page.totalCount,
                meta: result.meta,
                hasMore: page.nextCursor !== undefined,
                refreshing: false,
                error: null,
              }
            : previous,
        );
      },
      (error: unknown) => {
        if (controller.signal.aborted || request !== latest.current) return;
        phase.current = 'idle';
        lastFailure.current = 'refresh';
        // A failed refresh keeps the rows already on screen: they still
        // answer the same question, and the error rides alongside them.
        setEntry((previous) =>
          previous.provider === provider && previous.resetKey === resetKey
            ? {
                ...previous,
                refreshing: false,
                error: messageOf(error, fallbacksRef.current.error),
              }
            : previous,
        );
      },
    );
    return () => controller.abort();
  }, [provider, enabled, resetKey, refreshKey, pageSize, attempt]);

  const loadMore = useCallback(() => {
    // Coalescing: one page request per collection at a time. A second call —
    // a double-click, a repeat while a refresh runs — issues no request, so
    // no cursor is ever fetched twice and no rows append twice.
    if (phase.current !== 'idle') return;
    const next = cursor.current;
    const mem = membership.current;
    if (mem === null || !mem.enabled || next === undefined) return;
    const { provider: owner, resetKey: key, pageSize: limit } = mem;
    phase.current = 'page';
    const request = latest.current;
    setEntry((previous) =>
      previous.provider === owner && previous.resetKey === key
        ? { ...previous, loadingMore: true, error: null }
        : previous,
    );
    fetchPageRef.current({ cursor: next, limit }).then(
      (result) => {
        // Superseded by a newer effect: the newer request owns the phase
        // slot, and this answer belongs to a question nobody is asking.
        if (request !== latest.current) return;
        const page = result.data;
        phase.current = 'idle';
        lastFailure.current = null;
        cursor.current = page.nextCursor;
        loadedCount.current += page.rows.length;
        setEntry((previous) =>
          previous.provider === owner && previous.resetKey === key
            ? {
                ...previous,
                rows: [...previous.rows, ...page.rows],
                totalCount: page.totalCount,
                meta: result.meta,
                loadingMore: false,
                hasMore: page.nextCursor !== undefined,
              }
            : previous,
        );
      },
      (error: unknown) => {
        if (request !== latest.current) return;
        phase.current = 'idle';
        lastFailure.current = 'page';
        // The cursor is not advanced, so the failed page is still the next
        // one; the loaded pages stay exactly as they were.
        setEntry((previous) =>
          previous.provider === owner && previous.resetKey === key
            ? {
                ...previous,
                loadingMore: false,
                error: messageOf(error, fallbacksRef.current.more),
              }
            : previous,
        );
      },
    );
  }, []);

  const retry = useCallback(() => {
    if (lastFailure.current === 'page') {
      // Repeat the failed page request only; the loaded pages are still good.
      lastFailure.current = null;
      loadMore();
      return;
    }
    setAttempt((count) => count + 1);
  }, [loadMore]);

  // Read-time gating: rows only exist for the provider and membership they
  // were fetched for. Anything else is a loading state, never a stale page.
  const valid = entry.provider === provider && entry.resetKey === resetKey;
  const shown: PageEntry<T> = !enabled
    ? emptyEntry<T>(provider, resetKey)
    : valid
      ? entry
      : { ...emptyEntry<T>(provider, resetKey), loading: true };

  return {
    rows: shown.rows,
    totalCount: shown.totalCount,
    meta: shown.meta,
    loading: shown.loading,
    refreshing: shown.refreshing,
    loadingMore: shown.loadingMore,
    error: shown.error,
    hasMore: shown.hasMore,
    loadMore,
    retry,
  };
}
