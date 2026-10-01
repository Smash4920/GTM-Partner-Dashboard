import type {
  ActivityScope,
  DataProvider,
  ForecastQualitySummary,
  ForecastScope,
  ForecastSummary,
  ManagerForecastGroup,
  Page,
  PageRequest,
  PartnerCertificationProfile,
  PartnerCertificationScope,
  PartnerDrilldown,
  PartnerLeaderboardEntry,
  PartnerRef,
  PendingRegistrationsScope,
  PerformanceScope,
  PerformanceSummary,
  RegistrationOpsSummary,
  RegistrationSlaAlertDigest,
  RevenueTrendScope,
  StageBreakdown,
  TeamRosterScope,
  TopPartnerLeaders,
  WeeklyClassificationScope,
  WeeklySeriesRow,
  WeightedForecastSummary,
} from '../DataProvider';
import type { DemoAccessScope } from '../accessScope';
import type { QueryContext } from '../queryContext';
import type { QueryResult } from '../queryMetadata';
import { abortableDelay, throwIfAborted } from '../../lib/abort';
import type {
  DuplicateRegistrationGroup,
  QuarterRevenueRow,
  RegistrationFunnel,
  TypeRow,
  WeeklyActivityRow,
  WeeklyGoalProgress,
} from '../../lib/metrics';
import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerManager,
  TeamUser,
} from '../types';
import { MockDataProvider } from './MockDataProvider';
import { mulberry32 } from './rng';

export interface RemoteOptions {
  /** Base round-trip latency per call, in milliseconds. */
  latencyMs?: number;
  /** Share of calls that fail, from 0 to 1. */
  failureRate?: number;
  /** Seeds the jitter and the failure draws, so a demo run is repeatable. */
  seed?: number;
  /**
   * A positional failure plan: exactly the first N calls on this instance
   * fail, everything after succeeds. While a plan is set, the seeded failure
   * draw is off and the latency holds at the base value.
   *
   * Positional plans count every call, so what they do to a *named* call
   * depends on how the calls around it are ordered. They exist for flows
   * whose very first call is the one under test (the provider-switch
   * readiness probe behind `?remoteFailFirst=`); anything else should use
   * `failMethods`, which is order-independent.
   */
  failFirstCalls?: number;
  /**
   * A named failure plan: for each listed method, exactly its next N calls on
   * this instance fail, then it succeeds. Calls to other methods neither
   * consume nor shift the plan, so a test can fail "the summary query"
   * without caring what else the page happens to fetch, and replaying the
   * plan on a fresh instance reproduces the same outcomes regardless of
   * unrelated call order.
   *
   * An entry may instead be `{ skip, fail }`: the method's first `skip`
   * calls succeed, then exactly `fail` fail, then it succeeds — so a plan
   * can fail "the second page" of a paginated query without touching the
   * first, the failure a retained list has to survive.
   */
  failMethods?: Partial<Record<keyof DataProvider, number | FailurePlanEntry>>;
  /**
   * The identity stamped into the metadata of every scoped answer that
   * crosses this wire. The inner provider computed the answer, but the
   * committed provider the session is talking to is this one — an answer
   * labelled with the inner identity would read as local data arriving over
   * a remote wire. Defaults to 'remote', the identity this simulation
   * stands for; pass an explicit id only to rehearse another label.
   */
  providerId?: string;
}

const DEFAULT_LATENCY_MS = 250;
const DEFAULT_FAILURE_RATE = 0.15;
const DEFAULT_SEED = 20260918;

/**
 * One entry of a named failure plan: `fail` calls fail after the first
 * `skip` (default 0) succeed. The plain-number form is `{ fail: n }`.
 */
export interface FailurePlanEntry {
  skip?: number;
  fail: number;
}

/**
 * FNV-1a: folds a method name into the seed so each public method draws from
 * its own deterministic stream. A shared stream would make one method's
 * failure pattern depend on how many unrelated calls happened to interleave;
 * per-method streams make the pattern a function of the seed and the method's
 * own call history alone.
 */
function methodSeed(seed: number, method: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < method.length; index += 1) {
    hash ^= method.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (seed ^ hash) >>> 0;
}

/**
 * Any provider, behind a simulated network.
 *
 * Delegation rather than inheritance, because this is not a kind of provider —
 * it is a wire in front of one. That also means it can wrap the scaled book as
 * easily as the mock, and that the two demonstration providers compose instead
 * of multiplying into four classes.
 *
 * It exists so the per-widget loading and error states the production design
 * calls for are exercised rather than theoretical. A local mock answers on the
 * next microtask, which hides every one of them: no spinner is ever seen, no
 * retry is ever pressed, and no view is ever asked to render while a figure it
 * has not received yet is missing.
 *
 * Failure semantics are logical, not partial: one public invocation is one
 * logical load, which incurs exactly one delay and exactly one
 * success/failure decision, made *before* any delegation. A failed call never
 * touches the inner provider, so it cannot half-succeed, and a succeeded call
 * runs the inner method exactly once.
 *
 * Cancellation is part of the wire too. A call made with an already-aborted
 * signal does nothing at all, and a call aborted while the delay is running
 * rejects with an abort error without ever invoking the inner provider. The
 * success/failure decision is made only once the wait completes, so a
 * cancelled call consumes no failure-plan slot and no seeded draw, and a
 * replayed run stays deterministic.
 *
 * Deterministic on purpose. A random failure rate that cannot be reproduced is
 * a flaky demo; the same seed means the same calls fail on the same run, and
 * named failure plans replay identically however the calls around them are
 * ordered.
 */
export class SimulatedRemoteProvider implements DataProvider {
  private readonly inner: DataProvider;
  private readonly latencyMs: number;
  private readonly failureRate: number;
  private readonly failFirstCalls: number | undefined;
  /** Remaining planned skips and failures per method; decremented as they are spent. */
  private readonly failMethods: Map<string, { skip: number; fail: number }> | undefined;
  private readonly seed: number;
  /** Metadata identity stamped on scoped answers, when set. */
  private readonly providerId: string | undefined;
  /** Public invocations so far; the positional plan counts them. */
  private calls = 0;
  /** One deterministic stream per public method. */
  private readonly streams = new Map<string, () => number>();

  constructor(inner: DataProvider = new MockDataProvider(), options: RemoteOptions = {}) {
    this.inner = inner;
    this.latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
    this.failureRate = options.failureRate ?? DEFAULT_FAILURE_RATE;
    this.failFirstCalls =
      options.failFirstCalls !== undefined
        ? Math.max(0, Math.floor(options.failFirstCalls))
        : undefined;
    this.failMethods =
      options.failMethods !== undefined
        ? new Map(
            Object.entries(options.failMethods).map(([method, entry]) => {
              const plan = typeof entry === 'number' ? { fail: entry } : entry;
              return [
                method,
                {
                  skip: Math.max(0, Math.floor(plan?.skip ?? 0)),
                  fail: Math.max(0, Math.floor(plan?.fail ?? 0)),
                },
              ];
            }),
          )
        : undefined;
    this.seed = options.seed ?? DEFAULT_SEED;
    this.providerId = options.providerId ?? 'remote';
  }

  private streamFor(method: string): () => number {
    let stream = this.streams.get(method);
    if (stream === undefined) {
      stream = mulberry32(methodSeed(this.seed, method));
      this.streams.set(method, stream);
    }
    return stream;
  }

  /**
   * The plan's say on this call. While a plan exists it owns every failure
   * decision outright — no draw, no jitter — so a scripted run replays
   * identically no matter what else was called. Consumed only once the wait
   * completes: a call aborted in transit spends no slot.
   */
  private plannedFailure(method: string): boolean {
    this.calls += 1;
    if (this.failFirstCalls !== undefined && this.calls <= this.failFirstCalls) return true;
    const plan = this.failMethods?.get(method);
    if (plan !== undefined) {
      // Skips are spent first, so a plan can aim at a call past the first —
      // the load-more failure a retained page has to survive.
      if (plan.skip > 0) {
        plan.skip -= 1;
        return false;
      }
      if (plan.fail > 0) {
        plan.fail -= 1;
        return true;
      }
    }
    return false;
  }

  /** The wire: one wait, one decision, then either the answer or a failure. */
  private async roundTrip<T>(
    method: keyof DataProvider,
    signal: AbortSignal | undefined,
    run: () => Promise<T>,
  ): Promise<T> {
    // A call that arrives already cancelled does no work at all.
    throwIfAborted(signal);
    const planned = this.failFirstCalls !== undefined || this.failMethods !== undefined;
    // Jitter, because a fixed delay hides the difference between a fast page
    // and a slow one. The draws come from this method's own stream, so the
    // outcome depends on the seed and this method's call history — never on
    // how unrelated calls happened to interleave. A plan holds the latency at
    // the base value and skips the stream entirely.
    const random = planned ? undefined : this.streamFor(method);
    const wait = planned ? this.latencyMs : Math.round(this.latencyMs * (0.6 + random!() * 0.8));
    // The wait is the cancellable part: an abort here rejects without
    // touching the inner provider, and without spending a plan slot or a
    // failure draw.
    await abortableDelay(wait, signal);
    const failed = planned ? this.plannedFailure(method) : random!() < this.failureRate;
    if (failed) {
      throw new Error(`${method} failed in transit (simulated)`);
    }
    return run();
  }

  // ---- scoped queries ------------------------------------------------------

  /**
   * Re-labels a scoped answer with this provider's identity when one is set.
   * Latency and failure are the wire's to add; the answer's origin label is
   * the committed provider's, or the metadata would misattribute the source.
   */
  private async stamp<T>(promise: Promise<QueryResult<T>>): Promise<QueryResult<T>> {
    const result = await promise;
    if (this.providerId === undefined) return result;
    return { ...result, meta: { ...result.meta, providerId: this.providerId } };
  }

  async getForecastSummary(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastSummary>> {
    return this.stamp(
      this.roundTrip('getForecastSummary', context?.signal, () =>
        this.inner.getForecastSummary(access, scope, context),
      ),
    );
  }

  async getWeightedForecast(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeightedForecastSummary>> {
    return this.stamp(
      this.roundTrip('getWeightedForecast', context?.signal, () =>
        this.inner.getWeightedForecast(access, scope, context),
      ),
    );
  }

  async getForecastQuality(
    access: DemoAccessScope,
    scope: ForecastScope,
    sampleSize: number,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastQualitySummary>> {
    return this.stamp(
      this.roundTrip('getForecastQuality', context?.signal, () =>
        this.inner.getForecastQuality(access, scope, sampleSize, context),
      ),
    );
  }

  async getManagerForecastGroups(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ManagerForecastGroup[]>> {
    return this.stamp(
      this.roundTrip('getManagerForecastGroups', context?.signal, () =>
        this.inner.getManagerForecastGroups(access, scope, context),
      ),
    );
  }

  async getWeeklyForecastSeries(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklySeriesRow[]>> {
    return this.stamp(
      this.roundTrip('getWeeklyForecastSeries', context?.signal, () =>
        this.inner.getWeeklyForecastSeries(access, scope, context),
      ),
    );
  }

  async listQuarterOpportunities(
    access: DemoAccessScope,
    scope: ForecastScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    return this.stamp(
      this.roundTrip('listQuarterOpportunities', context?.signal, () =>
        this.inner.listQuarterOpportunities(access, scope, page, context),
      ),
    );
  }

  async getPartnerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerRef[]>> {
    return this.stamp(
      this.roundTrip('getPartnerDirectory', context?.signal, () =>
        this.inner.getPartnerDirectory(access, context),
      ),
    );
  }

  // ---- Home and Partner Performance ----------------------------------------

  async getPerformanceSummary(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<PerformanceSummary>> {
    return this.stamp(
      this.roundTrip('getPerformanceSummary', context?.signal, () =>
        this.inner.getPerformanceSummary(access, scope, context),
      ),
    );
  }

  async getRegistrationFunnel(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationFunnel>> {
    return this.stamp(
      this.roundTrip('getRegistrationFunnel', context?.signal, () =>
        this.inner.getRegistrationFunnel(access, scope, context),
      ),
    );
  }

  async getStageBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<StageBreakdown>> {
    return this.stamp(
      this.roundTrip('getStageBreakdown', context?.signal, () =>
        this.inner.getStageBreakdown(access, scope, context),
      ),
    );
  }

  async getTypeBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<TypeRow[]>> {
    return this.stamp(
      this.roundTrip('getTypeBreakdown', context?.signal, () =>
        this.inner.getTypeBreakdown(access, scope, context),
      ),
    );
  }

  async getQuarterlyRevenueTrend(
    access: DemoAccessScope,
    scope: RevenueTrendScope,
    context?: QueryContext,
  ): Promise<QueryResult<QuarterRevenueRow[]>> {
    return this.stamp(
      this.roundTrip('getQuarterlyRevenueTrend', context?.signal, () =>
        this.inner.getQuarterlyRevenueTrend(access, scope, context),
      ),
    );
  }

  async getWeeklyActivitySeries(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyActivityRow[]>> {
    return this.stamp(
      this.roundTrip('getWeeklyActivitySeries', context?.signal, () =>
        this.inner.getWeeklyActivitySeries(access, scope, context),
      ),
    );
  }

  async getWeeklyGoalProgress(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyGoalProgress>> {
    return this.stamp(
      this.roundTrip('getWeeklyGoalProgress', context?.signal, () =>
        this.inner.getWeeklyGoalProgress(access, scope, context),
      ),
    );
  }

  async getRegistrationOpsSummary(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationOpsSummary>> {
    return this.stamp(
      this.roundTrip('getRegistrationOpsSummary', context?.signal, () =>
        this.inner.getRegistrationOpsSummary(access, scope, context),
      ),
    );
  }

  async getTopPartnerLeaders(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<TopPartnerLeaders>> {
    return this.stamp(
      this.roundTrip('getTopPartnerLeaders', context?.signal, () =>
        this.inner.getTopPartnerLeaders(access, scope, context),
      ),
    );
  }

  async listPartnerLeaderboard(
    access: DemoAccessScope,
    scope: PerformanceScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<PartnerLeaderboardEntry>>> {
    return this.stamp(
      this.roundTrip('listPartnerLeaderboard', context?.signal, () =>
        this.inner.listPartnerLeaderboard(access, scope, page, context),
      ),
    );
  }

  async getManagerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerManager[]>> {
    return this.stamp(
      this.roundTrip('getManagerDirectory', context?.signal, () =>
        this.inner.getManagerDirectory(access, context),
      ),
    );
  }

  async getPartnerRoster(
    access: DemoAccessScope,
    scope: { prospects?: Partner[] },
    context?: QueryContext,
  ): Promise<QueryResult<Partner[]>> {
    return this.stamp(
      this.roundTrip('getPartnerRoster', context?.signal, () =>
        this.inner.getPartnerRoster(access, scope, context),
      ),
    );
  }

  async getPartnerCertification(
    access: DemoAccessScope,
    scope: PartnerCertificationScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerCertificationProfile | null>> {
    return this.stamp(
      this.roundTrip('getPartnerCertification', context?.signal, () =>
        this.inner.getPartnerCertification(access, scope, context),
      ),
    );
  }

  async listScopedOpportunities(
    access: DemoAccessScope,
    scope: PerformanceScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    return this.stamp(
      this.roundTrip('listScopedOpportunities', context?.signal, () =>
        this.inner.listScopedOpportunities(access, scope, page, context),
      ),
    );
  }

  async listPendingRegistrations(
    access: DemoAccessScope,
    scope: PendingRegistrationsScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    return this.stamp(
      this.roundTrip('listPendingRegistrations', context?.signal, () =>
        this.inner.listPendingRegistrations(access, scope, page, context),
      ),
    );
  }

  async listUnconvertedRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    return this.stamp(
      this.roundTrip('listUnconvertedRegistrations', context?.signal, () =>
        this.inner.listUnconvertedRegistrations(access, scope, page, context),
      ),
    );
  }

  async listDuplicateRegistrationGroups(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DuplicateRegistrationGroup>>> {
    return this.stamp(
      this.roundTrip('listDuplicateRegistrationGroups', context?.signal, () =>
        this.inner.listDuplicateRegistrationGroups(access, scope, page, context),
      ),
    );
  }

  async listRecentRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    return this.stamp(
      this.roundTrip('listRecentRegistrations', context?.signal, () =>
        this.inner.listRecentRegistrations(access, scope, page, context),
      ),
    );
  }

  // ---- Data Connections -----------------------------------------------------

  async getTeamRoster(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    context?: QueryContext,
  ): Promise<QueryResult<TeamUser[]>> {
    return this.stamp(
      this.roundTrip('getTeamRoster', context?.signal, () =>
        this.inner.getTeamRoster(access, scope, context),
      ),
    );
  }

  async getRegistrationSlaAlerts(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    maxAlerts: number,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationSlaAlertDigest>> {
    return this.stamp(
      this.roundTrip('getRegistrationSlaAlerts', context?.signal, () =>
        this.inner.getRegistrationSlaAlerts(access, scope, maxAlerts, context),
      ),
    );
  }

  // ---- Activity Tracking ----------------------------------------------------

  async listWeeklyClassificationMeetings(
    access: DemoAccessScope,
    scope: WeeklyClassificationScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<ActivityMeeting>>> {
    return this.stamp(
      this.roundTrip('listWeeklyClassificationMeetings', context?.signal, () =>
        this.inner.listWeeklyClassificationMeetings(access, scope, page, context),
      ),
    );
  }
}
