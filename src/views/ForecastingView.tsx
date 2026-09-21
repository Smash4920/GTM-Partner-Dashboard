import { useMemo, useState } from 'react';
import Card from '../components/Card';
import ForecastTable from '../components/ForecastTable';
import KpiTile from '../components/KpiTile';
import { ChevronIcon } from '../components/icons';
import {
  CURRENT_FISCAL_QUARTER,
  FISCAL_PHASE_META,
  SNAPSHOT_DATE,
} from '../data/constants';
import type { DashboardData } from '../data/types';
import { formatDate, formatUsdCompact } from '../lib/format';
import {
  avgOpenDealSize,
  closedWonForPhase,
  coverageRatio,
  daysLeftInQuarter,
  filterByPhase,
  formatCoverage,
  openPipeline,
  remainingQuota,
  targetsForPhase,
} from '../lib/metrics';

interface ForecastingViewProps {
  data: DashboardData;
  revenueOverrides: Record<string, number>;
  notes: Record<string, string>;
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
}

/**
 * Forecasting: the VP of Partnerships' in-quarter view. Callout tiles sum the
 * quarter's sourced pipeline and closed book, then an editable table lists
 * every in-quarter opportunity, filterable by partner manager. Revenue and
 * Notes carry a pencil so managers can correct Salesforce locally.
 */
export default function ForecastingView({
  data,
  revenueOverrides,
  notes,
  onSetRevenue,
  onSetNote,
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

  const quarter = CURRENT_FISCAL_QUARTER; // 'FY27-Q3'
  const phase = 'q3';
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">In-quarter forecast</p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Forecasting</h1>
          <p className="mt-1 text-sm text-granite">
            {FISCAL_PHASE_META[phase].description} · the VP's quick read on{' '}
            {CURRENT_FISCAL_QUARTER} · snapshot {formatDate(SNAPSHOT_DATE.toISOString())}
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
          sub={`${CURRENT_FISCAL_QUARTER} ends Nov 1`}
        />
      </div>

      <Card
        title={`In-quarter opportunities · ${CURRENT_FISCAL_QUARTER}`}
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
                      onSetRevenue={onSetRevenue}
                      onSetNote={onSetNote}
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
          and appear on hover over the comment icon.
        </p>
      </Card>
    </div>
  );
}
