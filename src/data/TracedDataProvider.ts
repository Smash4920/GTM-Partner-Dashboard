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
  RegistrationSlaAlertDigest,
  RevenueTrendScope,
  StageBreakdown,
  TeamRosterScope,
  TopPartnerLeaders,
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
  PartnerManager,
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

  getTopPartnerLeaders(
    access: DemoAccessScope,
    scope: PerformanceScope,
    context?: QueryContext,
  ): Promise<QueryResult<TopPartnerLeaders>> {
    return this.request('getTopPartnerLeaders', context, (withTrace) =>
      this.inner.getTopPartnerLeaders(access, scope, withTrace),
    );
  }

  listPartnerLeaderboard(
    access: DemoAccessScope,
    scope: PerformanceScope,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<PartnerLeaderboardEntry>>> {
    return this.request('listPartnerLeaderboard', context, (withTrace) =>
      this.inner.listPartnerLeaderboard(access, scope, page, withTrace),
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

  listRecentRegistrations(
    access: DemoAccessScope,
    scope: PartnerDrilldown,
    page: PageRequest,
    context?: QueryContext,
  ): Promise<QueryResult<Page<DealRegistration>>> {
    return this.request('listRecentRegistrations', context, (withTrace) =>
      this.inner.listRecentRegistrations(access, scope, page, withTrace),
    );
  }

  getTeamRoster(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    context?: QueryContext,
  ): Promise<QueryResult<TeamUser[]>> {
    return this.request('getTeamRoster', context, (withTrace) =>
      this.inner.getTeamRoster(access, scope, withTrace),
    );
  }

  getRegistrationSlaAlerts(
    access: DemoAccessScope,
    scope: TeamRosterScope,
    maxAlerts: number,
    context?: QueryContext,
  ): Promise<QueryResult<RegistrationSlaAlertDigest>> {
    return this.request('getRegistrationSlaAlerts', context, (withTrace) =>
      this.inner.getRegistrationSlaAlerts(access, scope, maxAlerts, withTrace),
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
