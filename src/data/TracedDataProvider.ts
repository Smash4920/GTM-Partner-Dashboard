import { traceProviderRequest } from '../lib/tracing';
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
import type { QueryContext } from './queryContext';
import type { QueryResult } from './queryMetadata';
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
 * browser log: the abort signal passes through untouched, and the created
 * trace context is merged in, which lets an HTTP implementation inject the
 * included `traceparent` and `x-request-id` headers into its request.
 */
export class TracedDataProvider implements DataProvider {
  constructor(private readonly inner: DataProvider) {}

  private request<T>(
    operation: string,
    context: QueryContext | undefined,
    run: (context: QueryContext) => Promise<T>,
  ): Promise<T> {
    return traceProviderRequest(operation, (trace) => run({ ...context, trace }), context?.trace);
  }

  listPartnerManagers(context?: QueryContext): Promise<PartnerManager[]> {
    return this.request('listPartnerManagers', context, (withTrace) =>
      this.inner.listPartnerManagers(withTrace),
    );
  }

  listPartners(context?: QueryContext): Promise<Partner[]> {
    return this.request('listPartners', context, (withTrace) => this.inner.listPartners(withTrace));
  }

  listRegistrations(context?: QueryContext): Promise<DealRegistration[]> {
    return this.request('listRegistrations', context, (withTrace) =>
      this.inner.listRegistrations(withTrace),
    );
  }

  listOpportunities(context?: QueryContext): Promise<Opportunity[]> {
    return this.request('listOpportunities', context, (withTrace) =>
      this.inner.listOpportunities(withTrace),
    );
  }

  getTargets(context?: QueryContext): Promise<Target[]> {
    return this.request('getTargets', context, (withTrace) => this.inner.getTargets(withTrace));
  }

  listActivities(context?: QueryContext): Promise<ActivityMeeting[]> {
    return this.request('listActivities', context, (withTrace) =>
      this.inner.listActivities(withTrace),
    );
  }

  listCertifications(context?: QueryContext): Promise<PartnerCertification[]> {
    return this.request('listCertifications', context, (withTrace) =>
      this.inner.listCertifications(withTrace),
    );
  }

  listTeamUsers(context?: QueryContext): Promise<TeamUser[]> {
    return this.request('listTeamUsers', context, (withTrace) =>
      this.inner.listTeamUsers(withTrace),
    );
  }

  getForecastSummary(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastSummary>> {
    return this.request('getForecastSummary', context, (withTrace) =>
      this.inner.getForecastSummary(scope, withTrace),
    );
  }

  getWeightedForecast(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeightedForecastSummary>> {
    return this.request('getWeightedForecast', context, (withTrace) =>
      this.inner.getWeightedForecast(scope, withTrace),
    );
  }

  getForecastQuality(
    scope: ForecastScope,
    sampleSize: number,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastQualitySummary>> {
    return this.request('getForecastQuality', context, (withTrace) =>
      this.inner.getForecastQuality(scope, sampleSize, withTrace),
    );
  }

  getManagerForecastGroups(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ManagerForecastGroup[]>> {
    return this.request('getManagerForecastGroups', context, (withTrace) =>
      this.inner.getManagerForecastGroups(scope, withTrace),
    );
  }

  getWeeklyForecastSeries(
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklySeriesRow[]>> {
    return this.request('getWeeklyForecastSeries', context, (withTrace) =>
      this.inner.getWeeklyForecastSeries(scope, withTrace),
    );
  }

  listQuarterOpportunities(
    scope: ForecastScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    return this.request('listQuarterOpportunities', context, (withTrace) =>
      this.inner.listQuarterOpportunities(scope, page, withTrace),
    );
  }

  getPartnerDirectory(context?: QueryContext): Promise<QueryResult<PartnerRef[]>> {
    return this.request('getPartnerDirectory', context, (withTrace) =>
      this.inner.getPartnerDirectory(withTrace),
    );
  }
}
