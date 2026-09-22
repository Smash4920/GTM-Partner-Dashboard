import { useMemo, useState } from 'react';
import ActivityTracker from '../components/ActivityTracker';
import Card from '../components/Card';
import FilterChips, { type ChipOption } from '../components/FilterChips';
import KpiTile from '../components/KpiTile';
import Leaderboard from '../components/Leaderboard';
import LightCard from '../components/LightCard';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import RegistrationsTable from '../components/RegistrationsTable';
import RevenueTrend from '../components/RevenueTrend';
import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  FISCAL_YEAR,
  LOST_COLOR,
  MEETING_TYPE_META,
  OPP_TYPES,
  OPP_TYPE_META,
  SNAPSHOT_DATE,
  STAGE_META,
  WON_COLOR,
} from '../data/constants';
import type { DashboardData, FiscalPhase, MeetingClassification, OpportunityType } from '../data/types';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import {
  activePartnerCount,
  approvalRate,
  avgOpenDealSize,
  closedWonForPhase,
  closedWonPriorYearForPhase,
  coverageRatio,
  filterByPhase,
  filterByType,
  filterRegistrationsByPhase,
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
  targetsForPhase,
  typeBreakdown,
  weeklyActivity,
  winRateForPhase,
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

const PHASE_OPTIONS: ChipOption<FiscalPhase>[] = FISCAL_PHASES.map((phase) => ({
  id: phase,
  label: FISCAL_PHASE_META[phase].label,
  title: FISCAL_PHASE_META[phase].description,
}));

const FUNNEL_MEASURE_OPTIONS: ChipOption<FunnelMeasure>[] = [
  { id: 'value', label: 'Registered $', title: 'Partner-estimated deal value at submission' },
  { id: 'count', label: 'Count', title: 'Number of registrations' },
];

function targetForPhase(targets: DashboardData['targets'], phase: FiscalPhase): number {
  return targetsForPhase(targets, phase).reduce((sum, target) => sum + target.revenueTarget, 0);
}

/**
 * Home: high-level summary stats for the whole partner ecosystem. This is the
 * aggregate landing view — always "All Partners", with fiscal phase and
 * opportunity-type slicing only. Per-manager and per-partner drill-downs live
 * in Partner Performance.
 */
export default function HomeView({
  data,
  classifications,
}: {
  data: DashboardData;
  classifications: Record<string, MeetingClassification>;
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [funnelMeasure, setFunnelMeasure] = useState<FunnelMeasure>('value');
  const [phase, setPhase] = useState<FiscalPhase>('q3');

  const scopedOpps = useMemo(() => filterByType(data.opportunities, typeFilter), [data.opportunities, typeFilter]);
  const phaseOpps = useMemo(() => filterByPhase(data.opportunities, phase), [data.opportunities, phase]);
  // The phase book for tables/charts: type-filtered and phase-filtered compute
  // differently from the scoped book, matching the old LeadershipView seams.
  const opps = useMemo(() => filterByPhase(scopedOpps, phase), [scopedOpps, phase]);
  const scopedRegistrations = useMemo(
    () => filterRegistrationsByPhase(data.registrations, phase),
    [data.registrations, phase],
  );
  const funnel = useMemo(() => registrationFunnel(scopedRegistrations), [scopedRegistrations]);
  const stages = useMemo(() => stageBreakdown(opps), [opps]);
  const outcomes = useMemo(() => outcomeTotals(opps), [opps]);
  const types = useMemo(() => typeBreakdown(phaseOpps), [phaseOpps]);
  const quarterly = useMemo(
    () => quarterlyClosedWonAndTarget(scopedOpps, data.targets),
    [scopedOpps, data.targets],
  );
  const leaderboard = useMemo(
    () => partnerLeaderboard({ ...data, opportunities: phaseOpps }, typeFilter),
    [data, phaseOpps, typeFilter],
  );
  const pending = useMemo(() => pendingRegistrations(data.registrations), [data.registrations]);
  const activity = useMemo(
    () => weeklyActivity(data.activities, undefined, undefined, classifications),
    [data.activities, classifications],
  );

  const pipeline = openPipeline(opps);
  const won = closedWonForPhase(opps, phase);
  const priorWon = closedWonPriorYearForPhase(scopedOpps, phase);
  const wonDelta = priorWon > 0 ? won / priorWon - 1 : null;
  const target = targetForPhase(data.targets, phase);
  const attainment = target > 0 ? won / target : 0;
  const coverage = coverageRatio(opps, data.targets, phase);
  const remaining = remainingQuota(opps, data.targets, phase);
  const phaseLabel = FISCAL_PHASE_META[phase].label;
  const outcomeScope = phase === 'fy' ? `${FISCAL_YEAR} to date` : `${FISCAL_YEAR} ${phaseLabel}`;
  const phaseDescription = FISCAL_PHASE_META[phase].description;

  const funnelStages = [
    { label: 'Submitted', count: funnel.submitted, amount: funnel.submittedValue, color: '#8a8380' },
    { label: 'Approved', count: funnel.approved, amount: funnel.approvedValue, color: '#b8b3b0' },
    {
      label: 'Converted to opp',
      count: funnel.converted,
      amount: funnel.convertedValue,
      color: '#a0ca92',
    },
    { label: 'Rejected', count: funnel.rejected, amount: funnel.rejectedValue, color: '#4d4947', dimmed: true },
    { label: 'Pending review', count: funnel.pending, amount: funnel.pendingValue, color: '#ee6018' },
  ];

  const funnelRows: MetricBarRow[] = funnelStages.map((stage) => ({
    label: stage.label,
    value: funnelMeasure === 'value' ? stage.amount : stage.count,
    displayValue: funnelMeasure === 'value' ? formatUsdCompact(stage.amount) : `${stage.count}`,
    secondary: funnelMeasure === 'value' ? `${stage.count} regs` : formatUsdCompact(stage.amount),
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
      label: `Won (${outcomeScope})`,
      value: outcomes.wonValue,
      displayValue: formatUsdCompact(outcomes.wonValue),
      secondary: `${outcomes.wonCount} won`,
      color: WON_COLOR,
    },
    {
      label: `Lost (${outcomeScope})`,
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
            All Partners
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">
            Partner Performance Overview
          </h1>
          <p className="mt-1 text-sm text-granite">
            {phaseDescription} · snapshot {formatDate(SNAPSHOT_DATE.toISOString())}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-granite">
              Time phase
            </span>
            <FilterChips
              options={PHASE_OPTIONS}
              value={phase}
              onChange={setPhase}
              ariaLabel="Select fiscal time phase"
              size="xs"
            />
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <FilterChips
            options={TYPE_OPTIONS}
            value={typeFilter}
            onChange={setTypeFilter}
            ariaLabel="Filter by opportunity type"
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            Whole ecosystem · {data.partners.length} aligned partners
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Partner sourced pipeline"
          value={formatUsdCompact(pipeline.value)}
          sub={`${pipeline.count} open ${phaseLabel} opps`}
        />
        <KpiTile
          label={`Closed-won ${phaseLabel}`}
          value={formatUsdCompact(won)}
          delta={
            wonDelta === null
              ? undefined
              : {
                  text: `${wonDelta >= 0 ? '+' : ''}${formatPct(wonDelta)} vs prior period`,
                  positive: wonDelta >= 0,
                }
          }
          sub={`${formatPct(attainment)} of ${phase === 'fy' ? FISCAL_YEAR : phaseLabel} target`}
        />
        <KpiTile
          label="Partner sourced pipeline coverage"
          value={formatCoverage(coverage)}
          sub={
            remaining > 0
              ? `${formatUsdCompact(remaining)} sourced target remaining`
              : 'Sourced target achieved'
          }
        />
        <KpiTile
          label="Deal-reg approval"
          value={formatPct(approvalRate(scopedRegistrations))}
          sub={`${funnel.approved + funnel.rejected} decided`}
        />
        <KpiTile
          label="Reg → qualified opp"
          value={formatPct(registrationConversionRate(scopedRegistrations))}
          sub={`${funnel.converted} opps from reg`}
        />
        <KpiTile
          label={`Win rate ${phaseLabel}`}
          value={formatPct(winRateForPhase(opps, phase))}
          sub="of closed sourced revenue"
        />
        <KpiTile
          label="Active partners"
          value={`${activePartnerCount(data.opportunities, data.registrations)}`}
          sub={`with FY activity · of ${data.partners.length} aligned`}
        />
        <KpiTile
          label="Avg open deal"
          value={formatUsdCompact(avgOpenDealSize(opps))}
          sub="per open sourced opportunity"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Deal registration funnel"
          subtitle={
            funnelMeasure === 'value'
              ? `Partner-estimated value at submission · ${phaseLabel}`
              : `Registration counts · ${phaseLabel}`
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
          subtitle={`Open ${phaseLabel} opportunities by stage, plus closed ${outcomeScope} outcomes`}
        >
          <MetricBars rows={stageRows} />
        </Card>
      </div>

      <Card
        title="Revenue vs. partner sourced target"
        subtitle="Closed-won by fiscal quarter against combined partner-sourced targets · all FY27 quarters"
      >
        <RevenueTrend data={quarterly} />
      </Card>

      <Card
        title="Weekly partner activity"
        subtitle="Google Calendar meeting mock · current and previous seven weeks"
        action={
          <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            {activity.reduce((sum, row) => sum + row.total, 0)} meetings tracked
          </span>
        }
      >
        <ActivityTracker rows={activity} />
        <p className="mt-4 text-xs text-granite">
          Meeting types include {MEETING_TYPE_META.discovery.fullLabel},{' '}
          {MEETING_TYPE_META['pio-interlock'].fullLabel},{' '}
          {MEETING_TYPE_META['pao-interlock'].fullLabel}, Interlock Cadence, Deal Support,
          Technical Enablement, GTM Enablement, and Partner Cadence. Classifications from
          Activity Tracking roll up here.
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Pipeline by opportunity type"
          subtitle={`Open ${phaseLabel} pipeline: Sell To / Sell With / Allocate`}
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
          subtitle={`${pending.length} pending · oldest first · colored against the 5-business-day SLA`}
        >
          <RegistrationsTable
            registrations={pending}
            partners={data.partners}
            variant="queue"
            tone="light"
            limit={7}
          />
          <p className="mt-3 text-xs text-granite">
            Day counters are green inside the 5-business-day response SLA and red once past it.
          </p>
        </LightCard>
      </div>

      <Card
        title="Partner leaderboard"
        subtitle={`Top partners by closed-won ${phaseLabel} · ${data.partners.length} aligned`}
      >
        <Leaderboard rows={leaderboard} limit={10} closedWonLabel={`Closed-won ${phaseLabel}`} />
      </Card>
    </div>
  );
}
