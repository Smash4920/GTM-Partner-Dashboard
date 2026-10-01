import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { INTERNAL_DEMO_SCOPE } from './accessScope';
import { DATA_PROVIDER_METHODS } from './DataProvider';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { createSimulatedRemoteProvider } from './mock/createSimulatedRemoteProvider';
import { useActivityQueries } from './useActivityQueries';
import { EMPTY_DIRECTORY_COPY } from './useActivityQueries';
import type { ActivityQueryInput } from './useActivityQueries';
import { SNAPSHOT_DATE } from './constants';
import { startOfWeekUtc } from '../lib/fiscal';
import { weeklyActivity, weeklyGoalProgress } from '../lib/metrics';
import { makeMeeting, makePartner, makeProviderBook } from '../test/fixtures';
import type { MeetingClassification } from './types';
import type { ProviderBook } from './mock/book';

/**
 * VAL-DATA-015 (Activity Tracking): the route requests exactly the scoped
 * activity aggregates and the bounded classification inputs it renders —
 * goal, manager-wide week, partner-scoped series, and one cursor-paginated
 * week of calendar meetings — with the manager/partner selection as a
 * provider input. Session classifications and prospects ride along with the
 * queries and are applied once, behind the seam; every query fails and
 * retries independently of its siblings.
 */

/** A provider that records which contract methods were called, in order. */
function spyProvider(inner: DataProvider): { provider: DataProvider; calls: string[] } {
  const calls: string[] = [];
  const watched = new Set<string>(DATA_PROVIDER_METHODS);
  const provider = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof property !== 'string' || typeof value !== 'function' || !watched.has(property)) {
        return value;
      }
      return (...args: unknown[]) => {
        calls.push(property);
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });
  return { provider, calls };
}

const WEEK_START = startOfWeekUtc(SNAPSHOT_DATE);
const DAY = 86_400_000;

/** An instant `day` days into the snapshot's week, at `hour` UTC. */
function at(day: number, hour: number): string {
  return new Date(WEEK_START.getTime() + day * DAY + hour * 3_600_000).toISOString();
}

/**
 * Two managers with disjoint books. pm-1 has two calls this week (one
 * discovery, one PIO interlock) and one the week before; pm-2 has one call
 * this week. partner-4 sits on pm-1's roster with no calls at all.
 */
function makeBook(): ProviderBook {
  return makeProviderBook({
    partnerManagers: [
      { id: 'pm-1', name: 'J. Alvarez' },
      { id: 'pm-2', name: 'R. Diaz' },
    ],
    partners: [
      makePartner({ id: 'partner-1', name: 'Northwind Systems', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-2', name: 'Beacon Consulting', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-4', name: 'Delta Labs', partnerManagerId: 'pm-1' }),
      makePartner({ id: 'partner-3', name: 'Cobalt Group', partnerManagerId: 'pm-2' }),
    ],
    activities: [
      makeMeeting({
        id: 'meeting-mon',
        partnerId: 'partner-1',
        occurredAt: at(0, 15),
        type: 'discovery',
      }),
      makeMeeting({
        id: 'meeting-tue',
        partnerId: 'partner-2',
        occurredAt: at(1, 9),
        type: 'pio-interlock',
      }),
      // The week before the snapshot week: inside the chart, outside the goal.
      makeMeeting({
        id: 'meeting-prior',
        partnerId: 'partner-1',
        occurredAt: at(-6, 10),
        type: 'deal-support',
      }),
      makeMeeting({
        id: 'meeting-other',
        partnerId: 'partner-3',
        partnerManagerId: 'pm-2',
        occurredAt: at(2, 11),
        type: 'discovery',
      }),
    ],
    registrations: [],
    opportunities: [],
    targets: [],
    certifications: [],
  });
}

function inputFor(
  provider: DataProvider,
  overrides: Partial<ActivityQueryInput> = {},
): ActivityQueryInput {
  return {
    provider,
    access: INTERNAL_DEMO_SCOPE,
    managerId: 'pm-1',
    partnerId: 'all',
    classifications: {},
    prospects: [],
    ...overrides,
  };
}

/** Waits until every Activity Tracking query has settled with an answer. */
async function settle(result: { current: ReturnType<typeof useActivityQueries> }) {
  await waitFor(() => {
    expect(result.current.managers.data).not.toBeNull();
    expect(result.current.roster.data).not.toBeNull();
    expect(result.current.goal.data).not.toBeNull();
    expect(result.current.goalWeek.data).not.toBeNull();
    expect(result.current.series.data).not.toBeNull();
    expect(result.current.meetings.meta).not.toBeNull();
  });
}

describe('useActivityQueries (VAL-DATA-015)', () => {
  it('requests exactly its scoped queries — aggregates, directories, and one bounded page', async () => {
    const { provider, calls } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    expect([...new Set(calls)].sort()).toEqual([
      'getManagerDirectory',
      'getPartnerRoster',
      'getWeeklyActivitySeries',
      'getWeeklyGoalProgress',
      'listWeeklyClassificationMeetings',
    ]);
    // The classification calendar is one bounded page request.
    expect(calls.filter((method) => method === 'listWeeklyClassificationMeetings')).toHaveLength(1);
    expect(result.current.meetings.rows.length).toBeLessThanOrEqual(25);
  });

  it('answers with the aggregates the metrics layer computes for the manager', async () => {
    const book = makeBook();
    const { provider } = spyProvider(new MockDataProvider(book));
    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider),
    });
    await settle(result);

    expect(result.current.goal.data).toEqual(weeklyGoalProgress(book.activities, {}, 'pm-1'));
    // Hand-computed, so the comparison cannot be vacuous: two calls this
    // week, one of them a PIO interlock.
    expect(result.current.goal.data!.meetings).toBe(2);
    expect(result.current.goal.data!.pioMeetings).toBe(1);

    const expectedSeries = weeklyActivity(book.activities, 'pm-1', undefined, {});
    expect(result.current.series.data).toEqual(expectedSeries);
    expect(result.current.goalWeek.data).toEqual(expectedSeries);
    // The chart spans eight weeks, so the prior-week call is in scope
    // without counting toward this week's goal.
    expect(expectedSeries.reduce((sum, row) => sum + row.total, 0)).toBe(3);

    // The classification calendar holds exactly this week's two calls,
    // oldest first, and none of the other manager's.
    expect(result.current.meetings.rows.map((row) => row.id)).toEqual([
      'meeting-mon',
      'meeting-tue',
    ]);
    expect(result.current.meetings.totalCount).toBe(2);
    expect(result.current.meetings.hasMore).toBe(false);
  });

  it('re-scopes only the volume chart when the partner filter moves', async () => {
    const book = makeBook();
    const { provider, calls } = spyProvider(new MockDataProvider(book));
    const { result, rerender } = renderHook(
      (input: ActivityQueryInput) => useActivityQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    rerender(inputFor(provider, { partnerId: 'partner-1' }));
    await waitFor(() =>
      expect(result.current.series.data!.reduce((sum, row) => sum + row.total, 0)).toBe(2),
    );
    expect(result.current.series.data).toEqual(
      weeklyActivity(book.activities, 'pm-1', new Set(['partner-1']), {}),
    );

    // The goal belongs to the manager, so neither goal answer refetched, and
    // the calendar the modal classifies is the manager's, unchanged.
    expect(result.current.goal.data!.meetings).toBe(2);
    expect(calls.filter((method) => method === 'getWeeklyGoalProgress')).toHaveLength(1);
    expect(calls.filter((method) => method === 'listWeeklyClassificationMeetings')).toHaveLength(1);
    // goalWeek (all) and series (partner-1) are different scopes: three
    // series calls in total — initial pair plus the re-scoped chart.
    expect(calls.filter((method) => method === 'getWeeklyActivitySeries')).toHaveLength(3);

    // A roster partner with no calls is a real, empty scope.
    rerender(inputFor(provider, { partnerId: 'partner-4' }));
    await waitFor(() =>
      expect(result.current.series.data!.reduce((sum, row) => sum + row.total, 0)).toBe(0),
    );
  });

  it('re-scopes every manager query when the manager changes', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: ActivityQueryInput) => useActivityQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    rerender(inputFor(provider, { managerId: 'pm-2' }));
    await waitFor(() => expect(result.current.goal.data!.meetings).toBe(1));

    expect(result.current.series.data!.reduce((sum, row) => sum + row.total, 0)).toBe(1);
    expect(result.current.meetings.rows.map((row) => row.id)).toEqual(['meeting-other']);
    expect(result.current.meetings.totalCount).toBe(1);
  });

  it('applies a classification commit once, to exactly the three aggregates', async () => {
    const book = makeBook();
    const { provider, calls } = spyProvider(new MockDataProvider(book));
    const { result, rerender } = renderHook(
      (input: ActivityQueryInput) => useActivityQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    const classifications: Record<string, MeetingClassification> = {
      // The PIO interlock re-typed as deal support: the pio bar moves.
      'meeting-tue': { partnerId: 'partner-2', type: 'deal-support' },
    };
    rerender(inputFor(provider, { classifications }));
    await waitFor(() => expect(result.current.goal.data!.pioMeetings).toBe(0));

    expect(result.current.goal.data!.meetings).toBe(2);
    expect(result.current.goalWeek.data).toEqual(
      weeklyActivity(book.activities, 'pm-1', undefined, classifications),
    );
    expect(result.current.series.data).toEqual(result.current.goalWeek.data);

    // One refetch per classification-reading aggregate, and none for the
    // directories or the raw calendar.
    expect(calls.filter((method) => method === 'getWeeklyGoalProgress')).toHaveLength(2);
    expect(calls.filter((method) => method === 'getWeeklyActivitySeries')).toHaveLength(4);
    expect(calls.filter((method) => method === 'listWeeklyClassificationMeetings')).toHaveLength(1);
    expect(calls.filter((method) => method === 'getManagerDirectory')).toHaveLength(1);
  });

  it('applies a prospect classification once, through the provider', async () => {
    const book = makeBook();
    const { provider } = spyProvider(new MockDataProvider(book));
    const prospects = [
      makePartner({ id: 'prospect-1', name: 'Prospect Co', partnerManagerId: 'pm-1' }),
    ];
    const classifications: Record<string, MeetingClassification> = {
      // Monday's call re-pointed at the prospect the session just added.
      'meeting-mon': { partnerId: 'prospect-1', type: 'discovery' },
    };
    const { result, rerender } = renderHook(
      (input: ActivityQueryInput) => useActivityQueries(input),
      { initialProps: inputFor(provider, { classifications, prospects }) },
    );
    await settle(result);

    // Manager-wide: the call still counts — once — toward the manager's goal.
    expect(result.current.goal.data!.meetings).toBe(2);

    // Under the prospect's own filter the re-pointed call appears, and it
    // leaves the original partner's scope: one meeting each, never two.
    rerender(inputFor(provider, { classifications, prospects, partnerId: 'prospect-1' }));
    await waitFor(() =>
      expect(result.current.series.data!.reduce((sum, row) => sum + row.total, 0)).toBe(1),
    );
    rerender(inputFor(provider, { classifications, prospects, partnerId: 'partner-1' }));
    await waitFor(() =>
      expect(result.current.series.data!.reduce((sum, row) => sum + row.total, 0)).toBe(1),
    );
    expect(result.current.series.data).toEqual(
      weeklyActivity(book.activities, 'pm-1', new Set(['partner-1']), classifications),
    );
  });

  it('counts a cross-manager prospect classification in the prospect’s manager scope exactly once', async () => {
    // pm-1's Monday call, re-pointed at a prospect on pm-2's roster. The
    // classification owns the meeting now: pm-1's goal and week lose it and
    // pm-2's gain it, so across the two managers it is counted exactly once
    // rather than dropped from both by the raw calendar attribution.
    const book = makeBook();
    const { provider } = spyProvider(new MockDataProvider(book));
    const prospects = [
      makePartner({ id: 'prospect-1', name: 'Prospect Co', partnerManagerId: 'pm-2' }),
    ];
    const classifications: Record<string, MeetingClassification> = {
      'meeting-mon': { partnerId: 'prospect-1', type: 'discovery' },
    };
    const a = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider, { classifications, prospects }),
    });
    await settle(a.result);

    // Manager A keeps only Tuesday's interlock; the moved call is gone.
    expect(a.result.current.goal.data!.meetings).toBe(1);
    expect(a.result.current.goal.data!.pioMeetings).toBe(1);
    const aWeek = a.result.current.goalWeek.data!;
    expect(aWeek[aWeek.length - 1]!.total).toBe(1);

    // Manager B gains it next to his own call — zero times for A, once for B.
    const b = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider, {
        managerId: 'pm-2',
        classifications,
        prospects,
      }),
    });
    await settle(b.result);
    expect(b.result.current.goal.data!.meetings).toBe(2);
    const bWeek = b.result.current.goalWeek.data!;
    expect(bWeek[bWeek.length - 1]!.total).toBe(2);
    expect(bWeek[bWeek.length - 1]!.byType.discovery).toBe(2);

    // The two scopes still sum to the book's three in-week calls: the moved
    // meeting is counted exactly once — dropped by neither, doubled by none.
    expect(a.result.current.goal.data!.meetings + b.result.current.goal.data!.meetings).toBe(3);
  });

  it('pages the classification calendar a cursor at a time', async () => {
    // Thirty calls in the snapshot week force a second 25-row page.
    const week = Array.from({ length: 30 }, (_, index) =>
      makeMeeting({
        id: `mtg-${String(index).padStart(2, '0')}`,
        partnerId: 'partner-1',
        occurredAt: new Date(WEEK_START.getTime() + index * 2 * 3_600_000).toISOString(),
      }),
    );
    const { provider, calls } = spyProvider(
      new MockDataProvider(makeProviderBook({ ...makeBook(), activities: week })),
    );
    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider),
    });

    await waitFor(() => expect(result.current.meetings.meta).not.toBeNull());
    expect(result.current.meetings.rows).toHaveLength(25);
    expect(result.current.meetings.totalCount).toBe(30);
    expect(result.current.meetings.hasMore).toBe(true);

    act(() => result.current.meetings.loadMore());
    await waitFor(() => expect(result.current.meetings.rows).toHaveLength(30));
    expect(result.current.meetings.hasMore).toBe(false);

    expect(calls.filter((method) => method === 'listWeeklyClassificationMeetings')).toHaveLength(2);
    const ids = result.current.meetings.rows.map((row) => row.id);
    // Oldest first, with no duplicate or missed row.
    expect(ids).toEqual(week.map((row) => row.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps a failed query independent: siblings stay settled, retry repeats only the failed call', async () => {
    const remote = createSimulatedRemoteProvider(new MockDataProvider(makeBook()), {
      latencyMs: 0,
      failMethods: { getWeeklyGoalProgress: 1 },
    });
    const { provider, calls } = spyProvider(remote);
    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider),
    });

    await waitFor(() => expect(result.current.goal.error).not.toBeNull());
    // The goal alone failed; the chart, the directories, and the calendar
    // landed.
    await waitFor(() => {
      expect(result.current.series.data).not.toBeNull();
      expect(result.current.roster.data).not.toBeNull();
      expect(result.current.meetings.meta).not.toBeNull();
    });
    expect(result.current.goal.error).toBe('Failed to load the weekly goal');
    expect(result.current.goal.data).toBeNull();

    act(() => result.current.goal.retry());
    await waitFor(() => expect(result.current.goal.data).not.toBeNull());
    expect(result.current.goal.data!.meetings).toBe(2);

    expect(calls.filter((method) => method === 'getWeeklyGoalProgress')).toHaveLength(2);
    expect(calls.filter((method) => method === 'getWeeklyActivitySeries')).toHaveLength(2);
    expect(calls.filter((method) => method === 'listWeeklyClassificationMeetings')).toHaveLength(1);
  });

  it('falls back to org-wide aggregates and no calendar when the directory fails', async () => {
    const book = makeBook();
    const remote = createSimulatedRemoteProvider(new MockDataProvider(book), {
      latencyMs: 0,
      failMethods: { getManagerDirectory: 1 },
    });
    const { provider, calls } = spyProvider(remote);
    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider, { managerId: '' }),
    });

    await waitFor(() => expect(result.current.managers.error).not.toBeNull());
    await waitFor(() => expect(result.current.goal.data).not.toBeNull());
    // The no-directory fallback: the aggregates answer org-wide (both
    // managers' three calls this week), exactly the view's old behavior.
    expect(result.current.managerId).toBe('');
    expect(result.current.goal.data!.meetings).toBe(3);
    expect(result.current.goal.data).toEqual(weeklyGoalProgress(book.activities, {}, undefined));

    // No manager means no classification calendar at all: the query is off,
    // not empty.
    expect(result.current.meetings.meta).toBeNull();
    expect(result.current.meetings.rows).toEqual([]);
    expect(result.current.meetings.loading).toBe(false);
    expect(calls).not.toContain('listWeeklyClassificationMeetings');
  });

  it('issues no aggregate and says so when the directory answers with nobody on it', async () => {
    const book = makeProviderBook({
      partnerManagers: [],
      partners: [],
      activities: [],
      registrations: [],
      opportunities: [],
      targets: [],
      certifications: [],
    });
    const { provider, calls } = spyProvider(new MockDataProvider(book));
    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider, { managerId: '' }),
    });

    await waitFor(() => expect(result.current.managers.data).toEqual([]));

    // An answered-empty directory is not a failure and not a scope: no goal
    // or series query fires, because there is no manager an org-wide figure
    // could describe. The surfaces report the empty directory explicitly.
    expect(calls).not.toContain('getWeeklyGoalProgress');
    expect(calls).not.toContain('getWeeklyActivitySeries');
    expect(calls).not.toContain('listWeeklyClassificationMeetings');
    expect(result.current.managerId).toBe('');
    for (const state of [result.current.goal, result.current.goalWeek, result.current.series]) {
      expect(state).toMatchObject({
        data: null,
        loading: false,
        refreshing: false,
        error: EMPTY_DIRECTORY_COPY,
      });
    }
    // The roster is not manager-attributed, so it still answered.
    expect(result.current.roster.data).toEqual([]);

    // Retry re-asks the directory — the only answer that can change this.
    act(() => result.current.goal.retry());
    await waitFor(() =>
      expect(calls.filter((method) => method === 'getManagerDirectory')).toHaveLength(2),
    );
    expect(calls).not.toContain('getWeeklyGoalProgress');
  });

  it('follows the directory to its first manager when none is selected', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider, { managerId: '' }),
    });

    await waitFor(() => expect(result.current.managerId).toBe('pm-1'));
    await settle(result);
    expect(result.current.goal.data!.meetings).toBe(2);
    expect(result.current.meetings.rows.map((row) => row.id)).toEqual([
      'meeting-mon',
      'meeting-tue',
    ]);
  });

  it('issues no org-wide aggregate while the directory is still resolving', async () => {
    // A deferred directory is the deterministic stand-in for resolution
    // timing: the test decides exactly when the manager identity lands.
    const inner = new MockDataProvider(makeBook());
    let releaseDirectory!: () => void;
    const directoryGate = new Promise<void>((resolve) => {
      releaseDirectory = resolve;
    });
    const calls: string[] = [];
    const provider = new Proxy(inner, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof property !== 'string' || typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          calls.push(property);
          if (property === 'getManagerDirectory') {
            return directoryGate.then(() =>
              (value as (...rest: unknown[]) => unknown).apply(target, args),
            );
          }
          return (value as (...rest: unknown[]) => unknown).apply(target, args);
        };
      },
    }) as DataProvider;

    const { result } = renderHook((input: ActivityQueryInput) => useActivityQueries(input), {
      initialProps: inputFor(provider, { managerId: '' }),
    });

    // No manager is resolved yet, so nothing manager-attributed is asked:
    // an org-wide placeholder issued now would be attributed to whoever the
    // directory is about to name. The aggregates hold at initial loading.
    expect(result.current.managerId).toBe('');
    expect(result.current.goal).toMatchObject({ data: null, loading: true, error: null });
    expect(result.current.series.data).toBeNull();
    expect(calls).not.toContain('getWeeklyGoalProgress');
    expect(calls).not.toContain('getWeeklyActivitySeries');
    expect(calls).not.toContain('listWeeklyClassificationMeetings');

    // Once the directory answers, the aggregates ask the manager's own
    // question — label and data commit under one scope identity.
    await act(async () => {
      releaseDirectory();
    });
    await settle(result);
    expect(result.current.managerId).toBe('pm-1');
    expect(result.current.goal.data!.meetings).toBe(2);
  });

  it('shows loading, not the previous manager’s figures, while a manager switch refetches', async () => {
    const { provider } = spyProvider(new MockDataProvider(makeBook()));
    const { result, rerender } = renderHook(
      (input: ActivityQueryInput) => useActivityQueries(input),
      { initialProps: inputFor(provider) },
    );
    await settle(result);

    rerender(inputFor(provider, { managerId: 'pm-2' }));
    // The scope identity changed: pm-1's answer leaves in the same render,
    // not kept on screen as a stale "refresh" under pm-2's label. Only an
    // edit-driven refetch inside one scope may keep the previous figures.
    expect(result.current.goal.data).toBeNull();
    expect(result.current.goal.loading).toBe(true);
    expect(result.current.goal.refreshing).toBe(false);
    expect(result.current.series.data).toBeNull();
    expect(result.current.meetings.rows).toEqual([]);

    await waitFor(() => expect(result.current.goal.data!.meetings).toBe(1));
    expect(result.current.series.data!.reduce((sum, row) => sum + row.total, 0)).toBe(1);
  });
});
