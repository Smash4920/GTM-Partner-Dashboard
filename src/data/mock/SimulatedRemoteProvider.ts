import type {
  DataProvider,
  ForecastQualitySummary,
  ForecastScope,
  ForecastSummary,
  ManagerForecastGroup,
  Page,
  PageRequest,
  PartnerRef,
  WeeklySeriesRow,
  WeightedForecastSummary,
} from '../DataProvider';
import type { QueryResult } from '../queryMetadata';
import type { TraceContext } from '../../lib/tracing';
import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerCertification,
  PartnerManager,
  Target,
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
   */
  failMethods?: Partial<Record<keyof DataProvider, number>>;
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
  /** Remaining planned failures per method; decremented as they are spent. */
  private readonly failMethods: Map<string, number> | undefined;
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
            Object.entries(options.failMethods).map(([method, count]) => [
              method,
              Math.max(0, Math.floor(count ?? 0)),
            ]),
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
   * The plan's say on this call, or undefined when no plan is set. While a
   * plan exists it owns every failure decision outright — no draw, no jitter —
   * so a scripted run replays identically no matter what else was called.
   */
  private plannedFailure(method: string): boolean | undefined {
    if (this.failFirstCalls === undefined && this.failMethods === undefined) return undefined;
    this.calls += 1;
    if (this.failFirstCalls !== undefined && this.calls <= this.failFirstCalls) return true;
    const remaining = this.failMethods?.get(method);
    if (remaining !== undefined && remaining > 0) {
      this.failMethods?.set(method, remaining - 1);
      return true;
    }
    return false;
  }

  /** The wire: one wait, one decision, then either the answer or a failure. */
  private async roundTrip<T>(method: keyof DataProvider, run: () => Promise<T>): Promise<T> {
    const planned = this.plannedFailure(method);
    if (planned !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
      if (planned) {
        throw new Error(`${method} failed in transit (simulated)`);
      }
      return run();
    }
    // Jitter, because a fixed delay hides the difference between a fast page
    // and a slow one. Both draws come from this method's own stream, so the
    // outcome depends on the seed and this method's call history — never on
    // how unrelated calls happened to interleave.
    const random = this.streamFor(method);
    const wait = Math.round(this.latencyMs * (0.6 + random() * 0.8));
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (random() < this.failureRate) {
      throw new Error(`${method} failed in transit (simulated)`);
    }
    return run();
  }

  // ---- the shape being retired --------------------------------------------

  async listPartnerManagers(trace?: TraceContext): Promise<PartnerManager[]> {
    return this.roundTrip('listPartnerManagers', () => this.inner.listPartnerManagers(trace));
  }

  async listPartners(trace?: TraceContext): Promise<Partner[]> {
    return this.roundTrip('listPartners', () => this.inner.listPartners(trace));
  }

  async listRegistrations(trace?: TraceContext): Promise<DealRegistration[]> {
    return this.roundTrip('listRegistrations', () => this.inner.listRegistrations(trace));
  }

  async listOpportunities(trace?: TraceContext): Promise<Opportunity[]> {
    return this.roundTrip('listOpportunities', () => this.inner.listOpportunities(trace));
  }

  async getTargets(trace?: TraceContext): Promise<Target[]> {
    return this.roundTrip('getTargets', () => this.inner.getTargets(trace));
  }

  async listActivities(trace?: TraceContext): Promise<ActivityMeeting[]> {
    return this.roundTrip('listActivities', () => this.inner.listActivities(trace));
  }

  async listCertifications(trace?: TraceContext): Promise<PartnerCertification[]> {
    return this.roundTrip('listCertifications', () => this.inner.listCertifications(trace));
  }

  async listTeamUsers(trace?: TraceContext): Promise<TeamUser[]> {
    return this.roundTrip('listTeamUsers', () => this.inner.listTeamUsers(trace));
  }

  // ---- the target shape ----------------------------------------------------

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
    scope: ForecastScope,
    trace?: TraceContext,
  ): Promise<QueryResult<ForecastSummary>> {
    return this.stamp(
      this.roundTrip('getForecastSummary', () => this.inner.getForecastSummary(scope, trace)),
    );
  }

  async getWeightedForecast(
    scope: ForecastScope,
    trace?: TraceContext,
  ): Promise<QueryResult<WeightedForecastSummary>> {
    return this.stamp(
      this.roundTrip('getWeightedForecast', () => this.inner.getWeightedForecast(scope, trace)),
    );
  }

  async getForecastQuality(
    scope: ForecastScope,
    sampleSize: number,
    trace?: TraceContext,
  ): Promise<QueryResult<ForecastQualitySummary>> {
    return this.stamp(
      this.roundTrip('getForecastQuality', () =>
        this.inner.getForecastQuality(scope, sampleSize, trace),
      ),
    );
  }

  async getManagerForecastGroups(
    scope: ForecastScope,
    trace?: TraceContext,
  ): Promise<QueryResult<ManagerForecastGroup[]>> {
    return this.stamp(
      this.roundTrip('getManagerForecastGroups', () =>
        this.inner.getManagerForecastGroups(scope, trace),
      ),
    );
  }

  async getWeeklyForecastSeries(
    scope: ForecastScope,
    trace?: TraceContext,
  ): Promise<QueryResult<WeeklySeriesRow[]>> {
    return this.stamp(
      this.roundTrip('getWeeklyForecastSeries', () =>
        this.inner.getWeeklyForecastSeries(scope, trace),
      ),
    );
  }

  async listQuarterOpportunities(
    scope: ForecastScope,
    page: PageRequest,
    trace?: TraceContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    return this.stamp(
      this.roundTrip('listQuarterOpportunities', () =>
        this.inner.listQuarterOpportunities(scope, page, trace),
      ),
    );
  }

  async getPartnerDirectory(trace?: TraceContext): Promise<QueryResult<PartnerRef[]>> {
    return this.stamp(
      this.roundTrip('getPartnerDirectory', () => this.inner.getPartnerDirectory(trace)),
    );
  }
}
