import { useMemo, useState } from 'react';
import Card from '../components/Card';
import ForecastTable from '../components/ForecastTable';
import KpiTile from '../components/KpiTile';
import WeeklyForecastChart from '../components/WeeklyForecastChart';
import { ChevronIcon } from '../components/icons';
import {
  FISCAL_PHASE_META,
  FORECAST_CATEGORY_META,
  SNAPSHOT_DATE,
  STAGE_META,
} from '../data/constants';
import type { DataProvider, ForecastScope } from '../data/DataProvider';
import type { SessionEdits } from '../data/sessionEdits';
import type { ForecastCategory } from '../data/types';
import { useForecastAggregates, useManagerBook, usePartnerNames } from '../data/useForecastQueries';
import { fiscalQuarterOfDate, quarterWindow } from '../lib/fiscal';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import { formatCoverage, phaseForQuarter } from '../lib/metrics';

const quarter = fiscalQuarterOfDate(SNAPSHOT_DATE.toISOString());
const phase = phaseForQuarter(quarter);
const quarterEnd = quarterWindow(quarter).end;

interface ForecastingViewProps {
  provider: DataProvider;
  edits: SessionEdits;
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
  onSetNextStep: (opportunityId: string, nextStep: string) => void;
  onSetForecastCall: (opportunityId: string, category: ForecastCategory) => void;
}

/**
 * Forecasting: the VP of Partnerships' in-quarter view. Callout tiles sum the
 * quarter's sourced pipeline and probability-weighted forecast, then an
 * editable table lists every in-quarter opportunity, filterable by partner
 * manager.
 *
 * This view reads the provider's scoped contract rather than the whole book:
 * five aggregates, the partner directory, and one page of rows per expanded
 * manager. Nothing here scales with the size of the book, which is the claim
 * Phase 1 of docs/migration-plan.md exists to test. It is the first view
 * moved across, and deliberately the hardest: it is the hottest edit path and
 * the only view driven by the weekly snapshots that can never ship whole.
 *
 * Edits ride along with each query instead of being re-applied here, so the
 * tiles, the chart, and the rows are all computed from the same corrected
 * book. A committed edit refetches the aggregates; the table row shows the
 * typed figure immediately either way, because the row renders the session's
 * override over the provider's value.
 */
export default function ForecastingView({
  provider,
  edits,
  onSetRevenue,
  onSetNote,
  onSetNextStep,
  onSetForecastCall,
}: ForecastingViewProps) {
  const [filterManagerId, setFilterManagerId] = useState('all');
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});

  const scope = useMemo<ForecastScope>(() => ({ quarter, edits }), [edits]);
  const aggregates = useForecastAggregates(provider, scope);
  const partnerNames = usePartnerNames(provider);

  const groups = aggregates.data?.groups ?? [];
  const visibleGroups = groups.filter(
    (group) => filterManagerId === 'all' || group.managerId === filterManagerId,
  );

  const filteredCount = visibleGroups.reduce((sum, group) => sum + group.opportunityCount, 0);

  // The first manager opens by default so the page never lands fully collapsed.
  // Toggles are recorded as overrides rather than as a copy of the default, so
  // the default still applies after the groups reload.
  const isExpanded = (managerId: string, index: number) =>
    expandedOverrides[managerId] ?? index === 0;

  const toggleManager = (managerId: string, index: number) =>
    setExpandedOverrides((prev) => ({
      ...prev,
      [managerId]: !(prev[managerId] ?? index === 0),
    }));

  const phaseLabel = FISCAL_PHASE_META[phase].label;

  if (aggregates.loading) {
    return (
      <p className="flex items-center gap-2 py-32 font-mono text-xs uppercase tracking-[0.08em] text-granite">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-signal" />
        Loading the {quarter} forecast
      </p>
    );
  }

  if (!aggregates.data) {
    return (
      <Card title="The forecast did not load">
        <p className="text-sm text-granite">
          {aggregates.error ?? 'The provider returned no data.'}
        </p>
        <button
          type="button"
          onClick={aggregates.retry}
          className="mt-4 rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20"
        >
          Try again
        </button>
      </Card>
    );
  }

  const { summary, weighted, quality, weeks } = aggregates.data;
  const categoryTiles = [...weighted.rows].sort(
    (a, b) => FORECAST_CATEGORY_META[b.category].weight - FORECAST_CATEGORY_META[a.category].weight,
  );
  const mismatchCount = quality.aboveCount + quality.belowCount;
  const startedWeeks = weeks.filter((row) => row.hasStarted).length;
  const recordedWeeks = weeks.filter((row) => row.recordedAt !== undefined).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            In-quarter forecast
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Forecasting</h1>
          <p className="mt-1 text-sm text-granite">
            {FISCAL_PHASE_META[phase].description} · the VP's quick read on {quarter} · snapshot{' '}
            {formatDate(SNAPSHOT_DATE.toISOString())}
          </p>
        </div>
        <div className="flex items-end gap-4">
          {/* Figures stay on screen while the refetch is in flight, so an edit
              never blanks the page it just changed. */}
          {aggregates.refreshing && (
            <span
              role="status"
              className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
            >
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
              Updating
            </span>
          )}
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              Partner manager
            </span>
            <select
              value={filterManagerId}
              onChange={(event) => setFilterManagerId(event.target.value)}
              className="rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none"
            >
              <option value="all">All partner managers</option>
              {groups.map((group) => (
                <option key={group.managerId} value={group.managerId}>
                  {group.managerName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {aggregates.error && (
        <p className="flex flex-wrap items-center gap-3 rounded-card border border-ash p-4 text-sm text-bone">
          <span className="text-signal">Latest refresh failed:</span>
          {aggregates.error}
          <button
            type="button"
            onClick={aggregates.retry}
            className="rounded border border-ash px-3 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20"
          >
            Retry
          </button>
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile
          label="Partner sourced pipeline"
          value={formatUsdCompact(summary.openPipelineValue)}
          sub={`${summary.openCount} open ${phaseLabel} opps`}
        />
        <KpiTile
          label={`Closed-won ${phaseLabel}`}
          value={formatUsdCompact(summary.closedWon)}
          sub={`${Math.round(summary.attainment * 100)}% of ${phaseLabel} goal`}
        />
        <KpiTile
          label="Pipeline coverage to goal"
          value={formatCoverage(summary.coverage)}
          sub={
            summary.coverage.kind === 'coverage'
              ? `${formatUsdCompact(summary.remainingQuota)} goal remaining`
              : summary.coverage.kind === 'target-met'
                ? 'Goal achieved'
                : 'No goal set'
          }
        />
        <KpiTile
          label="Average deal size"
          value={formatUsdCompact(summary.avgOpenDealSize)}
          sub="open opps, in quarter"
        />
        <KpiTile
          label="Days left in quarter"
          value={`${summary.daysLeftInQuarter}`}
          sub={`${quarter} ends ${formatDate(quarterEnd.toISOString())}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile
          label="Weighted forecast"
          value={formatUsdCompact(weighted.total)}
          sub={`open ${phaseLabel} pipeline × category probability`}
        />
        {categoryTiles.map((row) => {
          const meta = FORECAST_CATEGORY_META[row.category];
          return (
            <KpiTile
              key={row.category}
              label={`${meta.label} ${Math.round(meta.weight * 100)}%`}
              value={formatUsdCompact(row.value)}
              sub={`${formatPct(meta.weight)} weighted · ${row.count} opps`}
            />
          );
        })}
      </div>

      <Card
        title="Week-over-week pipeline"
        subtitle={`Open ${phaseLabel} pipeline (solid) vs the probability-weighted forecast (faded), stacked by forecast category · dashed line = ${phaseLabel} revenue goal · ${startedWeeks} of ${weeks.length} weeks in, ${recordedWeeks} from recorded history`}
      >
        <WeeklyForecastChart rows={weeks} goal={summary.target} />
        <p className="mt-4 text-xs text-granite">
          {recordedWeeks} closed weeks are read from the weekly pipeline snapshot, each one the open
          book as it stood that Friday, so they never move: re-call a deal or correct its revenue
          today and only the live week changes. The live week is as of the snapshot date, which is
          why it matches the tiles above. A bar falling week-over-week is pipeline that closed, was
          lost, or slipped out of the quarter — the amount a deal was called at, and the week it
          moved, are both recorded, so the table below says which.
        </p>
      </Card>

      <Card
        title="Calls that disagree with stage"
        subtitle={`${mismatchCount} of ${quality.openCount} open ${phaseLabel} deals are called off the category their stage implies`}
      >
        {mismatchCount === 0 ? (
          <p className="text-sm text-granite">Every open deal is called in line with its stage.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded border border-carbon p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
                  Called above stage
                </p>
                <p className="mt-2 text-2xl tabular-nums text-bone">
                  {formatUsdCompact(quality.aboveValue)}
                </p>
                <p className="mt-1 text-xs text-granite">
                  {quality.aboveCount} deals called more confidently than the funnel supports.
                  Either the stage is stale or the call is optimistic.
                </p>
              </div>
              <div className="rounded border border-carbon p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                  Called below stage
                </p>
                <p className="mt-2 text-2xl tabular-nums text-bone">
                  {formatUsdCompact(quality.belowValue)}
                </p>
                <p className="mt-1 text-xs text-granite">
                  {quality.belowCount} late-funnel deals the manager has downgraded. These still
                  read as healthy on a stage report.
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5">
              {/* Bounded twice: the provider sends a sample, and the view shows
                  it as-is. Neither side can turn this card into a long list. */}
              {quality.sample.map((row) => (
                <li
                  key={row.opportunityId}
                  className="flex flex-wrap items-baseline gap-x-2 text-xs"
                >
                  <span className="text-stone">{row.accountName}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
                    {STAGE_META[row.stage].label} → called{' '}
                    <span className={row.direction === 'above' ? 'text-signal' : 'text-stone'}>
                      {FORECAST_CATEGORY_META[row.called].label}
                    </span>
                  </span>
                  <span className="tabular-nums text-granite">
                    {formatUsdCompact(row.forecastedRevenue)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-xs text-granite">
          Stage is a fact about process; the forecast category is a judgment about whether the deal
          lands. Where they agree the category adds nothing, so these disagreements are the forecast
          conversation. Change any row's category in the table below and every number on this page
          moves with it.
        </p>
      </Card>

      <Card
        title={`In-quarter opportunities · ${quarter}`}
        subtitle={`${filteredCount} opportunities grouped by partner manager · expand a manager to see their book`}
        action={
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            {filterManagerId === 'all'
              ? 'All managers'
              : groups.find((group) => group.managerId === filterManagerId)?.managerName}
          </span>
        }
      >
        <div className="space-y-2">
          {visibleGroups.map((group, index) => {
            const expanded = isExpanded(group.managerId, index);
            return (
              <div key={group.managerId} className="rounded border border-carbon">
                <button
                  type="button"
                  onClick={() => toggleManager(group.managerId, index)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ash/10"
                >
                  <ChevronIcon
                    className={`h-4 w-4 shrink-0 text-granite transition-transform duration-150 ${
                      expanded ? '' : '-rotate-90'
                    }`}
                  />
                  <span className="flex-1 truncate font-mono text-[11px] uppercase tracking-[0.08em] text-bone">
                    {group.managerName}
                  </span>
                  <span className="hidden font-mono text-[10px] uppercase tracking-[0.06em] text-granite sm:inline">
                    {group.opportunityCount} opps
                  </span>
                  <span className="w-24 text-right font-mono text-xs tabular-nums text-stone">
                    {formatUsdCompact(group.openValue)}
                  </span>
                  <span className="w-24 text-right font-mono text-xs tabular-nums text-metric">
                    {formatUsdCompact(group.closedWon)}
                  </span>
                </button>
                {expanded && (
                  <ManagerBook
                    provider={provider}
                    scope={scope}
                    managerId={group.managerId}
                    partnerNames={partnerNames}
                    edits={edits}
                    onSetRevenue={onSetRevenue}
                    onSetNote={onSetNote}
                    onSetNextStep={onSetNextStep}
                    onSetForecastCall={onSetForecastCall}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-granite">
          Columns per manager: open pipeline, then closed-won. Pencil = edit. Revenue edits update
          every metric above and across the app immediately; the forecast category pencil opens the
          dropdown of probability buckets (Commit 90%, Best Case 50%, Pipeline 25%, Long Shot 10%)
          and re-calls the deal, which re-weights the forecast tiles above — closed rows have no
          call left to make; notes are saved as comments and appear on hover over the comment icon;
          next step is the row-level editable action that feeds the roadmap's missing-next-step
          alerts. One page of 25 rows is fetched per expanded manager, not the whole book.
        </p>
      </Card>
    </div>
  );
}

interface ManagerBookProps {
  provider: DataProvider;
  scope: ForecastScope;
  managerId: string;
  partnerNames: Record<string, string>;
  edits: SessionEdits;
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
  onSetNextStep: (opportunityId: string, nextStep: string) => void;
  onSetForecastCall: (opportunityId: string, category: ForecastCategory) => void;
}

/**
 * One manager's book, fetched when their group is expanded. A component rather
 * than a call in the parent's loop because the page state belongs to this
 * manager: collapsing a group and reopening it starts from the first page
 * again, and one manager's failed page cannot take the others down with it.
 */
function ManagerBook({
  provider,
  scope,
  managerId,
  partnerNames,
  edits,
  onSetRevenue,
  onSetNote,
  onSetNextStep,
  onSetForecastCall,
}: ManagerBookProps) {
  const book = useManagerBook(provider, scope, managerId);

  if (book.loading) {
    return (
      <p className="border-t border-carbon px-4 py-6 font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
        Loading {managerId}…
      </p>
    );
  }

  if (book.error) {
    return (
      <p className="flex flex-wrap items-center gap-3 border-t border-carbon px-4 py-6 text-sm text-granite">
        <span className="text-signal">This book did not load.</span>
        {book.error}
        <button
          type="button"
          onClick={book.retry}
          className="rounded border border-ash px-3 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20"
        >
          Retry
        </button>
      </p>
    );
  }

  return (
    <div className="border-t border-carbon px-4 pb-4 pt-2">
      <ForecastTable
        opportunities={book.rows}
        partnerNames={partnerNames}
        revenueOverrides={edits.revenueOverrides}
        notes={edits.notes}
        nextSteps={edits.nextSteps}
        onSetRevenue={onSetRevenue}
        onSetNote={onSetNote}
        onSetNextStep={onSetNextStep}
        onSetForecastCall={onSetForecastCall}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Showing {book.rows.length} of {book.totalCount}
        </p>
        {book.hasMore && (
          <button
            type="button"
            onClick={book.loadMore}
            disabled={book.loadingMore}
            className="rounded border border-ash px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-stone transition-colors hover:bg-ash/20 disabled:opacity-50"
          >
            {book.loadingMore ? 'Loading…' : 'Load 25 more'}
          </button>
        )}
      </div>
    </div>
  );
}
