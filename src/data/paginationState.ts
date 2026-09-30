import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataProvider, Page, PageRequest } from './DataProvider';
import { MAX_PAGE_LIMIT } from './pagination';
import type { QueryContext } from './queryContext';
import type { QueryMeta, QueryResult } from './queryMetadata';
import { stableFailureCopy } from './queryState';

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
 *   collection) refetches the loaded window in place — a chain of bounded
 *   page requests covering the rows on screen — instead of resetting to the
 *   first page. A failed window refresh keeps the loaded rows and reports
 *   the error alongside.
 * - With `rowEdits` set, that window refresh is also *narrow*: an edit whose
 *   target no loaded row contains is not a refresh at all, so one manager's
 *   book does not refetch because another manager's deal was edited. A page
 *   appended after the edit already carries it, so no later refresh is owed
 *   for that row either.
 * - A membership change (provider, business scope, or page size) resets to
 *   the first page: rows fetched under another membership would read as
 *   members of a collection they do not belong to.
 * - Every request's AbortSignal reaches the provider through the query
 *   context, so a superseded initial load, refresh, or page fetch stops
 *   provider-visible work instead of merely being ignored. Late answers are
 *   still dropped by request sequence and read-time identity gating for
 *   providers that ignore the signal, and an aborted request writes nothing,
 *   so aborts are silent.
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

/**
 * Per-row edit tracking, for collections whose rows a session edit can move.
 *
 * The hook records which edit values each loaded row was fetched with; a
 * change to an entry whose id no loaded row contains then does not count as
 * a refresh trigger. That is what keeps edit invalidation exact when several
 * collections are open at once: each collection answers "do my rows care?"
 * for itself.
 */
export interface RowEditScope<T> {
  /**
   * The edit maps a refresh depends on, keyed by row id under a stable label
   * (the manager book passes `rev` revenue overrides and `call` forecast
   * calls). Maps that cannot move a row's fetched values — notes, next
   * steps — are absent by construction.
   */
  maps: Record<string, Record<string, string | number>>;
  /** A row's identity, matching the keys of `maps`. */
  idOf: (row: T) => string;
}

/** One row's relevant edits, serialized; '' when no map touches the row. */
function rowEditKey(id: string, maps: Record<string, Record<string, string | number>>): string {
  return Object.keys(maps)
    .sort()
    .filter((name) => id in maps[name])
    .map((name) => `${name}=${String(maps[name][id])}`)
    .join('&');
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

/**
 * Refetches the rows on screen as a chain of bounded pages. One oversized
 * request would be the natural idea — and a typed error at the seam once
 * the loaded window outgrows the maximum page size, so the window is walked
 * a page at a time instead. Every chunk carries the same abort signal, and
 * the final answer keeps the first chunk's total and the last chunk's
 * continuation cursor, which is exactly the cursor `loadMore` needs next.
 */
async function fetchWindowPages<T>(
  fetchPage: (page: PageRequest, context: QueryContext) => Promise<QueryResult<Page<T>>>,
  targetCount: number,
  signal: AbortSignal,
): Promise<QueryResult<Page<T>>> {
  const first = await fetchPage({ limit: Math.min(targetCount, MAX_PAGE_LIMIT) }, { signal });
  const rows = [...first.data.rows];
  let nextCursor = first.data.nextCursor;
  while (rows.length < targetCount && nextCursor !== undefined) {
    const next = await fetchPage(
      { cursor: nextCursor, limit: Math.min(targetCount - rows.length, MAX_PAGE_LIMIT) },
      { signal },
    );
    rows.push(...next.data.rows);
    nextCursor = next.data.nextCursor;
  }
  return {
    data: {
      rows,
      totalCount: first.data.totalCount,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    },
    meta: first.meta,
  };
}

export function usePaginatedRows<T>(args: {
  provider: DataProvider;
  /** False fetches nothing: a collapsed group holds no book. */
  enabled: boolean;
  /** Membership identity: a change resets the collection to its first page. */
  resetKey: string;
  /** Data identity: a change refreshes the loaded window in place. */
  refreshKey: string;
  pageSize: number;
  /**
   * One page request. The context carries the attempt's AbortSignal —
   * forward it to the provider so obsolete work is cancelled, not just
   * ignored.
   */
  fetchPage: (page: PageRequest, context: QueryContext) => Promise<QueryResult<Page<T>>>;
  /**
   * Narrows `refreshKey` refreshes to edits that touch a loaded row. Omit it
   * and every `refreshKey` change refreshes, which is the right default for
   * collections without per-row edit maps.
   */
  rowEdits?: RowEditScope<T>;
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
  /** The edit values each loaded row was fetched with, by row id. */
  const appliedEdits = useRef(new Map<string, string>());
  /** The controller of a page fetch in flight, if one is. */
  const pageRequest = useRef<AbortController | null>(null);
  const membership = useRef<{
    provider: DataProvider;
    resetKey: string;
    pageSize: number;
    enabled: boolean;
  } | null>(null);
  const fetchPageRef = useRef(args.fetchPage);
  fetchPageRef.current = args.fetchPage;
  const rowEditsRef = useRef(args.rowEdits);
  rowEditsRef.current = args.rowEdits;
  const fallbacksRef = useRef({ error: args.errorFallback, more: args.loadMoreErrorFallback });
  fallbacksRef.current = { error: args.errorFallback, more: args.loadMoreErrorFallback };

  /** The edit values freshly landed rows carry, remembered per row id. */
  function recordApplied(rows: T[], tracking: RowEditScope<T> | undefined, replace: boolean): void {
    if (replace) appliedEdits.current.clear();
    if (tracking === undefined) return;
    for (const row of rows) {
      const id = tracking.idOf(row);
      appliedEdits.current.set(id, rowEditKey(id, tracking.maps));
    }
  }

  /** True when an edit moved a value a loaded row was fetched with. */
  function loadedRowsStale(tracking: RowEditScope<T>): boolean {
    for (const [id, applied] of appliedEdits.current) {
      if (rowEditKey(id, tracking.maps) !== applied) return true;
    }
    return false;
  }

  useEffect(() => {
    const prev = membership.current;
    const membershipChanged =
      prev === null ||
      prev.provider !== provider ||
      prev.resetKey !== resetKey ||
      prev.pageSize !== pageSize ||
      prev.enabled !== enabled;
    membership.current = { provider, resetKey, pageSize, enabled };

    // Narrowed invalidation: an edit-only re-run that changes no loaded
    // row's applied edits asks for nothing. Only an idle, healthy collection
    // may skip — an in-flight window fetch carries older edits and must be
    // replaced, a page fetch in flight must give way to the refresh, and a
    // recorded failure owes its retry.
    const tracking = rowEditsRef.current;
    if (
      !membershipChanged &&
      enabled &&
      tracking !== undefined &&
      phase.current === 'idle' &&
      lastFailure.current === null &&
      loadedRowsStale(tracking) === false
    ) {
      return undefined;
    }

    const request = ++latest.current;
    const controller = new AbortController();
    // A window fetch supersedes a page fetch still in flight: its answer
    // belongs to a window this run is about to replace.
    pageRequest.current?.abort();
    pageRequest.current = null;
    // The edit values this run's fetch applies, recorded when it lands.
    const fetchTracking = rowEditsRef.current;

    if (!enabled) {
      cursor.current = undefined;
      phase.current = 'idle';
      lastFailure.current = null;
      loadedCount.current = 0;
      appliedEdits.current.clear();
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

    // Both window fetches land through the same bookkeeping once their
    // guards pass: the page becomes the collection.
    const acceptPage = (result: QueryResult<Page<T>>): Page<T> => {
      const page = result.data;
      phase.current = 'idle';
      lastFailure.current = null;
      cursor.current = page.nextCursor;
      loadedCount.current = page.rows.length;
      recordApplied(page.rows, fetchTracking, true);
      return page;
    };

    if (membershipChanged || loadedCount.current === 0) {
      // First page of a (new) collection. A stale page from the previous
      // membership is dropped rather than shown under the new question.
      phase.current = 'initial';
      cursor.current = undefined;
      loadedCount.current = 0;
      appliedEdits.current.clear();
      setEntry({ ...currentEntry(), loading: true });
      fetchPageRef.current({ limit: pageSize }, { signal: controller.signal }).then(
        (result) => {
          if (controller.signal.aborted || request !== latest.current) return;
          const page = acceptPage(result);
          setEntry({
            ...currentEntry(),
            rows: page.rows,
            totalCount: page.totalCount,
            meta: result.meta,
            hasMore: page.nextCursor !== undefined,
          });
        },
        () => {
          if (controller.signal.aborted || request !== latest.current) return;
          phase.current = 'idle';
          lastFailure.current = 'initial';
          setEntry({
            ...currentEntry(),
            error: stableFailureCopy(fallbacksRef.current.error),
          });
        },
      );
      return () => controller.abort();
    }

    // Same membership, new data: refetch the window already on screen
    // (bounded pages covering the loaded rows) instead of resetting to
    // page one.
    phase.current = 'refresh';
    setEntry((previous) =>
      previous.provider === provider && previous.resetKey === resetKey
        ? { ...previous, refreshing: true, error: null }
        : previous,
    );
    fetchWindowPages(fetchPageRef.current, loadedCount.current, controller.signal).then(
      (result) => {
        if (controller.signal.aborted || request !== latest.current) return;
        const page = acceptPage(result);
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
      () => {
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
                error: stableFailureCopy(fallbacksRef.current.error),
              }
            : previous,
        );
      },
    );
    return () => controller.abort();
  }, [provider, enabled, resetKey, refreshKey, pageSize, attempt]);

  // Unmount cancels a page fetch still in flight. This sits in its own
  // effect because a narrowed no-op run registers no cleanup of its own, and
  // an abandoned page fetch must never outlive the collection.
  useEffect(
    () => () => {
      pageRequest.current?.abort();
      pageRequest.current = null;
    },
    [],
  );

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
    const controller = new AbortController();
    pageRequest.current = controller;
    // The edit values this page's fetch applies, recorded when it lands:
    // rows appended after an edit already carry it and owe no refresh.
    const tracking = rowEditsRef.current;
    setEntry((previous) =>
      previous.provider === owner && previous.resetKey === key
        ? { ...previous, loadingMore: true, error: null }
        : previous,
    );
    fetchPageRef.current({ cursor: next, limit }, { signal: controller.signal }).then(
      (result) => {
        // Superseded by a newer effect: the newer request owns the phase
        // slot, and this answer belongs to a question nobody is asking.
        if (controller.signal.aborted || request !== latest.current) return;
        const page = result.data;
        phase.current = 'idle';
        lastFailure.current = null;
        cursor.current = page.nextCursor;
        loadedCount.current += page.rows.length;
        recordApplied(page.rows, tracking, false);
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
      () => {
        if (controller.signal.aborted || request !== latest.current) return;
        phase.current = 'idle';
        lastFailure.current = 'page';
        // The cursor is not advanced, so the failed page is still the next
        // one; the loaded pages stay exactly as they were.
        setEntry((previous) =>
          previous.provider === owner && previous.resetKey === key
            ? {
                ...previous,
                loadingMore: false,
                error: stableFailureCopy(fallbacksRef.current.more),
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
