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
import type { DemoAccessScope } from './accessScope';
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

  listPartnerManagers(access: DemoAccessScope, context?: QueryContext): Promise<PartnerManager[]> {
    return this.request('listPartnerManagers', context, (withTrace) =>
      this.inner.listPartnerManagers(access, withTrace),
    );
  }

  listPartners(access: DemoAccessScope, context?: QueryContext): Promise<Partner[]> {
    return this.request('listPartners', context, (withTrace) =>
      this.inner.listPartners(access, withTrace),
    );
  }

  listRegistrations(access: DemoAccessScope, context?: QueryContext): Promise<DealRegistration[]> {
    return this.request('listRegistrations', context, (withTrace) =>
      this.inner.listRegistrations(access, withTrace),
    );
  }

  listOpportunities(access: DemoAccessScope, context?: QueryContext): Promise<Opportunity[]> {
    return this.request('listOpportunities', context, (withTrace) =>
      this.inner.listOpportunities(access, withTrace),
    );
  }

  getTargets(access: DemoAccessScope, context?: QueryContext): Promise<Target[]> {
    return this.request('getTargets', context, (withTrace) =>
      this.inner.getTargets(access, withTrace),
    );
  }

  listActivities(access: DemoAccessScope, context?: QueryContext): Promise<ActivityMeeting[]> {
    return this.request('listActivities', context, (withTrace) =>
      this.inner.listActivities(access, withTrace),
    );
  }

  listCertifications(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<PartnerCertification[]> {
    return this.request('listCertifications', context, (withTrace) =>
      this.inner.listCertifications(access, withTrace),
    );
  }

  listTeamUsers(access: DemoAccessScope, context?: QueryContext): Promise<TeamUser[]> {
    return this.request('listTeamUsers', context, (withTrace) =>
      this.inner.listTeamUsers(access, withTrace),
    );
  }

  getForecastSummary(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastSummary>> {
    return this.request('getForecastSummary', context, (withTrace) =>
      this.inner.getForecastSummary(access, scope, withTrace),
    );
  }

  getWeightedForecast(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeightedForecastSummary>> {
    return this.request('getWeightedForecast', context, (withTrace) =>
      this.inner.getWeightedForecast(access, scope, withTrace),
    );
  }

  getForecastQuality(
    access: DemoAccessScope,
    scope: ForecastScope,
    sampleSize: number,
    context?: QueryContext,
  ): Promise<QueryResult<ForecastQualitySummary>> {
    return this.request('getForecastQuality', context, (withTrace) =>
      this.inner.getForecastQuality(access, scope, sampleSize, withTrace),
    );
  }

  getManagerForecastGroups(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<ManagerForecastGroup[]>> {
    return this.request('getManagerForecastGroups', context, (withTrace) =>
      this.inner.getManagerForecastGroups(access, scope, withTrace),
    );
  }

  getWeeklyForecastSeries(
    access: DemoAccessScope,
    scope: ForecastScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklySeriesRow[]>> {
    return this.request('getWeeklyForecastSeries', context, (withTrace) =>
      this.inner.getWeeklyForecastSeries(access, scope, withTrace),
    );
  }

  listQuarterOpportunities(
    access: DemoAccessScope,
    scope: ForecastScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    return this.request('listQuarterOpportunities', context, (withTrace) =>
      this.inner.listQuarterOpportunities(access, scope, page, withTrace),
    );
  }

  getPartnerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerRef[]>> {
    return this.request('getPartnerDirectory', context, (withTrace) =>
      this.inner.getPartnerDirectory(access, withTrace),
    );
  }
}
