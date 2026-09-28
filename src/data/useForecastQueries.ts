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
 * ids instead of taking the table down.
 */
export function usePartnerNames(provider: DataProvider): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    provider
      .getPartnerDirectory()
      .then((directory) => {
        if (!alive) return;
        setNames(Object.fromEntries(directory.map((partner) => [partner.id, partner.name])));
      })
      .catch(() => {
        // Ids remain a legible fallback; the table is the view's point, not
        // the display name.
      });
    return () => {
      alive = false;
    };
  }, [provider]);

  return names;
}

/** The five aggregate calls the Forecasting view renders. */
export function useForecastAggregates(
  provider: DataProvider,
  scope: ForecastScope,
): ForecastAggregatesState {
  const { quarter, partnerManagerId } = scope;
  const { revenueOverrides, notes, nextSteps, forecastCalls } = scope.edits ?? NO_SESSION_EDITS;

  const [data, setData] = useState<ForecastAggregates | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Answers can arrive out of order when edits land faster than the provider
  // replies. Only the newest request is allowed to write.
  const latest = useRef(0);

  useEffect(() => {
    const request = { id: ++latest.current };
    let alive = true;
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
    ])
      .then(([summary, weighted, quality, groups, weeks]) => {
        if (!alive || request.id !== latest.current) return;
        setData({ summary, weighted, quality, groups, weeks });
        setError(null);
        setRefreshing(false);
      })
      .catch((err: unknown) => {
        if (!alive || request.id !== latest.current) return;
        setError(messageOf(err, 'Failed to load the forecast'));
        setRefreshing(false);
      });

    return () => {
      alive = false;
    };
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

  const [book, setBook] = useState<BookState>(EMPTY_BOOK);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const cursor = useRef<string | undefined>(undefined);

  useEffect(() => {
    // First page whenever the question changes. A stale page from the previous
    // manager is dropped rather than shown under the new header, which is what
    // reusing it would read as.
    if (managerId === null) {
      cursor.current = undefined;
      setBook(EMPTY_BOOK);
      return;
    }
    const request = { id: ++latest.current };
    let alive = true;
    cursor.current = undefined;
    setBook({ ...EMPTY_BOOK, loading: true });

    provider
      .listQuarterOpportunities(
        {
          quarter,
          partnerManagerId: managerId,
          edits: { revenueOverrides, notes, nextSteps, forecastCalls },
        },
        { limit: pageSize },
      )
      .then((page) => {
        if (!alive || request.id !== latest.current) return;
        cursor.current = page.nextCursor;
        setBook({
          rows: page.rows,
          totalCount: page.totalCount,
          loading: false,
          loadingMore: false,
          error: null,
          hasMore: page.nextCursor !== undefined,
        });
      })
      .catch((err: unknown) => {
        if (!alive || request.id !== latest.current) return;
        setBook({ ...EMPTY_BOOK, error: messageOf(err, 'Failed to load this manager’s book') });
      });

    return () => {
      alive = false;
    };
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
    const request = { id: latest.current };
    setBook((prev) => ({ ...prev, loadingMore: true, error: null }));

    provider
      .listQuarterOpportunities(
        {
          quarter,
          partnerManagerId: managerId,
          edits: { revenueOverrides, notes, nextSteps, forecastCalls },
        },
        { cursor: next, limit: pageSize },
      )
      .then((page) => {
        if (request.id !== latest.current) return;
        cursor.current = page.nextCursor;
        setBook((prev) => ({
          ...prev,
          rows: [...prev.rows, ...page.rows],
          totalCount: page.totalCount,
          loadingMore: false,
          hasMore: page.nextCursor !== undefined,
        }));
      })
      .catch((err: unknown) => {
        if (request.id !== latest.current) return;
        setBook((prev) => ({
          ...prev,
          loadingMore: false,
          error: messageOf(err, 'Failed to load more of this book'),
        }));
      });
  }, [provider, quarter, managerId, pageSize, revenueOverrides, notes, nextSteps, forecastCalls]);

  const retry = useCallback(() => setAttempt((count) => count + 1), []);

  return { ...book, loadMore, retry };
}
