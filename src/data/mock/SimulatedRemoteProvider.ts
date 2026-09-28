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
}

const DEFAULT_LATENCY_MS = 250;
const DEFAULT_FAILURE_RATE = 0.15;

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
 * Deterministic on purpose. A random failure rate that cannot be reproduced is
 * a flaky demo; the same seed means the same calls fail on the same run.
 */
export class SimulatedRemoteProvider implements DataProvider {
  private readonly inner: DataProvider;
  private readonly latencyMs: number;
  private readonly failureRate: number;
  private readonly random: () => number;

  constructor(inner: DataProvider = new MockDataProvider(), options: RemoteOptions = {}) {
    this.inner = inner;
    this.latencyMs = options.latencyMs ?? DEFAULT_LATENCY_MS;
    this.failureRate = options.failureRate ?? DEFAULT_FAILURE_RATE;
    this.random = mulberry32(options.seed ?? 20260918);
  }

  /** The wire: a wait, then either the answer or a failure. */
  private async roundTrip<T>(method: string, run: () => Promise<T>): Promise<T> {
    // Jitter, because a fixed delay hides the difference between a fast page
    // and a slow one.
    const wait = Math.round(this.latencyMs * (0.6 + this.random() * 0.8));
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (this.random() < this.failureRate) {
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

  async getForecastSummary(scope: ForecastScope, trace?: TraceContext): Promise<ForecastSummary> {
    return this.roundTrip('getForecastSummary', () => this.inner.getForecastSummary(scope, trace));
  }

  async getWeightedForecast(
    scope: ForecastScope,
    trace?: TraceContext,
  ): Promise<WeightedForecastSummary> {
    return this.roundTrip('getWeightedForecast', () =>
      this.inner.getWeightedForecast(scope, trace),
    );
  }

  async getForecastQuality(
    scope: ForecastScope,
    sampleSize: number,
    trace?: TraceContext,
  ): Promise<ForecastQualitySummary> {
    return this.roundTrip('getForecastQuality', () =>
      this.inner.getForecastQuality(scope, sampleSize, trace),
    );
  }

  async getManagerForecastGroups(
    scope: ForecastScope,
    trace?: TraceContext,
  ): Promise<ManagerForecastGroup[]> {
    return this.roundTrip('getManagerForecastGroups', () =>
      this.inner.getManagerForecastGroups(scope, trace),
    );
  }

  async getWeeklyForecastSeries(
    scope: ForecastScope,
    trace?: TraceContext,
  ): Promise<WeeklySeriesRow[]> {
    return this.roundTrip('getWeeklyForecastSeries', () =>
      this.inner.getWeeklyForecastSeries(scope, trace),
    );
  }

  async listQuarterOpportunities(
    scope: ForecastScope,
    page: PageRequest,
    trace?: TraceContext,
  ): Promise<Page<Opportunity>> {
    return this.roundTrip('listQuarterOpportunities', () =>
      this.inner.listQuarterOpportunities(scope, page, trace),
    );
  }

  async getPartnerDirectory(trace?: TraceContext): Promise<PartnerRef[]> {
    return this.roundTrip('getPartnerDirectory', () => this.inner.getPartnerDirectory(trace));
  }
}
