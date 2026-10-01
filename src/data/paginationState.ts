import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataProvider, Page, PageRequest } from './DataProvider';
import { MAX_PAGE_LIMIT } from './pagination';
import type { QueryContext } from './queryContext';
import type { QueryMeta, QueryResult } from './queryMetadata';
import { stableFailureCopy } from './queryState';
import type { QueryState } from './queryState';

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
 * - With `rowEdits` set, edit invalidation is *narrow* in every state: an
 *   edit whose target no loaded row contains is not a refresh at all — an
 *   in-flight initial load, page fetch, or window refresh keeps running,
 *   a retained failure keeps its error for the explicit retry, and one
 *   manager's book never refetches because another manager's deal was
 *   edited. The comparison runs against the newest window attempt's edit
 *   values, so an unrelated edit cannot churn a book mid-refresh either.
 *   A relevant edit landing mid-flight is caught when the answer lands: a
 *   stale first page or window is refetched with the edits now current,
 *   and a stale appended page is discarded and re-requested at the same
 *   cursor. A page appended after the edit already carries it, so no later
 *   refresh is owed for that row.
 * - A membership change (provider, business scope, or page size) resets to
 *   the first page: rows fetched under another membership would read as
 *   members of a collection they do not belong to.
 * - Every request's AbortSignal reaches the provider through the query
 *   context, so a superseded initial load, refresh, or page fetch stops
 *   provider-visible work instead of merely being ignored. The aborts are
 *   explicit at supersede time rather than effect cleanups, which is
 *   exactly what lets a skipped edit leave in-flight work running; unmount
 *   aborts whatever is still in flight. Late answers are still dropped by
 *   request sequence and read-time identity gating for providers that
 *   ignore the signal, and an aborted request writes nothing, so aborts
 *   are silent.
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
 * The narrow-invalidation decision for one effect re-run: true only when
 * the run exists because edit values moved (same attempt, same membership,
 * new `refreshKey`) and the edits now current move no loaded row's fetched
 * values. Phase and recorded failures are deliberately absent — the skip
 * holds in every state: in-flight work keeps running, a retained failure
 * keeps the retry it owes, and an edit that only matters to rows still in
 * flight is caught by the land-time drift guard. A retry (the attempt
 * moved) and a StrictMode remount (nothing moved) are not edit-only runs.
 */
function isSkippableEditRun<T>(args: {
  membershipChanged: boolean;
  enabled: boolean;
  tracking: RowEditScope<T> | undefined;
  last: { attempt: number; refreshKey: string } | null;
  attempt: number;
  refreshKey: string;
  loadedRowsStale: (tracking: RowEditScope<T>) => boolean;
}): boolean {
  const { membershipChanged, enabled, tracking, last, attempt, refreshKey } = args;
  if (membershipChanged || !enabled || tracking === undefined) return false;
  if (last === null || last.attempt !== attempt || last.refreshKey === refreshKey) return false;
  return !args.loadedRowsStale(tracking);
}

/**
 * A paginated collection viewed as one query state, for cards that render a
 * single page through the shared `renderQueryState` vocabulary. The marker
 * for "an answer exists" is the first page's metadata: before it lands (or
 * after an initial failure) there is no data — not even an empty array, so
 * a legitimately empty collection can never be mistaken for a missing one.
 * A failed refresh keeps the loaded rows with the error riding alongside,
 * exactly like an aggregate's stale-beats-blank.
 */
export function pageWindowAsQuery<T>(state: PaginationState<T>): QueryState<T[]> {
  return {
    data: state.meta === null ? null : state.rows,
    meta: state.meta,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    retry: state.retry,
  };
}

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
  /**
   * The edit maps the newest *window* attempt issued with. While the fetch
   * runs, this — not the values the retained rows were fetched with — is
   * the bar for whether another window restart would change anything; a
   * failed attempt keeps it too, because the explicit retry owes exactly
   * that question and an unrelated edit must not perform it on the
   * failure's back. A landed window replaces it with the per-row record.
   */
  const pendingWindowMaps = useRef<Record<string, Record<string, string | number>> | null>(null);
  /**
   * The controller of the latest window attempt, settled or not, so a
   * superseding run or an unmount can cancel it at the seam. Aborts are
   * explicit here rather than effect cleanups — precisely so a skipped
   * edit-only re-run leaves in-flight work and its signal untouched.
   */
  const windowRequest = useRef<AbortController | null>(null);
  /** The controller of a page fetch in flight, if one is. */
  const pageRequest = useRef<AbortController | null>(null);
  /**
   * What the effect last ran for, so the next re-run can tell an edit-only
   * bump (same attempt, new edit values) from a retry (the attempt moved),
   * a membership change, or a StrictMode remount (nothing moved).
   */
  const lastRun = useRef<{ attempt: number; refreshKey: string } | null>(null);
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

  /** True when an edit moved a value a loaded row was — or is being — fetched with. */
  function loadedRowsStale(tracking: RowEditScope<T>): boolean {
    const pending = pendingWindowMaps.current;
    for (const [id, applied] of appliedEdits.current) {
      // While a window fetch runs, its edit values are the baseline: the
      // rows on screen are about to be replaced by rows carrying them.
      const baseline = pending === null ? applied : rowEditKey(id, pending);
      if (rowEditKey(id, tracking.maps) !== baseline) return true;
    }
    return false;
  }

  /**
   * Land-time guard: a fetch that started before an edit landed carries the
   * older values, so when the maps now current moved any of the rows it is
   * bringing back, its answer is stale before it lands. Edits to other rows
   * — another manager's book, a page beyond the window — move nothing here.
   */
  function rowsDrifted(fetched: readonly T[], tracking: RowEditScope<T>): boolean {
    const current = rowEditsRef.current;
    if (current === undefined) return false;
    for (const row of fetched) {
      const id = tracking.idOf(row);
      if (rowEditKey(id, tracking.maps) !== rowEditKey(id, current.maps)) return true;
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

    // Narrowed invalidation: an edit-only re-run that moves no loaded row's
    // fetched values asks for nothing — in any state.
    const tracking = rowEditsRef.current;
    const last = lastRun.current;
    lastRun.current = { attempt, refreshKey };
    if (
      isSkippableEditRun({
        membershipChanged,
        enabled,
        tracking,
        last,
        attempt,
        refreshKey,
        loadedRowsStale,
      })
    ) {
      return undefined;
    }

    const request = ++latest.current;
    const controller = new AbortController();
    // This run supersedes the previous window attempt and any page fetch
    // still in flight — that page's answer belongs to a window this run is
    // about to replace. The aborts are explicit rather than effect
    // cleanups, which is exactly what lets the skipped run above leave
    // in-flight work — and its signal — untouched.
    windowRequest.current?.abort();
    windowRequest.current = null;
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
      pendingWindowMaps.current = null;
      setEntry(emptyEntry(provider, resetKey));
      return undefined;
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
      pendingWindowMaps.current = null;
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
      pendingWindowMaps.current = fetchTracking?.maps ?? null;
      windowRequest.current = controller;
      fetchPageRef.current({ limit: pageSize }, { signal: controller.signal }).then(
        (result) => {
          if (controller.signal.aborted || request !== latest.current) return;
          if (fetchTracking !== undefined && rowsDrifted(result.data.rows, fetchTracking)) {
            // The edits this page was fetched under moved while it flew:
            // its answer is stale before it lands. Drop it and re-ask the
            // first page with the values now current.
            phase.current = 'idle';
            pendingWindowMaps.current = null;
            setAttempt((count) => count + 1);
            return;
          }
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
      return undefined;
    }

    // Same membership, new data: refetch the window already on screen
    // (bounded pages covering the loaded rows) instead of resetting to
    // page one.
    phase.current = 'refresh';
    pendingWindowMaps.current = fetchTracking?.maps ?? null;
    windowRequest.current = controller;
    setEntry((previous) =>
      previous.provider === provider && previous.resetKey === resetKey
        ? // A page fetch this run just superseded is gone: its spinner goes
          // with it, whatever its late answer does.
          { ...previous, refreshing: true, loadingMore: false, error: null }
        : previous,
    );
    fetchWindowPages(fetchPageRef.current, loadedCount.current, controller.signal).then(
      (result) => {
        if (controller.signal.aborted || request !== latest.current) return;
        if (fetchTracking !== undefined && rowsDrifted(result.data.rows, fetchTracking)) {
          // The edits this window was fetched under moved while it flew:
          // its answer is stale before it lands. Refetch the window with
          // the values now current.
          phase.current = 'idle';
          pendingWindowMaps.current = null;
          setAttempt((count) => count + 1);
          return;
        }
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
    return undefined;
  }, [provider, enabled, resetKey, refreshKey, pageSize, attempt]);

  // Unmount cancels whatever is still running — the window attempt and any
  // page fetch. This sits in its own effect because a narrowed no-op run
  // aborts nothing of its own, and an abandoned request must never outlive
  // the collection.
  useEffect(
    () => () => {
      windowRequest.current?.abort();
      windowRequest.current = null;
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
        if (tracking !== undefined && rowsDrifted(page.rows, tracking)) {
          // An edit moved values inside this page while it flew: the answer
          // is stale before it lands. Drop it and re-ask the same cursor —
          // cursors name positions, not edit values — with the maps now
          // current, instead of appending rows nobody asked for.
          phase.current = 'idle';
          setEntry((previous) =>
            previous.provider === owner && previous.resetKey === key
              ? { ...previous, loadingMore: false }
              : previous,
          );
          loadMore();
          return;
        }
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
