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

  async listPartnerManagers(): Promise<PartnerManager[]> {
    return this.roundTrip('listPartnerManagers', () => this.inner.listPartnerManagers());
  }

  async listPartners(): Promise<Partner[]> {
    return this.roundTrip('listPartners', () => this.inner.listPartners());
  }

  async listRegistrations(): Promise<DealRegistration[]> {
    return this.roundTrip('listRegistrations', () => this.inner.listRegistrations());
  }

  async listOpportunities(): Promise<Opportunity[]> {
    return this.roundTrip('listOpportunities', () => this.inner.listOpportunities());
  }

  async getTargets(): Promise<Target[]> {
    return this.roundTrip('getTargets', () => this.inner.getTargets());
  }

  async listActivities(): Promise<ActivityMeeting[]> {
    return this.roundTrip('listActivities', () => this.inner.listActivities());
  }

  async listCertifications(): Promise<PartnerCertification[]> {
    return this.roundTrip('listCertifications', () => this.inner.listCertifications());
  }

  async listTeamUsers(): Promise<TeamUser[]> {
    return this.roundTrip('listTeamUsers', () => this.inner.listTeamUsers());
  }

  // ---- the target shape ----------------------------------------------------

  async getForecastSummary(scope: ForecastScope): Promise<ForecastSummary> {
    return this.roundTrip('getForecastSummary', () => this.inner.getForecastSummary(scope));
  }

  async getWeightedForecast(scope: ForecastScope): Promise<WeightedForecastSummary> {
    return this.roundTrip('getWeightedForecast', () => this.inner.getWeightedForecast(scope));
  }

  async getForecastQuality(
    scope: ForecastScope,
    sampleSize: number,
  ): Promise<ForecastQualitySummary> {
    return this.roundTrip('getForecastQuality', () =>
      this.inner.getForecastQuality(scope, sampleSize),
    );
  }

  async getManagerForecastGroups(scope: ForecastScope): Promise<ManagerForecastGroup[]> {
    return this.roundTrip('getManagerForecastGroups', () =>
      this.inner.getManagerForecastGroups(scope),
    );
  }

  async getWeeklyForecastSeries(scope: ForecastScope): Promise<WeeklySeriesRow[]> {
    return this.roundTrip('getWeeklyForecastSeries', () =>
      this.inner.getWeeklyForecastSeries(scope),
    );
  }

  async listQuarterOpportunities(
    scope: ForecastScope,
    page: PageRequest,
  ): Promise<Page<Opportunity>> {
    return this.roundTrip('listQuarterOpportunities', () =>
      this.inner.listQuarterOpportunities(scope, page),
    );
  }

  async getPartnerDirectory(): Promise<PartnerRef[]> {
    return this.roundTrip('getPartnerDirectory', () => this.inner.getPartnerDirectory());
  }
}
