import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DataProvider,
  ForecastQualitySummary,
  ForecastScope,
  ForecastSummary,
  ManagerForecastGroup,
  WeeklySeriesRow,
  WeightedForecastSummary,
} from './DataProvider';
import { NO_SESSION_EDITS } from './sessionEdits';
import type { Opportunity } from './types';

/**
 * The Forecasting view's data, fetched the way it will be fetched in
 * production: a handful of aggregates plus one page of rows, each with its own
 * loading and error state, instead of one `Promise.all` that blanks the page
 * when any single call is slow.
 *
 * The dependency lists deliberately name the *values* a query depends on —
 * the quarter, the manager, and each edit map — rather than the scope object.
 * A scope rebuilt on every render is a new object every time, and an effect
 * keyed on it refetches in a loop: render, fetch, setState, render again.
 * Depending on the maps means an edit refetches, and a re-render that changed
 * nothing does not.
 *
 * Race safety: every result is tagged with the provider (and, for a manager
 * book, the manager) that produced it, and is only exposed while that identity
 * is still the one being asked. Cleanup aborts an AbortController each request
 * carries; the seam cannot be cancelled mid-flight yet, so the sequence guard
 * and the identity tag are what make a late answer from a superseded provider
 * or scope a no-op. Old data can therefore never render under a new provider —
 * not even for the frame before an effect re-runs, because the tag is checked
 * at read time, during render.
 */

/** How many mismatching deals the forecast-quality card shows per side. */
const MISMATCH_SAMPLE_SIZE = 3;

/** Rows per page of one manager's book. */
const MANAGER_BOOK_PAGE_SIZE = 25;

interface ForecastAggregates {
  summary: ForecastSummary;
  weighted: WeightedForecastSummary;
  quality: ForecastQualitySummary;
  groups: ManagerForecastGroup[];
  weeks: WeeklySeriesRow[];
}

export interface ForecastAggregatesState {
  data: ForecastAggregates | null;
  /** True only until the first answer arrives. */
  loading: boolean;
  /** True while a later answer is in flight over figures already on screen. */
  refreshing: boolean;
  error: string | null;
  retry: () => void;
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Partner id to name, for rendering a row's partner column.
 *
 * A dimension lookup rather than data: it does not move when the forecast
 * does, so it is fetched once and a failure degrades to showing raw partner
 * ids instead of taking the table down. On a provider switch the previous
 * provider's names are dropped immediately — a name from another directory is
 * a cross-source label — and the table falls back to ids until the new
 * directory arrives.
 */
export function usePartnerNames(provider: DataProvider): Record<string, string> {
  const [entry, setEntry] = useState<{
    provider: DataProvider;
    names: Record<string, string>;
  } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    provider.getPartnerDirectory().then(
      (directory) => {
        if (controller.signal.aborted) return;
        setEntry({
          provider,
          names: Object.fromEntries(directory.map((partner) => [partner.id, partner.name])),
        });
      },
      () => {
        // Ids remain a legible fallback; the table is the view's point, not
        // the display name.
      },
    );
    return () => controller.abort();
  }, [provider]);

  return entry !== null && entry.provider === provider ? entry.names : {};
}

/** The five aggregate calls the Forecasting view renders. */
export function useForecastAggregates(
  provider: DataProvider,
  scope: ForecastScope,
): ForecastAggregatesState {
  const { quarter, partnerManagerId } = scope;
  const { revenueOverrides, notes, nextSteps, forecastCalls } = scope.edits ?? NO_SESSION_EDITS;

  const [result, setResult] = useState<{
    provider: DataProvider;
    data: ForecastAggregates | null;
    error: string | null;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [attempt, setAttempt] = useState(0);
  // Answers can arrive out of order when edits land faster than the provider
  // replies. Only the newest request is allowed to write.
  const latest = useRef(0);

  useEffect(() => {
    const request = ++latest.current;
    const controller = new AbortController();
    // The aggregates are always quarter-level: a manager filter narrows the
    // rows below, not the forecast.
    const requestScope: ForecastScope = {
      quarter,
      edits: { revenueOverrides, notes, nextSteps, forecastCalls },
    };

    setRefreshing(true);
    Promise.all([
      provider.getForecastSummary(requestScope),
      provider.getWeightedForecast(requestScope),
      provider.getForecastQuality(requestScope, MISMATCH_SAMPLE_SIZE),
      provider.getManagerForecastGroups(requestScope),
      provider.getWeeklyForecastSeries(requestScope),
    ]).then(
      ([summary, weighted, quality, groups, weeks]) => {
        if (controller.signal.aborted || request !== latest.current) return;
        setResult({ provider, data: { summary, weighted, quality, groups, weeks }, error: null });
        setRefreshing(false);
      },
      (err: unknown) => {
        if (controller.signal.aborted || request !== latest.current) return;
        // Stale beats blank: a failed refresh keeps the figures already on
        // screen (they still answer the current question — same provider,
        // same quarter) and reports the error alongside them. Only an
        // initial failure leaves data null.
        setResult((prev) => ({
          provider,
          data: prev !== null && prev.provider === provider ? prev.data : null,
          error: messageOf(err, 'Failed to load the forecast'),
        }));
        setRefreshing(false);
      },
    );

    return () => controller.abort();
  }, [
    provider,
    quarter,
    partnerManagerId,
    revenueOverrides,
    notes,
    nextSteps,
    forecastCalls,
    attempt,
  ]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  const current = result !== null && result.provider === provider ? result : null;
  const data = current?.data ?? null;
  const error = current?.error ?? null;
  return { data, loading: data === null && error === null, refreshing, error, retry };
}

export interface ManagerBookState {
  rows: Opportunity[];
  /** Rows matching the manager's scope in total, not the pages fetched. */
  totalCount: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

type BookState = Omit<ManagerBookState, 'loadMore' | 'retry'>;

const EMPTY_BOOK: BookState = {
  rows: [],
  totalCount: 0,
  loading: false,
  loadingMore: false,
  error: null,
  hasMore: false,
};

/** A settled book, tagged with the exact question it answers. */
interface BookEntry {
  provider: DataProvider;
  managerId: string | null;
  book: BookState;
}

/**
 * One manager's in-quarter book, a page at a time. Pass `null` for a manager
 * who has no group open: nothing is fetched until a group is expanded.
 */
export function useManagerBook(
  provider: DataProvider,
  scope: ForecastScope,
  managerId: string | null,
  pageSize: number = MANAGER_BOOK_PAGE_SIZE,
): ManagerBookState {
  const { quarter } = scope;
  const { revenueOverrides, notes, nextSteps, forecastCalls } = scope.edits ?? NO_SESSION_EDITS;

  const [entry, setEntry] = useState<BookEntry>({ provider, managerId, book: EMPTY_BOOK });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const cursor = useRef<string | undefined>(undefined);

  useEffect(() => {
    // First page whenever the question changes. A stale page from the previous
    // manager is dropped rather than shown under the new header, which is what
    // reusing it would read as.
    if (managerId === null) {
      cursor.current = undefined;
      setEntry({ provider, managerId, book: EMPTY_BOOK });
      return;
    }
    const request = ++latest.current;
    const controller = new AbortController();
    cursor.current = undefined;
    setEntry({ provider, managerId, book: { ...EMPTY_BOOK, loading: true } });

    provider
      .listQuarterOpportunities(
        {
          quarter,
          partnerManagerId: managerId,
          edits: { revenueOverrides, notes, nextSteps, forecastCalls },
        },
        { limit: pageSize },
      )
      .then(
        (page) => {
          if (controller.signal.aborted || request !== latest.current) return;
          cursor.current = page.nextCursor;
          setEntry({
            provider,
            managerId,
            book: {
              rows: page.rows,
              totalCount: page.totalCount,
              loading: false,
              loadingMore: false,
              error: null,
              hasMore: page.nextCursor !== undefined,
            },
          });
        },
        (err: unknown) => {
          if (controller.signal.aborted || request !== latest.current) return;
          setEntry({
            provider,
            managerId,
            book: {
              ...EMPTY_BOOK,
              error: messageOf(err, 'Failed to load this manager’s book'),
            },
          });
        },
      );

    return () => controller.abort();
  }, [
    provider,
    quarter,
    managerId,
    pageSize,
    revenueOverrides,
    notes,
    nextSteps,
    forecastCalls,
    attempt,
  ]);

  const loadMore = useCallback(() => {
    const next = cursor.current;
    if (managerId === null || next === undefined) return;
    const request = latest.current;
    setEntry((prev) =>
      prev.provider === provider && prev.managerId === managerId
        ? { ...prev, book: { ...prev.book, loadingMore: true, error: null } }
        : prev,
    );

    provider
      .listQuarterOpportunities(
        {
          quarter,
          partnerManagerId: managerId,
          edits: { revenueOverrides, notes, nextSteps, forecastCalls },
        },
        { cursor: next, limit: pageSize },
      )
      .then(
        (page) => {
          if (request !== latest.current) return;
          cursor.current = page.nextCursor;
          setEntry((prev) =>
            prev.provider === provider && prev.managerId === managerId
              ? {
                  ...prev,
                  book: {
                    ...prev.book,
                    rows: [...prev.book.rows, ...page.rows],
                    totalCount: page.totalCount,
                    loadingMore: false,
                    hasMore: page.nextCursor !== undefined,
                  },
                }
              : prev,
          );
        },
        (err: unknown) => {
          if (request !== latest.current) return;
          setEntry((prev) =>
            prev.provider === provider && prev.managerId === managerId
              ? {
                  ...prev,
                  book: {
                    ...prev.book,
                    loadingMore: false,
                    error: messageOf(err, 'Failed to load more of this book'),
                  },
                }
              : prev,
          );
        },
      );
  }, [provider, quarter, managerId, pageSize, revenueOverrides, notes, nextSteps, forecastCalls]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  // Read-time gating: rows only exist for the provider and manager they were
  // fetched for. Anything else is a loading state, never a stale page.
  const book =
    entry.provider === provider && entry.managerId === managerId
      ? entry.book
      : managerId === null
        ? EMPTY_BOOK
        : { ...EMPTY_BOOK, loading: true };

  return { ...book, loadMore, retry };
}
