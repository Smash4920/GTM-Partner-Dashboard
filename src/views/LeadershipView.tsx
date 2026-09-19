import { useMemo, useState } from 'react';
import Card from '../components/Card';
import FilterChips, { type ChipOption } from '../components/FilterChips';
import KpiTile from '../components/KpiTile';
import Leaderboard from '../components/Leaderboard';
import LightCard from '../components/LightCard';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import RegistrationsTable from '../components/RegistrationsTable';
import RevenueTrend from '../components/RevenueTrend';
import {
  CURRENT_YEAR,
  LOST_COLOR,
  OPP_TYPES,
  OPP_TYPE_META,
  QUARTERS,
  SNAPSHOT_DATE,
  STAGE_META,
  WON_COLOR,
} from '../data/constants';
import type { DashboardData, OpportunityType } from '../data/types';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import {
  activePartnerCount,
  approvalRate,
  avgOpenDealSize,
  closedWonPriorYearSamePeriod,
  closedWonYtd,
  coverageRatio,
  filterByType,
  formatCoverage,
  openPipeline,
  outcomeTotals,
  partnerLeaderboard,
  pendingRegistrations,
  quarterlyClosedWonAndTarget,
  registrationConversionRate,
  remainingQuota,
  registrationFunnel,
  stageBreakdown,
  typeBreakdown,
  winRateYtd,
  ytdTarget,
} from '../lib/metrics';

type TypeFilter = OpportunityType | 'all';
type FunnelMeasure = 'value' | 'count';

const TYPE_OPTIONS: ChipOption<TypeFilter>[] = [
  { id: 'all', label: 'All', title: 'All opportunity types' },
  ...OPP_TYPES.map((type) => ({
    id: type as TypeFilter,
    label: OPP_TYPE_META[type].label,
    title: OPP_TYPE_META[type].description,
  })),
];

const FUNNEL_MEASURE_OPTIONS: ChipOption<FunnelMeasure>[] = [
  { id: 'value', label: 'Registered $', title: 'Partner-estimated deal value at submission' },
  { id: 'count', label: 'Count', title: 'Number of registrations' },
];

/** Internal GTM leadership view: every partner, the full registration → pipeline journey. */
export default function LeadershipView({ data }: { data: DashboardData }) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [funnelMeasure, setFunnelMeasure] = useState<FunnelMeasure>('value');

  const opps = useMemo(
    () => filterByType(data.opportunities, typeFilter),
    [data.opportunities, typeFilter],
  );
  const funnel = useMemo(() => registrationFunnel(data.registrations), [data.registrations]);
  const stages = useMemo(() => stageBreakdown(opps), [opps]);
  const outcomes = useMemo(() => outcomeTotals(opps), [opps]);
  const types = useMemo(() => typeBreakdown(data.opportunities), [data.opportunities]);
  const quarterly = useMemo(
    () => quarterlyClosedWonAndTarget(opps, data.targets),
    [opps, data.targets],
  );
  const leaderboard = useMemo(() => partnerLeaderboard(data, typeFilter), [data, typeFilter]);
  const pending = useMemo(() => pendingRegistrations(data.registrations), [data.registrations]);

  const pipeline = openPipeline(opps);
  const ytdWon = closedWonYtd(opps);
  const priorWon = closedWonPriorYearSamePeriod(opps);
  const wonDelta = priorWon > 0 ? ytdWon / priorWon - 1 : 0;
  const ytdTargetTotal = ytdTarget(data.targets);
  const attainment = ytdTargetTotal > 0 ? ytdWon / ytdTargetTotal : 0;
  const coverage = coverageRatio(opps, data.targets);
  const remaining = remainingQuota(opps, data.targets);

  // One measure drives both the bar length and the printed number, so the
  // panel never mixes registration counts with registered dollars.
  const funnelStages: {
    label: string;
    count: number;
    amount: number;
    color: string;
    dimmed?: boolean;
  }[] = [
    {
      label: 'Submitted',
      count: funnel.submitted,
      amount: funnel.submittedValue,
      color: '#8a8380',
    },
    {
      label: 'Approved',
      count: funnel.approved,
      amount: funnel.approvedValue,
      color: '#b8b3b0',
    },
    {
      label: 'Converted to opp',
      count: funnel.converted,
      amount: funnel.convertedValue,
      color: '#a0ca92',
    },
    {
      label: 'Rejected',
      count: funnel.rejected,
      amount: funnel.rejectedValue,
      color: '#4d4947',
      dimmed: true,
    },
    {
      label: 'Pending review',
      count: funnel.pending,
      amount: funnel.pendingValue,
      color: '#ee6018',
    },
  ];

  const funnelRows: MetricBarRow[] = funnelStages.map((stage) => ({
    label: stage.label,
    value: funnelMeasure === 'value' ? stage.amount : stage.count,
    displayValue:
      funnelMeasure === 'value' ? formatUsdCompact(stage.amount) : `${stage.count}`,
    secondary:
      funnelMeasure === 'value'
        ? `${stage.count} regs`
        : formatUsdCompact(stage.amount),
    color: stage.color,
    dimmed: stage.dimmed,
  }));

  const stageRows: MetricBarRow[] = [
    ...stages.map((row) => ({
      label: STAGE_META[row.stage].label,
      value: row.value,
      displayValue: formatUsdCompact(row.value),
      secondary: `${row.count} open`,
      color: STAGE_META[row.stage].color,
    })),
    {
      label: 'Won (all time)',
      value: outcomes.wonValue,
      displayValue: formatUsdCompact(outcomes.wonValue),
      secondary: `${outcomes.wonCount} won`,
      color: WON_COLOR,
    },
    {
      label: 'Lost (all time)',
      value: outcomes.lostValue,
      displayValue: formatUsdCompact(outcomes.lostValue),
      secondary: `${outcomes.lostCount} lost`,
      color: LOST_COLOR,
      dimmed: true,
    },
  ];

  const typeRows: MetricBarRow[] = types.map((row) => ({
    label: OPP_TYPE_META[row.type].label,
    value: row.value,
    displayValue: formatUsdCompact(row.value),
    secondary: `${row.count} open`,
    color: OPP_TYPE_META[row.type].color,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            All partners
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Partner revenue pipeline</h1>
          <p className="mt-1 text-sm text-granite">
            {QUARTERS[0]} → {QUARTERS[QUARTERS.length - 1]} · snapshot{' '}
            {formatDate(SNAPSHOT_DATE.toISOString())}
          </p>
        </div>
        <FilterChips
          options={TYPE_OPTIONS}
          value={typeFilter}
          onChange={setTypeFilter}
          ariaLabel="Filter by opportunity type"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Open pipeline"
          value={formatUsdCompact(pipeline.value)}
          sub={`${pipeline.count} open opps`}
        />
        <KpiTile
          label="Closed-won YTD"
          value={formatUsdCompact(ytdWon)}
          delta={{
            text: `${wonDelta >= 0 ? '+' : ''}${formatPct(wonDelta)} vs ${CURRENT_YEAR - 1}`,
            positive: wonDelta >= 0,
          }}
          sub={`${formatPct(attainment)} of YTD target`}
        />
        <KpiTile
          label="Pipeline coverage"
          value={formatCoverage(coverage)}
          sub={
            remaining > 0
              ? `${formatUsdCompact(remaining)} quota remaining`
              : 'YTD target achieved'
          }
        />
        <KpiTile
          label="Deal-reg approval"
          value={formatPct(approvalRate(data.registrations))}
          sub={`${funnel.approved + funnel.rejected} decided`}
        />
        <KpiTile
          label="Reg → qualified opp"
          value={formatPct(registrationConversionRate(data.registrations))}
          sub={`${funnel.converted} opps from reg`}
        />
        <KpiTile
          label="Win rate"
          value={formatPct(winRateYtd(opps))}
          sub="of closed YTD"
        />
        <KpiTile
          label="Active partners"
          value={`${activePartnerCount(opps, data.registrations)}`}
          sub={`of ${data.partners.length} enrolled`}
        />
        <KpiTile
          label="Avg open deal"
          value={formatUsdCompact(avgOpenDealSize(opps))}
          sub="per open opportunity"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Deal registration funnel"
          subtitle={
            funnelMeasure === 'value'
              ? 'Partner-estimated value at submission · all time'
              : 'Registration counts · all time'
          }
          action={
            <FilterChips
              options={FUNNEL_MEASURE_OPTIONS}
              value={funnelMeasure}
              onChange={setFunnelMeasure}
              ariaLabel="Funnel measure"
              size="xs"
            />
          }
        >
          <MetricBars rows={funnelRows} />
        </Card>
        <Card
          title="Pipeline by sales stage"
          subtitle="Open opportunities by stage, plus closed outcomes (all time)"
        >
          <MetricBars rows={stageRows} />
        </Card>
      </div>

      <Card title="Revenue vs. target" subtitle="Closed-won by quarter against combined partner targets">
        <RevenueTrend data={quarterly} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Pipeline by opportunity type"
          subtitle="Open pipeline: Sell To / Sell With / Allocate"
        >
          <MetricBars rows={typeRows} />
          {typeFilter === 'all' ? (
            <p className="mt-4 text-xs text-granite">
              Select a type above to filter KPIs, stages, revenue, and the leaderboard.
            </p>
          ) : (
            <p className="mt-4 text-xs text-granite">
              Filter active: {OPP_TYPE_META[typeFilter].label} only. Registrations are untyped and
              stay unfiltered.
            </p>
          )}
        </Card>
        <LightCard
          title="Registrations awaiting review"
          subtitle={`${pending.length} pending · oldest first`}
        >
          <RegistrationsTable
            registrations={pending}
            partners={data.partners}
            variant="queue"
            tone="light"
            limit={7}
          />
        </LightCard>
      </div>

      <Card
        title="Partner leaderboard"
        subtitle={`Top partners by closed-won YTD · ${data.partners.length} enrolled`}
      >
        <Leaderboard rows={leaderboard} limit={10} />
      </Card>
    </div>
  );
}
