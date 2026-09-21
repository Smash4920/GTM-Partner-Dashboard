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
import type { DashboardData, FiscalPhase, OpportunityType } from '../data/types';
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
type LeadershipScope = 'all' | 'manager';

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

const SCOPE_OPTIONS: ChipOption<LeadershipScope>[] = [
  { id: 'all', label: 'All partners', title: 'Aggregate performance across the partner org' },
  { id: 'manager', label: 'Partner Manager View', title: 'Performance for an assigned partner manager' },
];

const FUNNEL_MEASURE_OPTIONS: ChipOption<FunnelMeasure>[] = [
  { id: 'value', label: 'Registered $', title: 'Partner-estimated deal value at submission' },
  { id: 'count', label: 'Count', title: 'Number of registrations' },
];

function targetForPhase(
  targets: DashboardData['targets'],
  phase: FiscalPhase,
): number {
  return targetsForPhase(targets, phase).reduce((sum, target) => sum + target.revenueTarget, 0);
}

/** Internal GTM leadership view: every partner or one manager's assigned book. */
export default function LeadershipView({ data }: { data: DashboardData }) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [funnelMeasure, setFunnelMeasure] = useState<FunnelMeasure>('value');
  const [phase, setPhase] = useState<FiscalPhase>('q3');
  const [scope, setScope] = useState<LeadershipScope>('all');
  const [partnerManagerId, setPartnerManagerId] = useState(
    () => data.partnerManagers[0]?.id ?? '',
  );
  const [partnerId, setPartnerId] = useState('all');

  const selectedManager = data.partnerManagers.find(
    (manager) => manager.id === partnerManagerId,
  );
  const managerPartners = useMemo(
    () =>
      data.partners.filter((partner) =>
        scope === 'manager' ? partner.partnerManagerId === partnerManagerId : true,
      ),
    [data.partners, partnerManagerId, scope],
  );
  const selectedPartnerIds = useMemo(() => {
    if (scope !== 'manager') return undefined;
    if (partnerId === 'all') return new Set(managerPartners.map((partner) => partner.id));
    return new Set([partnerId]);
  }, [managerPartners, partnerId, scope]);
  const scopedPartners = useMemo(
    () =>
      data.partners.filter(
        (partner) => !selectedPartnerIds || selectedPartnerIds.has(partner.id),
      ),
    [data.partners, selectedPartnerIds],
  );
  const phaseOpps = useMemo(
    () =>
      filterByPhase(data.opportunities, phase).filter(
        (opportunity) => !selectedPartnerIds || selectedPartnerIds.has(opportunity.partnerId),
      ),
    [data.opportunities, phase, selectedPartnerIds],
  );
  const opps = useMemo(
    () => filterByType(phaseOpps, typeFilter),
    [phaseOpps, typeFilter],
  );
  const scopedRegistrations = useMemo(
    () =>
      filterRegistrationsByPhase(data.registrations, phase).filter(
        (registration) => !selectedPartnerIds || selectedPartnerIds.has(registration.partnerId),
      ),
    [data.registrations, phase, selectedPartnerIds],
  );
  const scopedTargets = useMemo(
    () =>
      data.targets.filter(
        (target) => !selectedPartnerIds || selectedPartnerIds.has(target.partnerId),
      ),
    [data.targets, selectedPartnerIds],
  );
  const funnel = useMemo(
    () => registrationFunnel(scopedRegistrations),
    [scopedRegistrations],
  );
  const stages = useMemo(() => stageBreakdown(opps), [opps]);
  const outcomes = useMemo(() => outcomeTotals(opps), [opps]);
  const types = useMemo(() => typeBreakdown(phaseOpps), [phaseOpps]);
  const quarterly = useMemo(
    () => quarterlyClosedWonAndTarget(phaseOpps, scopedTargets),
    [phaseOpps, scopedTargets],
  );
  const leaderboard = useMemo(
    () =>
      partnerLeaderboard(
        { ...data, opportunities: phaseOpps },
        typeFilter,
        selectedPartnerIds,
        phase,
      ),
    [data, phase, phaseOpps, selectedPartnerIds, typeFilter],
  );
  const pending = useMemo(
    () => pendingRegistrations(scopedRegistrations),
    [scopedRegistrations],
  );
  const activity = useMemo(
    () =>
      weeklyActivity(
        data.activities,
        scope === 'manager' ? partnerManagerId : undefined,
        selectedPartnerIds,
      ),
    [data.activities, partnerManagerId, scope, selectedPartnerIds],
  );

  const pipeline = openPipeline(opps);
  const won = closedWonForPhase(opps, phase);
  const priorWon = closedWonPriorYearForPhase(opps, phase);
  const wonDelta = priorWon > 0 ? won / priorWon - 1 : 0;
  const target = targetForPhase(scopedTargets, phase);
  const attainment = target > 0 ? won / target : 0;
  const coverage = coverageRatio(opps, scopedTargets, phase);
  const remaining = remainingQuota(opps, scopedTargets, phase);
  const phaseLabel = FISCAL_PHASE_META[phase].label;
  const phaseDescription = FISCAL_PHASE_META[phase].description;
  const selectedLabel =
    scope === 'all'
      ? 'All partners'
      : partnerId === 'all'
        ? selectedManager?.name ?? 'Partner manager'
        : scopedPartners.find((partner) => partner.id === partnerId)?.name ?? 'Partner';

  // One measure drives both the bar length and the printed number, so the
  // panel never mixes registration counts with registered dollars.
  const funnelStages: {
    label: string;
    count: number;
    amount: number;
    color: string;
    dimmed?: boolean;
  }[] = [
    { label: 'Submitted', count: funnel.submitted, amount: funnel.submittedValue, color: '#8a8380' },
    { label: 'Approved', count: funnel.approved, amount: funnel.approvedValue, color: '#b8b3b0' },
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
      funnelMeasure === 'value' ? `${stage.count} regs` : formatUsdCompact(stage.amount),
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
            {selectedLabel}
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Partner revenue pipeline</h1>
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
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={(nextScope) => {
              setScope(nextScope);
              setPartnerId('all');
            }}
            ariaLabel="Select leadership scope"
          />
          {scope === 'manager' && (
            <div className="flex flex-wrap justify-end gap-2">
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                  Partner manager
                </span>
                <select
                  value={partnerManagerId}
                  onChange={(event) => {
                    setPartnerManagerId(event.target.value);
                    setPartnerId('all');
                  }}
                  className="rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none"
                >
                  {data.partnerManagers.map((manager) => (
                    <option key={manager.id} value={manager.id}>
                      {manager.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                  Partner
                </span>
                <select
                  value={partnerId}
                  onChange={(event) => setPartnerId(event.target.value)}
                  className="max-w-[220px] rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none"
                >
                  <option value="all">All assigned partners ({managerPartners.length})</option>
                  {managerPartners
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
          <FilterChips
            options={TYPE_OPTIONS}
            value={typeFilter}
            onChange={setTypeFilter}
            ariaLabel="Filter by opportunity type"
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            Salesforce Account.Partner_Manager__c · {scopedPartners.length} partner
            {scopedPartners.length === 1 ? '' : 's'}
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
          delta={{
            text: `${wonDelta >= 0 ? '+' : ''}${formatPct(wonDelta)} vs prior period`,
            positive: wonDelta >= 0,
          }}
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
          value={`${activePartnerCount(opps, scopedRegistrations)}`}
          sub={`of ${scopedPartners.length} aligned`}
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
          subtitle={`Open ${phaseLabel} opportunities by stage, plus closed outcomes`}
        >
          <MetricBars rows={stageRows} />
        </Card>
      </div>

      <Card
        title="Revenue vs. partner sourced target"
        subtitle="Closed-won by fiscal quarter against combined partner-sourced targets"
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
          {MEETING_TYPE_META['pao-interlock'].fullLabel}, Interlock Cadence, Technical Enablement,
          GTM Enablement, and Partner Cadence. The mock resets on the weekly boundary; a future
          Google Calendar connector can replace it.
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
        subtitle={`Top partners by closed-won ${phaseLabel} · ${scopedPartners.length} aligned`}
      >
        <Leaderboard rows={leaderboard} limit={10} />
      </Card>

    </div>
  );
}
