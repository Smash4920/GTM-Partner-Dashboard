import { traceProviderRequest } from '../lib/tracing';
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
  RevenueTrendScope,
  StageBreakdown,
  WeeklyClassificationScope,
  WeeklySeriesRow,
  WeightedForecastSummary,
} from './DataProvider';
import type { DemoAccessScope } from './accessScope';
import type { QueryContext } from './queryContext';
import type { QueryResult } from './queryMetadata';
import type {
  DuplicateRegistrationGroup,
  QuarterRevenueRow,
  RegistrationFunnel,
  TypeRow,
  WeeklyActivityRow,
  WeeklyGoalProgress,
} from '../lib/metrics';
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

  getPerformanceSummary(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<PerformanceSummary>> {
    return this.request('getPerformanceSummary', context, (withTrace) =>
      this.inner.getPerformanceSummary(access, scope, withTrace),
    );
  }

  getRegistrationFunnel(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationFunnel>> {
    return this.request('getRegistrationFunnel', context, (withTrace) =>
      this.inner.getRegistrationFunnel(access, scope, withTrace),
    );
  }

  getStageBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<StageBreakdown>> {
    return this.request('getStageBreakdown', context, (withTrace) =>
      this.inner.getStageBreakdown(access, scope, withTrace),
    );
  }

  getTypeBreakdown(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<TypeRow[]>> {
    return this.request('getTypeBreakdown', context, (withTrace) =>
      this.inner.getTypeBreakdown(access, scope, withTrace),
    );
  }

  getQuarterlyRevenueTrend(
    access: DemoAccessScope,
    scope: RevenueTrendScope,
    context?: QueryContext,
  ): Promise<QueryResult<QuarterRevenueRow[]>> {
    return this.request('getQuarterlyRevenueTrend', context, (withTrace) =>
      this.inner.getQuarterlyRevenueTrend(access, scope, withTrace),
    );
  }

  getWeeklyActivitySeries(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyActivityRow[]>> {
    return this.request('getWeeklyActivitySeries', context, (withTrace) =>
      this.inner.getWeeklyActivitySeries(access, scope, withTrace),
    );
  }

  getWeeklyGoalProgress(
    access: DemoAccessScope,
    scope: ActivityScope,
    context?: QueryContext,
  ): Promise<QueryResult<WeeklyGoalProgress>> {
    return this.request('getWeeklyGoalProgress', context, (withTrace) =>
      this.inner.getWeeklyGoalProgress(access, scope, withTrace),
    );
  }

  getRegistrationOpsSummary(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationOpsSummary>> {
    return this.request('getRegistrationOpsSummary', context, (withTrace) =>
      this.inner.getRegistrationOpsSummary(access, scope, withTrace),
    );
  }

  getPartnerLeaderboard(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerLeaderboardEntry[]>> {
    return this.request('getPartnerLeaderboard', context, (withTrace) =>
      this.inner.getPartnerLeaderboard(access, scope, withTrace),
    );
  }

  getManagerDirectory(
    access: DemoAccessScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerManager[]>> {
    return this.request('getManagerDirectory', context, (withTrace) =>
      this.inner.getManagerDirectory(access, withTrace),
    );
  }

  getPartnerRoster(
    access: DemoAccessScope,
    scope: { prospects?: Partner[] },
    context?: QueryContext,
  ): Promise<QueryResult<Partner[]>> {
    return this.request('getPartnerRoster', context, (withTrace) =>
      this.inner.getPartnerRoster(access, scope, withTrace),
    );
  }

  getPartnerCertification(
    access: DemoAccessScope,
    scope: PartnerCertificationScope,
    context?: QueryContext,
  ): Promise<QueryResult<PartnerCertificationProfile | null>> {
    return this.request('getPartnerCertification', context, (withTrace) =>
      this.inner.getPartnerCertification(access, scope, withTrace),
    );
  }

  listScopedOpportunities(
    access: DemoAccessScope,
    scope: PerformanceScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<Opportunity>>> {
    return this.request('listScopedOpportunities', context, (withTrace) =>
      this.inner.listScopedOpportunities(access, scope, page, withTrace),
    );
  }

  listPendingRegistrations(
    access: DemoAccessScope,
    scope: PendingRegistrationsScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    return this.request('listPendingRegistrations', context, (withTrace) =>
      this.inner.listPendingRegistrations(access, scope, page, withTrace),
    );
  }

  listUnconvertedRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    return this.request('listUnconvertedRegistrations', context, (withTrace) =>
      this.inner.listUnconvertedRegistrations(access, scope, page, withTrace),
    );
  }

  listDuplicateRegistrationGroups(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DuplicateRegistrationGroup>>> {
    return this.request('listDuplicateRegistrationGroups', context, (withTrace) =>
      this.inner.listDuplicateRegistrationGroups(access, scope, page, withTrace),
    );
  }

  listWeeklyClassificationMeetings(
    access: DemoAccessScope,
    scope: WeeklyClassificationScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<ActivityMeeting>>> {
    return this.request('listWeeklyClassificationMeetings', context, (withTrace) =>
      this.inner.listWeeklyClassificationMeetings(access, scope, page, withTrace),
    );
  }
}
