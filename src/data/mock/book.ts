import { FORECAST_CATEGORIES } from '../constants';
import type {
  ActivityMeeting,
  DealRegistration,
  ForecastCategory,
  Opportunity,
  OpportunityStage,
  Partner,
  PartnerCertification,
  PartnerManager,
  Target,
  TeamUser,
} from '../types';
import { quarterWindow } from '../../lib/fiscal';
import type { RecordedWeekTotals } from '../../lib/metrics';

/**
 * The provider-private book: the whole collection set a provider holds,
 * plus the raw weekly pipeline history. Nothing in this module crosses the
 * seam — the client receives scoped aggregates and cursor pages (see
 * `src/data/DataProvider.ts`), and `src/data/rawSnapshotBoundary.test.ts`
 * enforces that by scanning the source tree for these names.
 *
 * `snapshots` is the sharpest case, and the whole argument for the scoped
 * contract: weekly pipeline history is ~87% of the payload at production
 * volume, and no screen wants it as rows — the week-over-week chart wants
 * fourteen buckets. So the rows live here, in the provider's own module,
 * and leave only as the bounded per-week totals `weeklyRecordingTotals`
 * computes and `getWeeklyForecastSeries()` serves. A provider that has no
 * history may hold an empty array; the series then falls back to what the
 * current book can say.
 */

/**
 * One opportunity's state as it stood at a weekly recording of the open book.
 *
 * This is append-only history, and it exists because current state cannot
 * answer a question about the past. An opportunity row carries one amount, one
 * call, and one expected close date, so reading last week's pipeline off
 * today's book silently backdates every later change: an amount raised this
 * week rewrites the weeks before it, a re-call re-colors them, and a deal that
 * slipped out of the quarter disappears from the weeks it was in rather than
 * showing the drop. A snapshot already written must never change.
 *
 * Salesforce keeps the equivalent in OpportunityHistory and
 * OpportunityFieldHistory; a warehouse would model it as a weekly fact table.
 */
export interface PipelineSnapshot {
  /** UTC Monday midnight the book was recorded at — the close of the prior week. */
  takenAt: string; // ISO 8601
  opportunityId: string;
  /** Forecasted revenue as it stood, not today's figure. */
  forecastedRevenue: number;
  /** The manager's call as it stood. */
  forecastCategory: ForecastCategory;
  stage: OpportunityStage;
  /** Expected close as it stood, so slips in and out of a quarter are visible. */
  expectedCloseDate: string; // ISO 8601
}

/**
 * What a provider holds. None of it crosses the seam as a collection: the
 * client receives scoped aggregates and cursor pages (see
 * `src/data/DataProvider.ts`), never the book.
 */
export interface ProviderBook {
  partnerManagers: PartnerManager[];
  partners: Partner[];
  registrations: DealRegistration[];
  opportunities: Opportunity[];
  targets: Target[];
  activities: ActivityMeeting[];
  certifications: PartnerCertification[];
  /** Internal partner-team roster projected from the identity provider. */
  teamUsers: TeamUser[];
  /** Append-only weekly recordings of the open book. Never corrected. */
  snapshots: PipelineSnapshot[];
}

/**
 * Raw history's only way out: the quarter's recordings folded into one
 * per-category total per recording instant, sorted by instant. This is the
 * bounded input `weeklyForecastRows` consumes — a handful of buckets
 * however large the raw history — and the aggregation every provider
 * implementation performs behind its own seam.
 *
 * A snapshot counts toward the quarter only while its recorded expected
 * close sits inside it: a deal that slips out of the quarter leaves a drop
 * in the weeks that recorded the slip, which is exactly what the chart is
 * for. Every instant that holds at least one snapshot emits a bucket, even
 * one whose deals all clipped out — a recorded zero is a fact (the drop),
 * and must not be confused with a missing recording (which the consumer
 * would reconstruct from today's book). Categories with no recorded deals
 * read as zero, never as absent, so the consumer never has to guess.
 */
export function weeklyRecordingTotals(
  snapshots: readonly PipelineSnapshot[],
  quarter: string,
): RecordedWeekTotals[] {
  const { start, end } = quarterWindow(quarter);
  const qStart = start.getTime();
  const qEnd = end.getTime();
  const byInstant = new Map<number, Record<ForecastCategory, number>>();
  for (const snapshot of snapshots) {
    const takenAt = new Date(snapshot.takenAt).getTime();
    let totals = byInstant.get(takenAt);
    if (totals === undefined) {
      totals = Object.fromEntries(FORECAST_CATEGORIES.map((category) => [category, 0])) as Record<
        ForecastCategory,
        number
      >;
      byInstant.set(takenAt, totals);
    }
    const expectedClose = new Date(snapshot.expectedCloseDate).getTime();
    if (expectedClose < qStart || expectedClose >= qEnd) continue;
    totals[snapshot.forecastCategory] += snapshot.forecastedRevenue;
  }
  return [...byInstant.entries()]
    .sort(([a], [b]) => a - b)
    .map(([instant, raw]) => ({ takenAt: new Date(instant).toISOString(), raw }));
}
