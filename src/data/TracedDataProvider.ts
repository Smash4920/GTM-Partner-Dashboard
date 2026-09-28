import { traceProviderRequest } from '../lib/tracing';
import type { TraceContext } from '../lib/tracing';
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
} from './DataProvider';
import type {
  ActivityMeeting,
  DealRegistration,
  Opportunity,
  Partner,
  PartnerCertification,
  PartnerManager,
  Target,
  TeamUser,
} from './types';

/**
 * Adds one observable span to every call across the application's integration
 * seam. Context reaches the underlying provider instead of stopping at the
 * browser log, which lets an HTTP implementation inject the included
 * `traceparent` and `x-request-id` headers into its request.
 */
export class TracedDataProvider implements DataProvider {
  constructor(private readonly inner: DataProvider) {}

  private request<T>(operation: string, run: (trace: TraceContext) => Promise<T>): Promise<T> {
    return traceProviderRequest(operation, run);
  }

  listPartnerManagers(): Promise<PartnerManager[]> {
    return this.request('listPartnerManagers', (trace) => this.inner.listPartnerManagers(trace));
  }

  listPartners(): Promise<Partner[]> {
    return this.request('listPartners', (trace) => this.inner.listPartners(trace));
  }

  listRegistrations(): Promise<DealRegistration[]> {
    return this.request('listRegistrations', (trace) => this.inner.listRegistrations(trace));
  }

  listOpportunities(): Promise<Opportunity[]> {
    return this.request('listOpportunities', (trace) => this.inner.listOpportunities(trace));
  }

  getTargets(): Promise<Target[]> {
    return this.request('getTargets', (trace) => this.inner.getTargets(trace));
  }

  listActivities(): Promise<ActivityMeeting[]> {
    return this.request('listActivities', (trace) => this.inner.listActivities(trace));
  }

  listCertifications(): Promise<PartnerCertification[]> {
    return this.request('listCertifications', (trace) => this.inner.listCertifications(trace));
  }

  listTeamUsers(): Promise<TeamUser[]> {
    return this.request('listTeamUsers', (trace) => this.inner.listTeamUsers(trace));
  }

  getForecastSummary(scope: ForecastScope): Promise<ForecastSummary> {
    return this.request('getForecastSummary', (trace) =>
      this.inner.getForecastSummary(scope, trace),
    );
  }

  getWeightedForecast(scope: ForecastScope): Promise<WeightedForecastSummary> {
    return this.request('getWeightedForecast', (trace) =>
      this.inner.getWeightedForecast(scope, trace),
    );
  }

  getForecastQuality(scope: ForecastScope, sampleSize: number): Promise<ForecastQualitySummary> {
    return this.request('getForecastQuality', (trace) =>
      this.inner.getForecastQuality(scope, sampleSize, trace),
    );
  }

  getManagerForecastGroups(scope: ForecastScope): Promise<ManagerForecastGroup[]> {
    return this.request('getManagerForecastGroups', (trace) =>
      this.inner.getManagerForecastGroups(scope, trace),
    );
  }

  getWeeklyForecastSeries(scope: ForecastScope): Promise<WeeklySeriesRow[]> {
    return this.request('getWeeklyForecastSeries', (trace) =>
      this.inner.getWeeklyForecastSeries(scope, trace),
    );
  }

  listQuarterOpportunities(scope: ForecastScope, page: PageRequest): Promise<Page<Opportunity>> {
    return this.request('listQuarterOpportunities', (trace) =>
      this.inner.listQuarterOpportunities(scope, page, trace),
    );
  }

  getPartnerDirectory(): Promise<PartnerRef[]> {
    return this.request('getPartnerDirectory', (trace) => this.inner.getPartnerDirectory(trace));
  }
}
