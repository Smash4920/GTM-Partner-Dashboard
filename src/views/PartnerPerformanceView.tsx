import { useMemo, useState } from 'react';
import ActivityTracker from '../components/ActivityTracker';
import Card from '../components/Card';
import FilterChips, { type ChipOption } from '../components/FilterChips';
import KpiTile from '../components/KpiTile';
import Leaderboard from '../components/Leaderboard';
import LightCard from '../components/LightCard';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import OpportunityTable from '../components/OpportunityTable';
import ProgressBar from '../components/ProgressBar';
import RegistrationsTable from '../components/RegistrationsTable';
import RevenueTrend from '../components/RevenueTrend';
import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  FISCAL_YEAR,
  LOST_COLOR,
  MEETING_TYPE_META,
  SNAPSHOT_DATE,
  STAGE_META,
  WON_COLOR,
} from '../data/constants';
import type {
  DashboardData,
  FiscalPhase,
  MeetingClassification,
  Partner,
} from '../data/types';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import {
  activePartnerCount,
  approvalRate,
  avgOpenDealSize,
  closedWonForPhase,
  closedWonPriorYearForPhase,
  coverageRatio,
  filterByPhase,
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
  weeklyActivity,
  weeklyGoalProgress,
  winRateForPhase,
} from '../lib/metrics';

const PHASE_OPTIONS: ChipOption<FiscalPhase>[] = FISCAL_PHASES.map((phase) => ({
  id: phase,
  label: FISCAL_PHASE_META[phase].label,
  title: FISCAL_PHASE_META[phase].description,
}));

function targetForPhase(targets: DashboardData['targets'], phase: FiscalPhase): number {
  return targetsForPhase(targets, phase).reduce((sum, target) => sum + target.revenueTarget, 0);
}

/**
 * Partner Performance: drill down into one partner manager's book or a single
 * partner. Dropdowns on the right pick the manager and partner; a meeting
 * tracker per table (and weekly-goal progress) sit alongside the pipeline.
 */
export default function PartnerPerformanceView({
  data,
  classifications,
}: {
  data: DashboardData;
  classifications: Record<string, MeetingClassification>;
}) {
  const [phase, setPhase] = useState<FiscalPhase>('q3');
  const [managerId, setManagerId] = useState('all');
  const [partnerId, setPartnerId] = useState('all');

  const selectedManager = data.partnerManagers.find((manager) => manager.id === managerId);
  const managerPartners = useMemo(
    () =>
      data.partners.filter(
        (partner) => managerId === 'all' || partner.partnerManagerId === managerId,
      ),
    [data.partners, managerId],
  );
  const selectedPartnerIds = useMemo(() => {
    if (partnerId === 'all') return new Set(managerPartners.map((partner) => partner.id));
    return new Set([partnerId]);
  }, [managerPartners, partnerId]);

  const partnerScopeOpps = useMemo(
    () =>
      data.opportunities.filter(
        (opportunity) => selectedPartnerIds.has(opportunity.partnerId),
      ),
    [data.opportunities, selectedPartnerIds],
  );
  const phaseOpps = useMemo(
    () => filterByPhase(partnerScopeOpps, phase),
    [partnerScopeOpps, phase],
  );
  const scopedRegistrations = useMemo(
    () =>
      filterRegistrationsByPhase(data.registrations, phase).filter(
        (registration) => selectedPartnerIds.has(registration.partnerId),
      ),
    [data.registrations, phase, selectedPartnerIds],
  );
  const scopedTargets = useMemo(
    () => data.targets.filter((target) => selectedPartnerIds.has(target.partnerId)),
    [data.targets, selectedPartnerIds],
  );
  const funnel = useMemo(() => registrationFunnel(scopedRegistrations), [scopedRegistrations]);
  const stages = useMemo(() => stageBreakdown(phaseOpps), [phaseOpps]);
  const outcomes = useMemo(() => outcomeTotals(phaseOpps), [phaseOpps]);
  const quarterly = useMemo(
    () => quarterlyClosedWonAndTarget(partnerScopeOpps, scopedTargets),
    [partnerScopeOpps, scopedTargets],
  );
  const leaderboard = useMemo(
    () => partnerLeaderboard({ ...data, opportunities: phaseOpps }, 'all', selectedPartnerIds, phase),
    [data, phase, phaseOpps, selectedPartnerIds],
  );
  const pending = useMemo(
    () => pendingRegistrations(scopedRegistrations),
    [scopedRegistrations],
  );
  const activity = useMemo(
    () => weeklyActivity(data.activities, managerId === 'all' ? undefined : managerId, selectedPartnerIds, classifications),
    [data.activities, managerId, selectedPartnerIds, classifications],
  );
  const goal = useMemo(
    () =>
      weeklyGoalProgress(
        data.activities,
        classifications,
        managerId === 'all' ? undefined : managerId,
        selectedPartnerIds,
      ),
    [data.activities, classifications, managerId, selectedPartnerIds],
  );

  const pipeline = openPipeline(phaseOpps);
  const won = closedWonForPhase(phaseOpps, phase);
  const priorWon = closedWonPriorYearForPhase(partnerScopeOpps, phase);
  const wonDelta = priorWon > 0 ? won / priorWon - 1 : null;
  const target = targetForPhase(scopedTargets, phase);
  const attainment = target > 0 ? won / target : 0;
  const coverage = coverageRatio(phaseOpps, scopedTargets, phase);
  const remaining = remainingQuota(phaseOpps, scopedTargets, phase);
  const phaseLabel = FISCAL_PHASE_META[phase].label;
  const outcomeScope = phase === 'fy' ? `${FISCAL_YEAR} to date` : `${FISCAL_YEAR} ${phaseLabel}`;

  const selectedLabel =
    partnerId === 'all'
      ? managerId === 'all'
        ? 'All Partners'
        : `${selectedManager?.name ?? 'Partner manager'} · All Partners`
      : data.partners.find((partner) => partner.id === partnerId)?.name ?? 'Partner';

  const selectedPartner = data.partners.find((partner) => partner.id === partnerId);
  const uniquePartners = new Set(data.partners.filter((p) => selectedPartnerIds.has(p.id)).map((p) => p.id)).size;

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

  const funnelRows: MetricBarRow[] = [
    { label: 'Submitted', value: funnel.submitted, displayValue: `${funnel.submitted}`, secondary: formatUsdCompact(funnel.submittedValue), color: '#8a8380' },
    { label: 'Approved', value: funnel.approved, displayValue: `${funnel.approved}`, secondary: formatUsdCompact(funnel.approvedValue), color: '#b8b3b0' },
    { label: 'Converted to opp', value: funnel.converted, displayValue: `${funnel.converted}`, secondary: formatUsdCompact(funnel.convertedValue), color: '#a0ca92' },
    { label: 'Rejected', value: funnel.rejected, displayValue: `${funnel.rejected}`, secondary: formatUsdCompact(funnel.rejectedValue), color: '#4d4947', dimmed: true },
    { label: 'Pending review', value: funnel.pending, displayValue: `${funnel.pending}`, secondary: formatUsdCompact(funnel.pendingValue), color: '#ee6018' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            {selectedLabel}
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Partner performance</h1>
          <p className="mt-1 text-sm text-granite">
            Drill down into one manager's book or a single partner · snapshot{' '}
            {formatDate(SNAPSHOT_DATE.toISOString())}
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
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              Partner manager
            </span>
            <select
              value={managerId}
              onChange={(event) => {
                setManagerId(event.target.value);
                setPartnerId('all');
              }}
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
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              Partner
            </span>
            <select
              value={partnerId}
              onChange={(event) => setPartnerId(event.target.value)}
              className="max-w-[240px] rounded border border-ash bg-carbon px-3 py-1.5 text-sm text-bone focus:border-signal focus:outline-none"
            >
              <option value="all">
                All Partners ({managerPartners.length}
                {managerId === 'all' ? '' : ' aligned'})
              </option>
              {managerPartners
                .slice()
                .sort((a: Partner, b: Partner) => a.name.localeCompare(b.name))
                .map((partner) => (
                  <option key={partner.id} value={partner.id}>
                    {partner.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            Scope · {managerId === 'all' ? 'whole org' : selectedManager?.name} ·{' '}
            {uniquePartners} partner{uniquePartners === 1 ? '' : 's'}
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
          label="Pipeline coverage"
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
          value={formatPct(winRateForPhase(phaseOpps, phase))}
          sub="of closed sourced revenue"
        />
        <KpiTile
          label="Active partners"
          value={`${activePartnerCount(phaseOpps, scopedRegistrations)}`}
          sub={`of ${uniquePartners} aligned`}
        />
        <KpiTile
          label="Avg open deal"
          value={formatUsdCompact(avgOpenDealSize(phaseOpps))}
          sub="per open sourced opportunity"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Deal registration funnel" subtitle={`Registrations · ${phaseLabel}`}>
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
        subtitle="Closed-won by fiscal quarter against combined targets · all FY27 quarters"
      >
        <RevenueTrend data={quarterly} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Weekly partner activity"
          subtitle="Current and previous seven weeks for this scope"
          action={
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              {activity.reduce((sum, row) => sum + row.total, 0)} meetings
            </span>
          }
        >
          <ActivityTracker rows={activity} />
        </Card>
        <Card
          title="Progress to weekly goal"
          subtitle="10 partner meetings per week · 3 of them PIO interlocks"
          action={
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              This week
            </span>
          }
        >
          <div className="space-y-4">
            <ProgressBar label="Partner meetings" value={goal.meetings} goal={goal.meetingsGoal} />
            <ProgressBar label="PIO interlocks" value={goal.pioMeetings} goal={goal.pioGoal} />
            <p className="text-xs text-granite">
              {MEETING_TYPE_META['pio-interlock'].fullLabel}. Classify calls in Activity Tracking
              to update these bars.
            </p>
          </div>
        </Card>
      </div>

      <Card
        title={`Pipeline opportunities · ${FISCAL_PHASE_META[phase].label}`}
        subtitle={`${phaseOpps.length} Salesforce-shaped opportunities in scope`}
      >
        <OpportunityTable
          opportunities={phaseOpps}
          emptyMessage={`No ${FISCAL_PHASE_META[phase].label} opportunities for this scope.`}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LightCard
          title="Registrations awaiting review"
          subtitle={`${pending.length} pending in scope · oldest first`}
        >
          <RegistrationsTable
            registrations={pending}
            partners={data.partners}
            variant="queue"
            tone="light"
            limit={7}
          />
        </LightCard>
        <Card
          title="Leaderboard"
          subtitle="Top partners in this scope by closed-won"
        >
          <Leaderboard rows={leaderboard} limit={5} closedWonLabel={`Closed-won ${phaseLabel}`} />
        </Card>
      </div>

      {selectedPartner && (
        <Card
          title={`${selectedPartner.name} certifications`}
          subtitle="Partner enablement standing"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ProgressBar
              label="Partner strategists"
              value={previewCert(selectedPartner, data, 'strategists').value}
              goal={previewCert(selectedPartner, data, 'strategists').goal}
              hint={previewCert(selectedPartner, data, 'strategists').hint}
            />
            <ProgressBar
              label="Partner engineers"
              value={previewCert(selectedPartner, data, 'engineers').value}
              goal={previewCert(selectedPartner, data, 'engineers').goal}
              hint={previewCert(selectedPartner, data, 'engineers').hint}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

type CertKind = 'strategists' | 'engineers';

/** Certification counts for a single partner; empty state when unavailable. */
function previewCert(
  partner: Partner,
  data: DashboardData,
  kind: CertKind,
): { value: number; goal: number; hint?: string } {
  const cert = data.certifications.find((item) => item.partnerId === partner.id);
  if (!cert) return { value: 0, goal: 1, hint: 'No certification data' };
  if (kind === 'strategists') {
    return {
      value: cert.partnerStrategistsCertified,
      goal: cert.partnerStrategistsGoal,
      hint: 'certified',
    };
  }
  return {
    value: cert.partnerEngineersCertified,
    goal: cert.partnerEngineersGoal,
    hint: 'certified',
  };
}
