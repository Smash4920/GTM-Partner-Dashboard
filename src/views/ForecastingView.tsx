import { useMemo, useState } from 'react';
import Card from '../components/Card';
import ForecastTable from '../components/ForecastTable';
import KpiTile from '../components/KpiTile';
import { ChevronIcon } from '../components/icons';
import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  FORECAST_CATEGORY_META,
  SNAPSHOT_DATE,
  STAGE_META,
} from '../data/constants';
import type { DashboardData, FiscalPhase, ForecastCategory } from '../data/types';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import { fiscalQuarterOfDate, quarterWindow } from '../lib/fiscal';
import {
  avgOpenDealSize,
  categoryStageMismatches,
  closedWonForPhase,
  coverageRatio,
  daysLeftInQuarter,
  filterByPhase,
  formatCoverage,
  openOpportunities,
  openPipeline,
  remainingQuota,
  targetsForPhase,
  weightedForecast,
} from '../lib/metrics';

const quarter = fiscalQuarterOfDate(SNAPSHOT_DATE.toISOString());
const phase =
  (FISCAL_PHASES.find((candidate) => FISCAL_PHASE_META[candidate].quarter === quarter) as Exclude<
    FiscalPhase,
    'fy'
  > | undefined) ?? 'q1';
const quarterEnd = quarterWindow(quarter).end;

interface ForecastingViewProps {
  data: DashboardData;
  revenueOverrides: Record<string, number>;
  notes: Record<string, string>;
  nextSteps: Record<string, string>;
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
  onSetNextStep: (opportunityId: string, nextStep: string) => void;
  onSetForecastCall: (opportunityId: string, category: ForecastCategory) => void;
}

/**
 * Forecasting: the VP of Partnerships' in-quarter view. Callout tiles sum the
 * quarter's sourced pipeline and probability-weighted forecast, then an
 * editable table lists every in-quarter opportunity, filterable by partner
 * manager. Revenue and Notes carry a pencil so managers can correct
 * Salesforce locally; Next Step is the row-level editable action.
 */
export default function ForecastingView({
  data,
  revenueOverrides,
  notes,
  nextSteps,
  onSetRevenue,
  onSetNote,
  onSetNextStep,
  onSetForecastCall,
}: ForecastingViewProps) {
  const [filterManagerId, setFilterManagerId] = useState('all');
  // First manager opens by default so the page never lands fully collapsed.
  const [expandedManagers, setExpandedManagers] = useState<string[]>(() =>
    data.partnerManagers[0] ? [data.partnerManagers[0].id] : [],
  );

  const toggleManager = (managerId: string) =>
    setExpandedManagers((prev) =>
      prev.includes(managerId)
        ? prev.filter((id) => id !== managerId)
        : [...prev, managerId],
    );

  const phaseLabel = FISCAL_PHASE_META[phase].label;

  const inQuarterOpps = useMemo(
    () => filterByPhase(data.opportunities, phase),
    [data.opportunities, phase],
  );

  // Opportunities are grouped under the partner manager who owns the partner
  // account, so the VP expands one manager at a time rather than reading one
  // flat 65-row table.
  const groups = useMemo(() => {
    const managerByPartner = new Map(
      data.partners.map((partner) => [partner.id, partner.partnerManagerId]),
    );
    return data.partnerManagers
      .filter((manager) => filterManagerId === 'all' || manager.id === filterManagerId)
      .map((manager) => {
        const opportunities = inQuarterOpps.filter(
          (opp) => managerByPartner.get(opp.partnerId) === manager.id,
        );
        const open = openPipeline(opportunities);
        return {
          manager,
          opportunities,
          openValue: open.value,
          openCount: open.count,
          closedWon: closedWonForPhase(opportunities, phase),
        };
      });
  }, [data.partners, data.partnerManagers, inQuarterOpps, filterManagerId, phase]);

  const groupedCount = useMemo(
    () => groups.reduce((sum, group) => sum + group.opportunities.length, 0),
    [groups],
  );

  const openInQuarter = useMemo(() => openPipeline(inQuarterOpps), [inQuarterOpps]);
  const closedWon = useMemo(
    () => closedWonForPhase(inQuarterOpps, phase),
    [inQuarterOpps, phase],
  );
  const target = useMemo(
    () => targetsForPhase(data.targets, phase).reduce((sum, t) => sum + t.revenueTarget, 0),
    [data.targets, phase],
  );
  const coverage = useMemo(
    () => coverageRatio(inQuarterOpps, data.targets, phase),
    [inQuarterOpps, data.targets, phase],
  );
  const remaining = useMemo(
    () => remainingQuota(inQuarterOpps, data.targets, phase),
    [inQuarterOpps, data.targets, phase],
  );
  const avgDeal = useMemo(() => avgOpenDealSize(inQuarterOpps), [inQuarterOpps]);
  const attainment = target > 0 ? closedWon / target : 0;
  const daysLeft = useMemo(() => daysLeftInQuarter(quarter), [quarter]);

  // Weighted forecast: each open deal contributes its revenue × the
  // probability weight of its forecast category (commit 90%, best case 50%,
  // pipeline 25%, long shot 10%), so the total is expected revenue, not raw
  // pipeline.
  const openInQuarterOpps = useMemo(() => openOpportunities(inQuarterOpps), [inQuarterOpps]);
  const weighted = useMemo(() => weightedForecast(openInQuarterOpps), [openInQuarterOpps]);
  const categoryTiles = useMemo(
    () =>
      [...weighted.rows].sort(
        (a, b) => FORECAST_CATEGORY_META[b.category].weight - FORECAST_CATEGORY_META[a.category].weight,
      ),
    [weighted],
  );

  // Deals whose called category disagrees with their stage. This is the only
  // place the forecast stops being a restatement of the pipeline report: a
  // Commit in Discovery and a Long Shot in Deal Desk Review both need a
  // conversation, and neither is visible from stage alone.
  const mismatches = useMemo(
    () => categoryStageMismatches(openInQuarterOpps),
    [openInQuarterOpps],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">In-quarter forecast</p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Forecasting</h1>
          <p className="mt-1 text-sm text-granite">
            {FISCAL_PHASE_META[phase].description} · the VP's quick read on{' '}
            {quarter} · snapshot {formatDate(SNAPSHOT_DATE.toISOString())}
          </p>
        </div>
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
            {data.partnerManagers.map((manager) => (
              <option key={manager.id} value={manager.id}>
                {manager.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiTile
          label="Partner sourced pipeline"
          value={formatUsdCompact(openInQuarter.value)}
          sub={`${openInQuarter.count} open ${phaseLabel} opps`}
        />
        <KpiTile
          label={`Closed-won ${phaseLabel}`}
          value={formatUsdCompact(closedWon)}
          sub={`${Math.round(attainment * 100)}% of ${phaseLabel} goal`}
        />
        <KpiTile
          label="Pipeline coverage to goal"
          value={formatCoverage(coverage)}
          sub={
            remaining > 0
              ? `${formatUsdCompact(remaining)} goal remaining`
              : 'Goal achieved'
          }
        />
        <KpiTile
          label="Average deal size"
          value={formatUsdCompact(avgDeal)}
          sub="open opps, in quarter"
        />
        <KpiTile
          label="Days left in quarter"
          value={`${daysLeft}`}
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
        title="Calls that disagree with stage"
        subtitle={`${mismatches.above.length + mismatches.below.length} of ${openInQuarterOpps.length} open ${phaseLabel} deals are called off the category their stage implies`}
      >
        {mismatches.above.length + mismatches.below.length === 0 ? (
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
                  {formatUsdCompact(mismatches.aboveValue)}
                </p>
                <p className="mt-1 text-xs text-granite">
                  {mismatches.above.length} deals called more confidently than the funnel
                  supports. Either the stage is stale or the call is optimistic.
                </p>
              </div>
              <div className="rounded border border-carbon p-4">
                <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                  Called below stage
                </p>
                <p className="mt-2 text-2xl tabular-nums text-bone">
                  {formatUsdCompact(mismatches.belowValue)}
                </p>
                <p className="mt-1 text-xs text-granite">
                  {mismatches.below.length} late-funnel deals the manager has downgraded. These
                  still read as healthy on a stage report.
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-1.5">
              {/* Up to three of each, so a long list of optimistic calls never
                  crowds out the downgraded late-stage deals. */}
              {[...mismatches.above.slice(0, 3), ...mismatches.below.slice(0, 3)].map((row) => (
                <li
                  key={row.opportunity.id}
                  className="flex flex-wrap items-baseline gap-x-2 text-xs"
                >
                  <span className="text-stone">{row.opportunity.accountName}</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
                    {STAGE_META[row.opportunity.stage].label} → called{' '}
                    <span className={row.direction === 'above' ? 'text-signal' : 'text-stone'}>
                      {FORECAST_CATEGORY_META[row.called].label}
                    </span>
                  </span>
                  <span className="tabular-nums text-granite">
                    {formatUsdCompact(row.opportunity.forecastedRevenue)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="mt-4 text-xs text-granite">
          Stage is a fact about process; the forecast category is a judgment about whether the
          deal lands. Where they agree the category adds nothing, so these disagreements are the
          forecast conversation. Change any row's category in the table below and every number on
          this page moves with it.
        </p>
      </Card>

      <Card
        title={`In-quarter opportunities · ${quarter}`}
        subtitle={`${groupedCount} opportunities grouped by partner manager · expand a manager to see their book`}
        action={
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            {filterManagerId === 'all'
              ? 'All managers'
              : data.partnerManagers.find((m) => m.id === filterManagerId)?.name}
          </span>
        }
      >
        <div className="space-y-2">
          {groups.map((group) => {
            const expanded = expandedManagers.includes(group.manager.id);
            return (
              <div key={group.manager.id} className="rounded border border-carbon">
                <button
                  type="button"
                  onClick={() => toggleManager(group.manager.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-ash/10"
                >
                  <ChevronIcon
                    className={`h-4 w-4 shrink-0 text-granite transition-transform duration-150 ${
                      expanded ? '' : '-rotate-90'
                    }`}
                  />
                  <span className="flex-1 truncate font-mono text-[11px] uppercase tracking-[0.08em] text-bone">
                    {group.manager.name}
                  </span>
                  <span className="hidden font-mono text-[10px] uppercase tracking-[0.06em] text-granite sm:inline">
                    {group.opportunities.length} opps
                  </span>
                  <span className="w-24 text-right font-mono text-xs tabular-nums text-stone">
                    {formatUsdCompact(group.openValue)}
                  </span>
                  <span className="w-24 text-right font-mono text-xs tabular-nums text-metric">
                    {formatUsdCompact(group.closedWon)}
                  </span>
                </button>
                {expanded && (
                  <div className="border-t border-carbon px-4 pb-4 pt-2">
                    <ForecastTable
                      opportunities={group.opportunities}
                      partners={data.partners}
                      revenueOverrides={revenueOverrides}
                      notes={notes}
                      nextSteps={nextSteps}
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
        <p className="mt-4 text-xs text-granite">
          Columns per manager: open pipeline, then closed-won. Pencil = edit. Revenue edits
          update every metric above and across the app immediately; notes are saved as comments
          and appear on hover over the comment icon; next step is the row-level editable action
          that feeds the roadmap's missing-next-step alerts.
        </p>
      </Card>
    </div>
  );
}
