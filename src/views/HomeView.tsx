import { useState } from 'react';
import ActivityTracker from '../components/ActivityTracker';
import Card from '../components/Card';
import FilterChips, { type ChipOption } from '../components/FilterChips';
import KpiTile from '../components/KpiTile';
import Leaderboard from '../components/Leaderboard';
import LightCard from '../components/LightCard';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import { QueryFailure, renderQueryState, useRetryRecovery } from '../components/QueryState';
import RegistrationsTable from '../components/RegistrationsTable';
import RevenueTrend from '../components/RevenueTrend';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  FISCAL_YEAR,
  MEETING_TYPE_META,
  OPP_TYPES,
  OPP_TYPE_META,
  SNAPSHOT_DATE,
} from '../data/constants';
import type { DataProvider } from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import type { SessionEdits } from '../data/sessionEdits';
import type { FiscalPhase, MeetingClassification, OpportunityType, Partner } from '../data/types';
import { useHomeQueries } from '../data/useHomeQueries';
import {
  FUNNEL_MEASURE_OPTIONS,
  type FunnelMeasure,
  funnelRows,
  funnelSubtitle,
  stageRows,
} from './performanceRows';
import type { TypeRow } from '../lib/metrics';
import { formatCoverage } from '../lib/metrics';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';

type TypeFilter = OpportunityType | 'all';

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

function typeRows(types: TypeRow[]): MetricBarRow[] {
  return types.map((row) => ({
    label: OPP_TYPE_META[row.type].label,
    value: row.value,
    displayValue: formatUsdCompact(row.value),
    secondary: `${row.count} open`,
    color: OPP_TYPE_META[row.type].color,
  }));
}

/**
 * Home: high-level summary stats for the whole partner ecosystem. This is the
 * aggregate landing view — always "All Partners", with fiscal phase and
 * opportunity-type slicing only. Per-manager and per-partner drill-downs live
 * in Partner Performance.
 *
 * The route reads the scoped contract: every card is one provider query with
 * its own loading, error, retry, and metadata state, and the phase/type
 * filters are inputs to those queries rather than reductions over a book the
 * browser fetched whole.
 */
export default function HomeView({
  provider,
  edits,
  classifications,
  prospects,
}: {
  provider: DataProvider;
  edits: SessionEdits;
  classifications: Record<string, MeetingClassification>;
  prospects: Partner[];
}) {
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [funnelMeasure, setFunnelMeasure] = useState<FunnelMeasure>('value');
  const [phase, setPhase] = useState<FiscalPhase>('q3');
  const queries = useHomeQueries({
    provider,
    access: INTERNAL_DEMO_SCOPE,
    phase,
    oppType: typeFilter,
    edits,
    classifications,
    prospects,
  });

  const phaseLabel = FISCAL_PHASE_META[phase].label;
  const outcomeScope = phase === 'fy' ? `${FISCAL_YEAR} to date` : `${FISCAL_YEAR} ${phaseLabel}`;
  const phaseDescription = FISCAL_PHASE_META[phase].description;

  // The roster names the review queue's partner column and the header's
  // aligned-partner count. Its failure must not take the cards down with it:
  // they keep rendering with the explicit partner-id fallback, the failure is
  // named beside them, and the named retry repeats only the roster query. The
  // region persists across the recovery so the successful retry has a stable
  // focus target.
  const rosterRecovery = useRetryRecovery('partner roster', queries.roster.error !== null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            All Partners
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">Partner Performance Overview</h1>
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
            Whole ecosystem
            {queries.roster.data !== null && ` · ${queries.roster.data.length} aligned partners`}
          </p>
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
              label="Partner sourced pipeline coverage"
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
        <Card
          title="Deal registration funnel"
          subtitle={funnelSubtitle(funnelMeasure, phaseLabel)}
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
          {renderQueryState('registration funnel', queries.funnel, (funnel) => (
            <MetricBars rows={funnelRows(funnel, funnelMeasure)} />
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
        subtitle="Closed-won by fiscal quarter against combined partner-sourced targets · all FY27 quarters"
      >
        {renderQueryState('revenue trend', queries.trend, (quarterly) => (
          <RevenueTrend data={quarterly} />
        ))}
      </Card>

      <Card
        title="Weekly partner activity"
        subtitle="Google Calendar meeting mock · current and previous seven weeks"
        action={
          queries.activity.data !== null ? (
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              {queries.activity.data.reduce((sum, row) => sum + row.total, 0)} meetings tracked
            </span>
          ) : undefined
        }
      >
        {renderQueryState('weekly activity', queries.activity, (activity) => (
          <>
            <ActivityTracker rows={activity} />
            <p className="mt-4 text-xs text-granite">
              Meeting types include {MEETING_TYPE_META.discovery.fullLabel},{' '}
              {MEETING_TYPE_META['pio-interlock'].fullLabel},{' '}
              {MEETING_TYPE_META['pao-interlock'].fullLabel}, Interlock Cadence, Deal Support,
              Technical Enablement, GTM Enablement, and Partner Cadence. Classifications from
              Activity Tracking roll up here.
            </p>
          </>
        ))}
      </Card>

      {(queries.roster.data !== null || queries.roster.error !== null) && (
        <div ref={rosterRecovery.regionRef} {...rosterRecovery.regionProps}>
          {queries.roster.error !== null && (
            <QueryFailure
              text={
                queries.roster.data === null
                  ? 'Partner names unavailable — showing partner ids'
                  : 'Latest partner roster refresh failed'
              }
              retryLabel="partner roster"
              error={queries.roster.error}
              onRetry={rosterRecovery.armRetry(queries.roster.retry)}
            />
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Pipeline by opportunity type"
          subtitle={`Open ${phaseLabel} pipeline: Sell To / Sell With / Allocate`}
        >
          {renderQueryState('pipeline by type', queries.types, (types) => (
            <>
              <MetricBars rows={typeRows(types)} />
              {typeFilter === 'all' ? (
                <p className="mt-4 text-xs text-granite">
                  Select a type above to filter KPIs, stages, revenue, and the leaderboard.
                </p>
              ) : (
                <p className="mt-4 text-xs text-granite">
                  Filter active: {OPP_TYPE_META[typeFilter].label} only. Registrations are untyped
                  and stay unfiltered.
                </p>
              )}
            </>
          ))}
        </Card>
        <LightCard
          title="Registrations awaiting review"
          subtitle={
            queries.pending.meta === null
              ? 'Oldest first · colored against the 5-business-day SLA'
              : `${queries.pending.totalCount} pending · oldest first · colored against the 5-business-day SLA`
          }
        >
          {renderQueryState('review queue', pageWindowAsQuery(queries.pending), (pending) => (
            <RegistrationsTable
              registrations={pending}
              partners={queries.roster.data ?? []}
              variant="queue"
              tone="light"
              limit={7}
            />
          ))}
          <p className="mt-3 text-xs text-granite">
            Day counters are green inside the 5-business-day response SLA and red once past it.
          </p>
        </LightCard>
      </div>

      <Card
        title="Partner leaderboard"
        subtitle={
          queries.leaderboard.data === null
            ? `Top partners by closed-won ${phaseLabel}`
            : `Top ${queries.leaderboard.data.leaders.length} of ${queries.leaderboard.data.totalPartners} partners by closed-won ${phaseLabel}`
        }
      >
        {renderQueryState('partner leaderboard', queries.leaderboard, (answer) => (
          <Leaderboard
            rows={answer.leaders}
            limit={answer.leaders.length}
            closedWonLabel={`Closed-won ${phaseLabel}`}
          />
        ))}
      </Card>
    </div>
  );
}
