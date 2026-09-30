import { useEffect, useMemo, useState } from 'react';
import Card from '../components/Card';
import ForecastTable from '../components/ForecastTable';
import KpiTile from '../components/KpiTile';
import {
  QueryFailure,
  QueryMetaCaption,
  renderQueryState,
  useRetryRecovery,
} from '../components/QueryState';
import WeeklyForecastChart from '../components/WeeklyForecastChart';
import { ChevronIcon } from '../components/icons';
import {
  FISCAL_PHASE_META,
  FORECAST_CATEGORY_META,
  SNAPSHOT_DATE,
  STAGE_META,
} from '../data/constants';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import type { DemoAccessScope } from '../data/accessScope';
import type { DataProvider, ForecastScope } from '../data/DataProvider';
import type { SessionEdits } from '../data/sessionEdits';
import type { ForecastCategory } from '../data/types';
import {
  useForecastQuality,
  useForecastSummary,
  useManagerBook,
  useManagerGroups,
  usePartnerNames,
  useWeeklySeries,
  useWeightedForecast,
} from '../data/useForecastQueries';
import { fiscalQuarterOfDate, quarterWindow } from '../lib/fiscal';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import { formatCoverage, phaseForQuarter } from '../lib/metrics';

const quarter = fiscalQuarterOfDate(SNAPSHOT_DATE.toISOString());
const phase = phaseForQuarter(quarter);
const quarterEnd = quarterWindow(quarter).end;

/** The edit intents every forecast row can dispatch. */
interface ForecastEditHandlers {
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
  onSetNextStep: (opportunityId: string, nextStep: string) => void;
  onSetForecastCall: (opportunityId: string, category: ForecastCategory) => void;
}

interface ForecastingViewProps extends ForecastEditHandlers {
  provider: DataProvider;
  edits: SessionEdits;
}

/**
 * Forecasting: the VP of Partnerships' in-quarter view. Callout tiles sum the
 * quarter's sourced pipeline and probability-weighted forecast, then an
 * editable table lists every in-quarter opportunity, filterable by partner
 * manager. The manager filter also scopes the summary tiles — target,
 * remaining quota, attainment, and coverage — to that manager's own partner
 * set; the weighted forecast, quality, and weekly history stay
 * quarter-level.
 *
 * This view reads the provider's scoped contract rather than the whole book:
 * five aggregates, the partner directory, and one page of rows per expanded
 * manager — each an independent query with its own loading, error, and retry
 * state, so one slow or failed call blanks exactly one widget. Nothing here
 * scales with the size of the book, which is the claim Phase 1 of
 * docs/migration-plan.md exists to test.
 *
 * Edits ride along with each query instead of being re-applied here, so the
 * tiles, the chart, and the rows are all computed from the same corrected
 * book. Invalidation is narrow: a revenue edit refetches everything, a
 * forecast re-call refetches the weighted forecast, quality, series, and open
 * books but not the summary or groups it cannot move, and a note or next step
 * refetches nothing — the row renders the session's value immediately either
 * way, because it overlays the edit on the provider's figure.
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
  // A group that was ever expanded keeps its book mounted (hidden while
  // collapsed), so reopening it neither refetches nor forgets loaded pages.
  const [openedOnce, setOpenedOnce] = useState<Record<string, boolean>>({});

  const scope = useMemo<ForecastScope>(() => ({ quarter, edits }), [edits]);
  // The summary follows the manager filter: a manager's target, remaining
  // quota, attainment, and coverage are only honest against the targets
  // committed to their own partners, so the selection is a query input
  // rather than a client-side re-read of the org answer. 'All partner
  // managers' restores the organization scope.
  const summaryScope = useMemo<ForecastScope>(
    () =>
      filterManagerId === 'all'
        ? { quarter, edits }
        : { quarter, partnerManagerId: filterManagerId, edits },
    [edits, filterManagerId],
  );
  // The shell's audience is the internal team; the partner audience exists
  // on the contract and in its conformance tests, not behind this view.
  const summary = useForecastSummary(provider, INTERNAL_DEMO_SCOPE, summaryScope);
  const weighted = useWeightedForecast(provider, INTERNAL_DEMO_SCOPE, scope);
  const quality = useForecastQuality(provider, INTERNAL_DEMO_SCOPE, scope);
  const managerGroups = useManagerGroups(provider, INTERNAL_DEMO_SCOPE, scope);
  const weeks = useWeeklySeries(provider, INTERNAL_DEMO_SCOPE, scope);
  const directory = usePartnerNames(provider, INTERNAL_DEMO_SCOPE);
  // The directory's retry gets the same focus recovery as every other
  // query: a successful retry lands focus on the named region, not the body.
  const directoryRecovery = useRetryRecovery('partner directory', directory.error !== null);

  const groups = managerGroups.data ?? [];
  const visibleGroups = groups.filter(
    (group) => filterManagerId === 'all' || group.managerId === filterManagerId,
  );
  // The first visible manager opens by default so the page never lands fully
  // collapsed. Toggles are recorded as overrides rather than as a copy of the
  // default, so the default still applies after the groups reload.
  const firstVisibleManagerId = visibleGroups[0]?.managerId;
  const filteredCount = visibleGroups.reduce((sum, group) => sum + group.opportunityCount, 0);

  const isExpanded = (managerId: string) =>
    expandedOverrides[managerId] ?? managerId === firstVisibleManagerId;

  // Record every group that renders expanded — by default or by toggle — so
  // its book stays mounted (hidden while collapsed or filtered out) and never
  // refetches for a presentation-only change.
  const expandedKey = groups
    .filter((group) => isExpanded(group.managerId))
    .map((group) => group.managerId)
    .join('|');
  useEffect(() => {
    if (expandedKey === '') return;
    setOpenedOnce((prev) => {
      const next = { ...prev };
      for (const managerId of expandedKey.split('|')) next[managerId] = true;
      return next;
    });
  }, [expandedKey]);

  const toggleManager = (managerId: string) =>
    setExpandedOverrides((prev) => ({ ...prev, [managerId]: !isExpanded(managerId) }));

  const refreshing =
    summary.refreshing ||
    weighted.refreshing ||
    quality.refreshing ||
    managerGroups.refreshing ||
    weeks.refreshing;

  const phaseLabel = FISCAL_PHASE_META[phase].label;
  const startedWeeks = (weeks.data ?? []).filter((row) => row.hasStarted).length;
  const recordedWeeks = (weeks.data ?? []).filter((row) => row.recordedAt !== undefined).length;

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
          {/* Figures stay on screen while a refetch is in flight, so an edit
              never blanks the page it just changed. */}
          {refreshing && (
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

      {renderQueryState('forecast summary', summary, (summaryData) => (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiTile
            label="Partner sourced pipeline"
            value={formatUsdCompact(summaryData.openPipelineValue)}
            sub={`${summaryData.openCount} open ${phaseLabel} opps`}
          />
          <KpiTile
            label={`Closed-won ${phaseLabel}`}
            value={formatUsdCompact(summaryData.closedWon)}
            sub={`${Math.round(summaryData.attainment * 100)}% of ${phaseLabel} goal`}
          />
          <KpiTile
            label="Pipeline coverage to goal"
            value={formatCoverage(summaryData.coverage)}
            sub={
              summaryData.coverage.kind === 'coverage'
                ? `${formatUsdCompact(summaryData.remainingQuota)} goal remaining`
                : summaryData.coverage.kind === 'target-met'
                  ? 'Goal achieved'
                  : 'No goal set'
            }
          />
          <KpiTile
            label="Average deal size"
            value={formatUsdCompact(summaryData.avgOpenDealSize)}
            sub="open opps, in quarter"
          />
          <KpiTile
            label="Days left in quarter"
            value={`${summaryData.daysLeftInQuarter}`}
            sub={`${quarter} ends ${formatDate(quarterEnd.toISOString())}`}
          />
        </div>
      ))}

      {renderQueryState('weighted forecast', weighted, (weightedData) => {
        const categoryTiles = [...weightedData.rows].sort(
          (a, b) =>
            FORECAST_CATEGORY_META[b.category].weight - FORECAST_CATEGORY_META[a.category].weight,
        );
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <KpiTile
              label="Weighted forecast"
              value={formatUsdCompact(weightedData.total)}
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
        );
      })}

      <Card
        title="Week-over-week pipeline"
        subtitle={`Open ${phaseLabel} pipeline (solid) vs the probability-weighted forecast (faded), stacked by forecast category${
          filterManagerId === 'all'
            ? ` · dashed line = ${phaseLabel} revenue goal`
            : ' · organization-level history: snapshots do not record manager ownership'
        }${
          weeks.data !== null
            ? ` · ${startedWeeks} of ${weeks.data.length} weeks in, ${recordedWeeks} from recorded history`
            : ''
        }`}
      >
        {renderQueryState('weekly series', weeks, (rows) => (
          <>
            {/* The goal line comes from the summary query, which fails and
                retries on its own; the chart draws without it meanwhile.
                While a manager filter is active the line sits out entirely:
                the bars are organization-level history, so a manager-scoped
                goal drawn across them would mix two scopes in one picture. */}
            <WeeklyForecastChart
              rows={rows}
              goal={filterManagerId === 'all' ? summary.data?.target : undefined}
            />
            <p className="mt-4 text-xs text-granite">
              {recordedWeeks} closed weeks are read from the weekly pipeline snapshot, each one the
              open book as it stood that Friday, so they never move: re-call a deal or correct its
              revenue today and only the live week changes. The live week is as of the snapshot
              date, which is why it matches the tiles above. A bar falling week-over-week is
              pipeline that closed, was lost, or slipped out of the quarter — the amount a deal was
              called at, and the week it moved, are both recorded, so the table below says which.
            </p>
          </>
        ))}
      </Card>

      <Card
        title="Calls that disagree with stage"
        subtitle={
          quality.data !== null
            ? `${quality.data.aboveCount + quality.data.belowCount} of ${quality.data.openCount} open ${phaseLabel} deals are called off the category their stage implies`
            : `Open ${phaseLabel} deals called off the category their stage implies`
        }
      >
        {renderQueryState('forecast quality', quality, (qualityData) => {
          const mismatchCount = qualityData.aboveCount + qualityData.belowCount;
          return mismatchCount === 0 ? (
            <p className="text-sm text-granite">
              Every open deal is called in line with its stage.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded border border-carbon p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-signal">
                    Called above stage
                  </p>
                  <p className="mt-2 text-2xl tabular-nums text-bone">
                    {formatUsdCompact(qualityData.aboveValue)}
                  </p>
                  <p className="mt-1 text-xs text-granite">
                    {qualityData.aboveCount} deals called more confidently than the funnel supports.
                    Either the stage is stale or the call is optimistic.
                  </p>
                </div>
                <div className="rounded border border-carbon p-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                    Called below stage
                  </p>
                  <p className="mt-2 text-2xl tabular-nums text-bone">
                    {formatUsdCompact(qualityData.belowValue)}
                  </p>
                  <p className="mt-1 text-xs text-granite">
                    {qualityData.belowCount} late-funnel deals the manager has downgraded. These
                    still read as healthy on a stage report.
                  </p>
                </div>
              </div>
              <ul className="mt-4 space-y-1.5">
                {/* Bounded twice: the provider sends a sample, and the view shows
                    it as-is. Neither side can turn this card into a long list. */}
                {qualityData.sample.map((row) => (
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
          );
        })}
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
        {/* The directory is a dimension lookup, not forecast data: a failure
            degrades the partner column to opaque ids, with a retry offered,
            instead of taking the table down. Its envelope renders too —
            provider, as-of, completeness, and every warning — so a partial
            directory can never pass for a complete one. */}
        {(directory.meta !== null || directory.error !== null) && (
          <div ref={directoryRecovery.regionRef} {...directoryRecovery.regionProps}>
            {directory.meta !== null && (
              <QueryMetaCaption meta={directory.meta} refreshing={directory.refreshing} />
            )}
            {directory.error !== null && (
              <QueryFailure
                text="Partner names unavailable — showing partner ids"
                retryLabel="partner directory"
                error={directory.error}
                onRetry={directoryRecovery.armRetry(directory.retry)}
              />
            )}
          </div>
        )}
        {renderQueryState('manager groups', managerGroups, () => (
          <div className="space-y-2">
            {groups.map((group) => {
              const visible = filterManagerId === 'all' || group.managerId === filterManagerId;
              const expanded = isExpanded(group.managerId);
              const mounted = expanded || openedOnce[group.managerId] === true;
              return (
                // Filtered-out groups hide rather than unmount: the filter is
                // a presentation choice and must not refetch or discard a
                // manager's loaded pages.
                <div
                  key={group.managerId}
                  className="rounded border border-carbon"
                  hidden={!visible}
                >
                  <button
                    type="button"
                    onClick={() => toggleManager(group.managerId)}
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
                  {mounted && (
                    <div hidden={!expanded}>
                      <ManagerBook
                        provider={provider}
                        access={INTERNAL_DEMO_SCOPE}
                        scope={scope}
                        managerId={group.managerId}
                        partnerNames={directory.names}
                        edits={edits}
                        onSetRevenue={onSetRevenue}
                        onSetNote={onSetNote}
                        onSetNextStep={onSetNextStep}
                        onSetForecastCall={onSetForecastCall}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
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

interface ManagerBookProps extends ForecastEditHandlers {
  provider: DataProvider;
  access: DemoAccessScope;
  scope: ForecastScope;
  managerId: string;
  partnerNames: Record<string, string>;
  edits: SessionEdits;
}

/**
 * One manager's book, fetched when their group is expanded. A component rather
 * than a call in the parent's loop because the page state belongs to this
 * manager: one manager's failed page cannot take the others down with it, and
 * each book retries, refreshes, and pages on its own.
 */
function ManagerBook({
  provider,
  access,
  scope,
  managerId,
  partnerNames,
  edits,
  onSetRevenue,
  onSetNote,
  onSetNextStep,
  onSetForecastCall,
}: ManagerBookProps) {
  const book = useManagerBook(provider, access, scope, managerId);
  // The recovery region survives the failure → recovered transition, so a
  // successful retry lands focus on the named book rather than the body.
  const recovery = useRetryRecovery(`manager book ${managerId}`, book.error !== null);
  const onRetry = recovery.armRetry(book.retry);

  return (
    <div ref={recovery.regionRef} {...recovery.regionProps}>
      {book.loading ? (
        <p className="border-t border-carbon px-4 py-6 font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
          Loading {managerId}…
        </p>
      ) : book.rows.length === 0 && book.error !== null ? (
        <div className="border-t border-carbon px-4 py-4">
          <QueryFailure
            text="This book did not load"
            retryLabel="this manager’s book"
            error={book.error}
            onRetry={onRetry}
          />
        </div>
      ) : (
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
              {book.refreshing && ' · updating'}
            </p>
            <span className="flex flex-wrap items-center gap-3">
              {/* A failed page or refresh keeps the rows already on screen;
                  retry repeats the failed request, not the whole book. */}
              {book.error !== null && (
                <QueryFailure
                  text="The latest page failed"
                  retryLabel="this manager’s book"
                  error={book.error}
                  onRetry={onRetry}
                />
              )}
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
            </span>
          </div>
          {/* The rows' own provenance: which provider answered, as of when,
              and whether the answer was complete. Kept as its own line so the
              "Showing N of M" count stays a stable, exact label. */}
          {book.meta !== null && (
            <div className="mt-2">
              <QueryMetaCaption meta={book.meta} refreshing={book.refreshing} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
