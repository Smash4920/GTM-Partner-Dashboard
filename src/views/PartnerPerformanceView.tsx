import { useState } from 'react';
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
import PageFooter from '../components/PageFooter';
import ProgressBar from '../components/ProgressBar';
import { renderQueryState } from '../components/QueryState';
import RegistrationsTable from '../components/RegistrationsTable';
import RevenueTrend from '../components/RevenueTrend';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  FISCAL_YEAR,
  MEETING_TYPE_META,
  REGISTRATION_EXCLUSIVITY_DAYS,
  REGISTRATION_SLA_BUSINESS_DAYS,
  SNAPSHOT_DATE,
} from '../data/constants';
import type {
  DataProvider,
  PartnerCertificationProfile,
  PartnerLeaderboardEntry,
  RegistrationOpsSummary,
} from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import type { PaginationState } from '../data/paginationState';
import type { QueryState } from '../data/queryState';
import type { SessionEdits } from '../data/sessionEdits';
import type {
  DealRegistration,
  FiscalPhase,
  MeetingClassification,
  Opportunity,
  Partner,
} from '../data/types';
import {
  LEADERBOARD_PAGE_SIZE,
  usePartnerPerformanceQueries,
} from '../data/usePartnerPerformanceQueries';
import { conversionRows, funnelRows, stageRows } from './performanceRows';
import type { DuplicateRegistrationGroup } from '../lib/metrics';
import { formatCoverage } from '../lib/metrics';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';

const PHASE_OPTIONS: ChipOption<FiscalPhase>[] = FISCAL_PHASES.map((phase) => ({
  id: phase,
  label: FISCAL_PHASE_META[phase].label,
  title: FISCAL_PHASE_META[phase].description,
}));

function leakageRows(ops: RegistrationOpsSummary): MetricBarRow[] {
  return [
    {
      label: 'Approved, no opp',
      value: ops.approvedNotConverted,
      displayValue: `${ops.approvedNotConverted}`,
      secondary: 'approved registrations',
      color: '#8a8380',
    },
    {
      label: 'Exclusivity lapsed',
      value: ops.exclusivityLapsed,
      displayValue: `${ops.exclusivityLapsed}`,
      secondary: `> ${REGISTRATION_EXCLUSIVITY_DAYS} days since approval`,
      color: '#ee6018',
    },
    {
      label: 'Pending past SLA',
      value: ops.pastSla,
      displayValue: `${ops.pastSla}`,
      secondary: `${REGISTRATION_SLA_BUSINESS_DAYS}+ business days awaiting review`,
      color: '#ee6018',
    },
    {
      label: 'Duplicate clients',
      value: ops.duplicateGroups,
      displayValue: `${ops.duplicateGroups}`,
      secondary: 'same client, multiple partners',
      color: '#4d4947',
    },
  ];
}

type CertKind = 'strategists' | 'engineers';

/** Certification counts for the drilled-in partner; empty state when unavailable. */
function certProgress(
  profile: PartnerCertificationProfile,
  kind: CertKind,
): { value: number; goal: number; hint?: string } {
  const cert = profile.certification;
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

/** The heading label for the current drill-down. */
function selectedScopeLabel(
  partnerId: string,
  managerId: string,
  roster: Partner[],
  managerName: string | undefined,
): string {
  if (partnerId !== 'all') {
    return roster.find((partner) => partner.id === partnerId)?.name ?? 'Partner';
  }
  if (managerId === 'all') return 'All Partners';
  return `${managerName ?? 'Partner manager'} · All Partners`;
}

/** Partners inside the current drill-down — the manager's roster, or one. */
function partnerCount(partnerId: string, managerPartners: Partner[], roster: Partner[]): number {
  if (partnerId !== 'all') {
    return roster.filter((partner) => partner.id === partnerId).length;
  }
  return managerPartners.length;
}

/** The paginated pipeline table: one window of scoped opportunities at a time. */
function PipelineOpportunitiesCard({
  phase,
  opportunities,
}: {
  phase: FiscalPhase;
  opportunities: PaginationState<Opportunity>;
}) {
  return (
    <Card
      title={`Pipeline opportunities · ${FISCAL_PHASE_META[phase].label}`}
      subtitle={
        opportunities.meta === null
          ? 'Salesforce-shaped opportunities in scope'
          : `${opportunities.totalCount} Salesforce-shaped opportunities in scope`
      }
    >
      {renderQueryState(
        'pipeline opportunities',
        pageWindowAsQuery(opportunities, true),
        (rows) => (
          <>
            <OpportunityTable
              opportunities={rows}
              emptyMessage={`No ${FISCAL_PHASE_META[phase].label} opportunities for this scope.`}
            />
            <PageFooter
              state={opportunities}
              noun="opportunities"
              pageSize={25}
              countNoun={false}
            />
          </>
        ),
      )}
    </Card>
  );
}

/** The review queue card: the first page of pending registrations, oldest first. */
function ReviewQueueCard({
  pending,
  roster,
}: {
  pending: PaginationState<DealRegistration>;
  roster: Partner[];
}) {
  return (
    <LightCard
      title="Registrations awaiting review"
      subtitle={
        pending.meta === null
          ? `Oldest first · colored against the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`
          : `${pending.totalCount} pending in scope · oldest first · colored against the ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`
      }
    >
      {renderQueryState('review queue', pageWindowAsQuery(pending), (rows) => (
        <RegistrationsTable
          registrations={rows}
          partners={roster}
          variant="queue"
          tone="light"
          limit={7}
        />
      ))}
      <p className="mt-3 text-xs text-granite">
        Day counters are green inside the {REGISTRATION_SLA_BUSINESS_DAYS}-business-day response SLA
        and red once past it.
      </p>
    </LightCard>
  );
}

/** The leaderboard card: the scoped ranking a page at a time, plus certification attainment. */
function LeaderboardCard({
  leaderboard,
  phaseLabel,
}: {
  leaderboard: PaginationState<PartnerLeaderboardEntry>;
  phaseLabel: string;
}) {
  return (
    <Card
      title="Partner leaderboard & enablement"
      subtitle={
        leaderboard.meta === null
          ? 'Certification counts show attainment below'
          : `${leaderboard.totalCount} partner${leaderboard.totalCount === 1 ? '' : 's'} in this scope · certification counts show attainment below`
      }
    >
      {renderQueryState('partner leaderboard', pageWindowAsQuery(leaderboard, true), (rows) => (
        <>
          <Leaderboard
            rows={rows}
            limit={rows.length}
            closedWonLabel={`Closed-won ${phaseLabel}`}
            certifications={rows.flatMap((row) =>
              row.certification === undefined ? [] : [row.certification],
            )}
          />
          <PageFooter state={leaderboard} noun="partners" pageSize={LEADERBOARD_PAGE_SIZE} />
        </>
      ))}
    </Card>
  );
}

/** The exclusivity watch: approved registrations that never became opportunities. */
function ExclusivityCard({
  ops,
  unconverted,
  roster,
}: {
  ops: QueryState<RegistrationOpsSummary>;
  unconverted: PaginationState<DealRegistration>;
  roster: Partner[];
}) {
  return (
    <Card
      title="Exclusivity lapsed · approved, not converted"
      subtitle={
        ops.data === null
          ? 'Approved registrations without an opportunity · the exclusivity watch'
          : `${ops.data.approvedNotConverted} approved registrations without an opportunity · ${ops.data.exclusivityLapsed} past the ${REGISTRATION_EXCLUSIVITY_DAYS}-day exclusivity window`
      }
    >
      {renderQueryState('unconverted registrations', pageWindowAsQuery(unconverted), (rows) => (
        <ExclusivityTable registrations={rows} partners={roster} limit={8} />
      ))}
      <p className="mt-4 text-xs text-granite">
        An approved lead keeps exclusivity for {REGISTRATION_EXCLUSIVITY_DAYS} calendar days — the
        partner must introduce the lead within it. Rows past the window are flagged "Exclusivity
        lapsed".
      </p>
    </Card>
  );
}

/** The duplicate-registration card: clients registered by more than one partner. */
function DuplicatesCard({
  duplicates,
  roster,
}: {
  duplicates: PaginationState<DuplicateRegistrationGroup>;
  roster: Partner[];
}) {
  return (
    <Card
      title="Duplicate & conflicting registrations"
      subtitle={
        duplicates.meta === null
          ? 'Clients registered by more than one partner · submission dates show who registered first · internal only'
          : `${duplicates.totalCount} clients registered by more than one partner · submission dates show who registered first · internal only`
      }
    >
      {renderQueryState('duplicate registrations', pageWindowAsQuery(duplicates), (groups) => (
        <DuplicateRegistrationsTable groups={groups} partners={roster} limit={6} />
      ))}
      <p className="mt-4 text-xs text-granite">
        Multiple partners registering the same client need to be tracked and qualified closely; the
        earliest submission holds exclusivity. This view never appears in the partner portal.
      </p>
    </Card>
  );
}

/** The drilled-in partner's certification standing; hidden when no partner is picked. */
function CertificationCard({
  certification,
}: {
  certification: QueryState<PartnerCertificationProfile | null>;
}) {
  return renderQueryState('certification profile', certification, (profile) =>
    profile === null ? null : (
      <Card title={`${profile.partner.name} certifications`} subtitle="Partner enablement standing">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ProgressBar
            label="Partner strategists"
            value={certProgress(profile, 'strategists').value}
            goal={certProgress(profile, 'strategists').goal}
            hint={certProgress(profile, 'strategists').hint}
          />
          <ProgressBar
            label="Partner engineers"
            value={certProgress(profile, 'engineers').value}
            goal={certProgress(profile, 'engineers').goal}
            hint={certProgress(profile, 'engineers').hint}
          />
        </div>
      </Card>
    ),
  );
}

/**
 * Partner Performance: drill down into one partner manager's book or a single
 * partner. Dropdowns on the right pick the manager and partner; a meeting
 * tracker per table (and weekly-goal progress) sit alongside the pipeline.
 *
 * The route reads the scoped contract: the drill-down and the phase are
 * inputs to the provider's queries, and every card carries its own loading,
 * error, retry, and metadata state rather than a share of a whole-book load.
 */
export default function PartnerPerformanceView({
  provider,
  edits,
  classifications,
  prospects,
  initialPartnerId = 'all',
}: {
  provider: DataProvider;
  edits: SessionEdits;
  classifications: Record<string, MeetingClassification>;
  prospects: Partner[];
  initialPartnerId?: string;
}) {
  const [phase, setPhase] = useState<FiscalPhase>('q3');
  const [managerId, setManagerId] = useState('all');
  const [partnerId, setPartnerId] = useState(initialPartnerId);
  const queries = usePartnerPerformanceQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    phase,
    managerId,
    partnerId,
    edits,
    classifications,
    prospects,
  });

  const phaseLabel = FISCAL_PHASE_META[phase].label;
  const outcomeScope = phase === 'fy' ? `${FISCAL_YEAR} to date` : `${FISCAL_YEAR} ${phaseLabel}`;

  const roster = queries.roster.data ?? [];
  const managerPartners = roster.filter(
    (partner) => managerId === 'all' || partner.partnerManagerId === managerId,
  );
  const managerName = queries.managers.data?.find((manager) => manager.id === managerId)?.name;
  const uniquePartners = partnerCount(partnerId, managerPartners, roster);
  const selectedLabel = selectedScopeLabel(partnerId, managerId, roster, managerName);

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
          {renderQueryState('manager directory', queries.managers, (managers) => (
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
                {managers.map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {renderQueryState('partner roster', queries.roster, (partners) => (
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
                {partners
                  .filter(
                    (partner) => managerId === 'all' || partner.partnerManagerId === managerId,
                  )
                  .slice()
                  .sort((a: Partner, b: Partner) => a.name.localeCompare(b.name))
                  .map((partner) => (
                    <option key={partner.id} value={partner.id}>
                      {partner.name}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {queries.roster.data !== null && (
            <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              Scope · {managerId === 'all' ? 'whole org' : managerName} · {uniquePartners} partner
              {uniquePartners === 1 ? '' : 's'}
            </p>
          )}
        </div>
      </div>

      {renderQueryState('performance summary', queries.summary, (summary) => {
        const wonDelta =
          summary.priorClosedWon > 0 ? summary.closedWon / summary.priorClosedWon - 1 : null;
        return (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiTile
              label="Partner sourced pipeline"
              value={formatUsdCompact(summary.openPipelineValue)}
              sub={`${summary.openCount} open ${phaseLabel} opps`}
            />
            <KpiTile
              label={`Closed-won ${phaseLabel}`}
              value={formatUsdCompact(summary.closedWon)}
              delta={
                wonDelta === null
                  ? undefined
                  : {
                      text: `${wonDelta >= 0 ? '+' : ''}${formatPct(wonDelta)} vs prior period`,
                      positive: wonDelta >= 0,
                    }
              }
              sub={`${formatPct(summary.attainment)} of ${phase === 'fy' ? FISCAL_YEAR : phaseLabel} target`}
            />
            <KpiTile
              label="Pipeline coverage"
              value={formatCoverage(summary.coverage)}
              sub={
                summary.coverage.kind === 'coverage'
                  ? `${formatUsdCompact(summary.remainingQuota)} sourced target remaining`
                  : summary.coverage.kind === 'target-met'
                    ? 'Sourced target achieved'
                    : 'No sourced target set'
              }
            />
            <KpiTile
              label="Deal-reg approval"
              value={formatPct(summary.approvalRate)}
              sub={`${summary.decidedRegistrations} decided`}
            />
            <KpiTile
              label="Reg → qualified opp"
              value={formatPct(summary.conversionRate)}
              sub={`${summary.convertedRegistrations} opps from reg`}
            />
            <KpiTile
              label={`Win rate ${phaseLabel}`}
              value={formatPct(summary.winRate)}
              sub="of closed sourced revenue"
            />
            <KpiTile
              label="Active partners"
              value={`${summary.activePartners}`}
              sub={`with FY activity · of ${summary.alignedPartners} aligned`}
            />
            <KpiTile
              label="Avg open deal"
              value={formatUsdCompact(summary.avgOpenDealSize)}
              sub="per open sourced opportunity"
            />
          </div>
        );
      })}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Deal registration funnel" subtitle={`Registrations · ${phaseLabel}`}>
          {renderQueryState('registration funnel', queries.funnel, (funnel) => (
            <MetricBars rows={funnelRows(funnel, 'count')} />
          ))}
        </Card>
        <Card
          title="Pipeline by sales stage"
          subtitle={`Open ${phaseLabel} opportunities by stage, plus closed ${outcomeScope} outcomes`}
        >
          {renderQueryState('pipeline by stage', queries.stages, (breakdown) => (
            <MetricBars rows={stageRows(breakdown, outcomeScope)} />
          ))}
        </Card>
      </div>

      <Card
        title="Revenue vs. partner sourced target"
        subtitle="Closed-won by fiscal quarter against combined targets · all FY27 quarters"
      >
        {renderQueryState('revenue trend', queries.trend, (quarterly) => (
          <RevenueTrend data={quarterly} />
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Weekly partner activity"
          subtitle="Current and previous seven weeks for this scope"
          action={
            queries.activity.data !== null ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                {queries.activity.data.reduce((sum, row) => sum + row.total, 0)} meetings
              </span>
            ) : undefined
          }
        >
          {renderQueryState('weekly activity', queries.activity, (activity) => (
            <ActivityTracker rows={activity} />
          ))}
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
          {renderQueryState('weekly goal', queries.goal, (goal) => (
            <div className="space-y-4">
              <ProgressBar
                label="Partner meetings"
                value={goal.meetings}
                goal={goal.meetingsGoal}
              />
              <ProgressBar label="PIO interlocks" value={goal.pioMeetings} goal={goal.pioGoal} />
              <p className="text-xs text-granite">
                {MEETING_TYPE_META['pio-interlock'].fullLabel}. Classify calls in Activity Tracking
                to update these bars.
              </p>
            </div>
          ))}
        </Card>
      </div>

      <PipelineOpportunitiesCard phase={phase} opportunities={queries.opportunities} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ReviewQueueCard pending={queries.pending} roster={roster} />
        <LeaderboardCard leaderboard={queries.leaderboard} phaseLabel={phaseLabel} />
      </div>

      <ExclusivityCard ops={queries.ops} unconverted={queries.unconverted} roster={roster} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Registration conversion time"
          subtitle="Average days between each step for this scope · submitted → approved → opportunity → win"
        >
          {renderQueryState('registration conversion times', queries.ops, (ops) => (
            <MetricBars
              rows={conversionRows(
                ops.times,
                `avg business days · ${REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA`,
              )}
            />
          ))}
        </Card>
        <Card
          title="Registration leakage"
          subtitle={`What the funnel loses · counts in this scope`}
        >
          {renderQueryState('registration leakage', queries.ops, (ops) => (
            <MetricBars rows={leakageRows(ops)} />
          ))}
          <p className="mt-4 text-xs text-granite">
            Leakage is approved registrations that never became opportunities, registrations outside
            their service levels, and clients registered by more than one partner.
          </p>
        </Card>
      </div>

      <DuplicatesCard duplicates={queries.duplicates} roster={roster} />

      {partnerId !== 'all' && <CertificationCard certification={queries.certification} />}
    </div>
  );
}
