import { useMemo, useState } from 'react';
import ActivityTracker from '../components/ActivityTracker';
import Card from '../components/Card';
import DuplicateRegistrationsTable from '../components/DuplicateRegistrationsTable';
import ExclusivityTable from '../components/ExclusivityTable';
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
  REGISTRATION_EXCLUSIVITY_DAYS,
  REGISTRATION_SLA_BUSINESS_DAYS,
  SNAPSHOT_DATE,
  STAGE_META,
  WON_COLOR,
} from '../data/constants';
import type { DashboardData, FiscalPhase, MeetingClassification, Partner } from '../data/types';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import {
  activePartnerCount,
  approvedNotConverted,
  approvalRate,
  avgOpenDealSize,
  closedWonForPhase,
  closedWonPriorYearForPhase,
  coverageState,
  duplicateRegistrationGroups,
  exclusivityLapsed,
  filterByPhase,
  filterRegistrationsByPhase,
  formatCoverage,
  openPipeline,
  outcomeTotals,
  partnerLeaderboard,
  pendingRegistrations,
  quarterlyClosedWonAndTarget,
  registrationConversionRate,
  registrationsPastSla,
  registrationConversionTimes,
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

function managerScope(managerId: string): string | undefined {
  return managerId === 'all' ? undefined : managerId;
}

function selectedScopeLabel(
  partnerId: string,
  managerId: string,
  managerName: string | undefined,
  partners: Partner[],
): string {
  if (partnerId !== 'all') {
    return partners.find((partner) => partner.id === partnerId)?.name ?? 'Partner';
  }
  if (managerId === 'all') return 'All Partners';
  return `${managerName ?? 'Partner manager'} · All Partners`;
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
  const scopedManagerId = managerScope(managerId);
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
    () => data.opportunities.filter((opportunity) => selectedPartnerIds.has(opportunity.partnerId)),
    [data.opportunities, selectedPartnerIds],
  );
  const phaseOpps = useMemo(
    () => filterByPhase(partnerScopeOpps, phase),
    [partnerScopeOpps, phase],
  );
  const scopedRegistrations = useMemo(
    () =>
      filterRegistrationsByPhase(data.registrations, phase).filter((registration) =>
        selectedPartnerIds.has(registration.partnerId),
      ),
    [data.registrations, phase, selectedPartnerIds],
  );
  const partnerScopeRegistrations = useMemo(
    () =>
      data.registrations.filter((registration) => selectedPartnerIds.has(registration.partnerId)),
    [data.registrations, selectedPartnerIds],
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
    () =>
      partnerLeaderboard({ ...data, opportunities: phaseOpps }, 'all', selectedPartnerIds, phase),
    [data, phase, phaseOpps, selectedPartnerIds],
  );
  const pending = useMemo(() => pendingRegistrations(scopedRegistrations), [scopedRegistrations]);
  // Deal-registration ops, scoped to the selection but NOT phase-filtered:
  // exclusivity lapsing and conversion times span quarters, so a Q3 scope
  // must still see the older registrations that are leaking.
  const scopedLeaking = useMemo(
    () => approvedNotConverted(partnerScopeRegistrations),
    [partnerScopeRegistrations],
  );
  const scopedLapsed = useMemo(() => scopedLeaking.filter(exclusivityLapsed), [scopedLeaking]);
  const scopedPastSla = useMemo(
    () => registrationsPastSla(partnerScopeRegistrations),
    [partnerScopeRegistrations],
  );
  const scopedDuplicates = useMemo(
    () => duplicateRegistrationGroups(partnerScopeRegistrations, data.partners),
    [partnerScopeRegistrations, data.partners],
  );
  const scopedTimes = useMemo(
    () => registrationConversionTimes(partnerScopeRegistrations, partnerScopeOpps),
    [partnerScopeRegistrations, partnerScopeOpps],
  );
  const activity = useMemo(
    () => weeklyActivity(data.activities, scopedManagerId, selectedPartnerIds, classifications),
    [data.activities, scopedManagerId, selectedPartnerIds, classifications],
  );
  const goal = useMemo(
    () => weeklyGoalProgress(data.activities, classifications, scopedManagerId, selectedPartnerIds),
    [data.activities, classifications, scopedManagerId, selectedPartnerIds],
  );

  const pipeline = openPipeline(phaseOpps);
  const won = closedWonForPhase(phaseOpps, phase);
  const priorWon = closedWonPriorYearForPhase(partnerScopeOpps, phase);
  const wonDelta = priorWon > 0 ? won / priorWon - 1 : null;
  const target = targetForPhase(scopedTargets, phase);
  const attainment = target > 0 ? won / target : 0;
  const coverage = coverageState(phaseOpps, scopedTargets, phase);
  const remaining = remainingQuota(phaseOpps, scopedTargets, phase);
  const phaseLabel = FISCAL_PHASE_META[phase].label;
  const outcomeScope = phase === 'fy' ? `${FISCAL_YEAR} to date` : `${FISCAL_YEAR} ${phaseLabel}`;

  const selectedLabel = selectedScopeLabel(
    partnerId,
    managerId,
    selectedManager?.name,
    data.partners,
  );

  const selectedPartner = data.partners.find((partner) => partner.id === partnerId);
  const uniquePartners = new Set(
    data.partners.filter((p) => selectedPartnerIds.has(p.id)).map((p) => p.id),
  ).size;

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
    {
      label: 'Submitted',
      value: funnel.submitted,
      displayValue: `${funnel.submitted}`,
      secondary: formatUsdCompact(funnel.submittedValue),
      color: '#8a8380',
    },
    {
      label: 'Approved',
      value: funnel.approved,
      displayValue: `${funnel.approved}`,
      secondary: formatUsdCompact(funnel.approvedValue),
      color: '#b8b3b0',
    },
    {
      label: 'Converted to opp',
      value: funnel.converted,
      displayValue: `${funnel.converted}`,
      secondary: formatUsdCompact(funnel.convertedValue),
      color: '#a0ca92',
    },
    {
      label: 'Rejected',
      value: funnel.rejected,
      displayValue: `${funnel.rejected}`,
      secondary: formatUsdCompact(funnel.rejectedValue),
      color: '#4d4947',
      dimmed: true,
    },
    {
      label: 'Pending review',
      value: funnel.pending,
      displayValue: `${funnel.pending}`,
      secondary: formatUsdCompact(funnel.pendingValue),
      color: '#ee6018',
    },
  ];

  const fmtDays = (days: number | null) => (days === null ? '—' : `${days.toFixed(1)}d`);

  const conversionRows: MetricBarRow[] = [
    {
      label: 'Submitted → Approved',
      value: scopedTimes.submittedToApprovedBusinessDays ?? 0,
      displayValue: fmtDays(scopedTimes.submittedToApprovedBusinessDays),
      // The approval hop is measured in the SLA's own unit, so the bar reads
      // directly against the response SLA.
      secondary: `avg business days · ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`,
      color: '#7e7b78',
    },
    {
      label: 'Approved → Opportunity',
      value: scopedTimes.approvedToOpportunityCalendarDays ?? 0,
      displayValue: fmtDays(scopedTimes.approvedToOpportunityCalendarDays),
      secondary: 'avg elapsed calendar days · converted registrations',
      color: '#9a9693',
    },
    {
      label: 'Opportunity → Win',
      value: scopedTimes.opportunityToWinCalendarDays ?? 0,
      displayValue: fmtDays(scopedTimes.opportunityToWinCalendarDays),
      secondary: 'avg elapsed calendar days · converted & won',
      color: '#a0ca92',
    },
    {
      label: 'Submitted → Win',
      value: scopedTimes.submittedToWinCalendarDays ?? 0,
      displayValue: fmtDays(scopedTimes.submittedToWinCalendarDays),
      secondary: 'avg elapsed calendar days · converted & won',
      color: '#b8b3b0',
    },
  ];

  const leakageRows: MetricBarRow[] = [
    {
      label: 'Approved, no opp',
      value: scopedLeaking.length,
      displayValue: `${scopedLeaking.length}`,
      secondary: 'approved registrations',
      color: '#8a8380',
    },
    {
      label: 'Exclusivity lapsed',
      value: scopedLapsed.length,
      displayValue: `${scopedLapsed.length}`,
      secondary: `> ${REGISTRATION_EXCLUSIVITY_DAYS} days since approval`,
      color: '#ee6018',
    },
    {
      label: 'Pending past SLA',
      value: scopedPastSla.length,
      displayValue: `${scopedPastSla.length}`,
      secondary: `${REGISTRATION_SLA_BUSINESS_DAYS}+ business days awaiting review`,
      color: '#ee6018',
    },
    {
      label: 'Duplicate clients',
      value: scopedDuplicates.length,
      displayValue: `${scopedDuplicates.length}`,
      secondary: 'same client, multiple partners',
      color: '#4d4947',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            {selectedLabel}
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Partner Performance</h1>
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
            Scope · {managerId === 'all' ? 'whole org' : selectedManager?.name} · {uniquePartners}{' '}
            partner{uniquePartners === 1 ? '' : 's'}
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
            coverage.kind === 'coverage'
              ? `${formatUsdCompact(remaining)} sourced target remaining`
              : coverage.kind === 'target-met'
                ? 'Sourced target achieved'
                : 'No sourced target set'
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
          value={`${activePartnerCount(partnerScopeOpps, partnerScopeRegistrations)}`}
          sub={`with FY activity · of ${uniquePartners} aligned`}
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
              {MEETING_TYPE_META['pio-interlock'].fullLabel}. Classify calls in Activity Tracking to
              update these bars.
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
          subtitle={`${pending.length} pending in scope · oldest first · colored against the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`}
        >
          <RegistrationsTable
            registrations={pending}
            partners={data.partners}
            variant="queue"
            tone="light"
            limit={7}
          />
          <p className="mt-3 text-xs text-granite">
            Day counters are green inside the {REGISTRATION_SLA_BUSINESS_DAYS}-business-day response
            SLA and red once past it.
          </p>
        </LightCard>
        <Card
          title="Partner leaderboard & enablement"
          subtitle={`${uniquePartners} partner${uniquePartners === 1 ? '' : 's'} in this scope · certification counts show attainment below`}
        >
          <Leaderboard
            rows={leaderboard}
            limit={uniquePartners}
            closedWonLabel={`Closed-won ${phaseLabel}`}
            certifications={data.certifications}
          />
        </Card>
      </div>

      <Card
        title="Exclusivity lapsed · approved, not converted"
        subtitle={`${scopedLeaking.length} approved registrations without an opportunity · ${scopedLapsed.length} past the ${REGISTRATION_EXCLUSIVITY_DAYS}-day exclusivity window`}
      >
        <ExclusivityTable registrations={scopedLeaking} partners={data.partners} limit={8} />
        <p className="mt-4 text-xs text-granite">
          An approved lead keeps exclusivity for {REGISTRATION_EXCLUSIVITY_DAYS} calendar days — the
          partner must introduce the lead within it. Rows past the window are flagged "Exclusivity
          lapsed".
        </p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Registration conversion time"
          subtitle="Average days between each step for this scope · submitted → approved → opportunity → win"
        >
          <MetricBars rows={conversionRows} />
        </Card>
        <Card
          title="Registration leakage"
          subtitle={`What the funnel loses · counts in this scope`}
        >
          <MetricBars rows={leakageRows} />
          <p className="mt-4 text-xs text-granite">
            Leakage is approved registrations that never became opportunities, registrations outside
            their service levels, and clients registered by more than one partner.
          </p>
        </Card>
      </div>

      <Card
        title="Duplicate & conflicting registrations"
        subtitle={`${scopedDuplicates.length} clients registered by more than one partner · submission dates show who registered first · internal only`}
      >
        <DuplicateRegistrationsTable groups={scopedDuplicates} partners={data.partners} limit={6} />
        <p className="mt-4 text-xs text-granite">
          Multiple partners registering the same client need to be tracked and qualified closely;
          the earliest submission holds exclusivity. This view never appears in the partner portal.
        </p>
      </Card>

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
