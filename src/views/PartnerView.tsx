import { useState } from 'react';
import Badge from '../components/Badge';
import Card from '../components/Card';
import ExclusivityTable from '../components/ExclusivityTable';
import FilterChips, { type ChipOption } from '../components/FilterChips';
import KpiTile from '../components/KpiTile';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import OpportunityTable from '../components/OpportunityTable';
import PageFooter from '../components/PageFooter';
import PartnerPicker from '../components/PartnerPicker';
import { renderQueryState, renderQueryStates } from '../components/QueryState';
import RegistrationsTable from '../components/RegistrationsTable';
import RevenueTrend from '../components/RevenueTrend';
import {
  FISCAL_PHASES,
  FISCAL_PHASE_META,
  FISCAL_YEAR,
  OPP_TYPE_META,
  PARTNER_TIER_META,
  PARTNER_TYPE_META,
  REGION_META,
  REGISTRATION_EXCLUSIVITY_DAYS,
  STAGE_META,
} from '../data/constants';
import type { DataProvider } from '../data/DataProvider';
import { pageWindowAsQuery } from '../data/paginationState';
import type { QueryState } from '../data/queryState';
import type {
  PartnerCertificationProfile,
  PerformanceSummary,
  RegistrationOpsSummary,
  StageBreakdown,
} from '../data/DataProvider';
import {
  usePartnerPickerQueries,
  usePartnerViewQueries,
  type PartnerSlice,
} from '../data/usePartnerViewQueries';
import type { FiscalPhase, Partner } from '../data/types';
import { formatCoverage } from '../lib/metrics';
import type { QuarterRevenueRow, TypeRow } from '../lib/metrics';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';

const SLICE_OPTIONS: ChipOption<PartnerSlice>[] = [
  { id: 'all', label: 'Total pipeline', title: 'Sell With and Allocate combined' },
  { id: 'sell-with', label: 'Sell With', title: OPP_TYPE_META['sell-with'].description },
  { id: 'allocate', label: 'Allocate', title: OPP_TYPE_META.allocate.description },
];

const PHASE_OPTIONS: ChipOption<FiscalPhase>[] = FISCAL_PHASES.map((phase) => ({
  id: phase,
  label: FISCAL_PHASE_META[phase].label,
  title: FISCAL_PHASE_META[phase].description,
}));

/**
 * Attainment against a certification goal. A goal of zero is a real state in
 * an enablement system (a partner tier with nothing required of it), and
 * dividing by it would reach Intl.NumberFormat as Infinity and render "∞% of
 * goal". The same guard sits on the leaderboard's certification cell.
 */
function attainmentText(certified: number, goal: number): string {
  return goal > 0 ? `${formatPct(certified / goal)} of goal` : 'No goal set';
}

/** The KPI tiles, grouped by the query that answers them. */
function PartnerKpis({
  slice,
  sliceLabel,
  phase,
  summary,
  ops,
  certification,
}: {
  slice: PartnerSlice;
  sliceLabel: string;
  phase: FiscalPhase;
  summary: QueryState<PerformanceSummary>;
  ops: QueryState<RegistrationOpsSummary>;
  certification: QueryState<PartnerCertificationProfile | null>;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {renderQueryState(
        'performance summary',
        summary,
        (data) => (
          <>
            <KpiTile
              label={slice === 'all' ? 'Open pipeline' : `Open ${sliceLabel} pipeline`}
              value={formatUsdCompact(data.openPipelineValue)}
              sub={
                slice === 'all'
                  ? `${data.openCount} open · ${
                      data.coverage.kind === 'coverage'
                        ? `${formatCoverage(data.coverage)} coverage`
                        : formatCoverage(data.coverage).toLowerCase()
                    }`
                  : `${data.openCount} open ${sliceLabel} opp${data.openCount === 1 ? '' : 's'}`
              }
            />
            <KpiTile
              label={`Closed-won ${FISCAL_PHASE_META[phase].label}`}
              value={formatUsdCompact(data.closedWon)}
              sub={
                slice === 'all'
                  ? `${formatPct(data.attainment)} of their ${
                      phase === 'fy' ? FISCAL_YEAR : FISCAL_PHASE_META[phase].label
                    } target`
                  : `${sliceLabel} only · target covers all revenue`
              }
            />
            <KpiTile
              label="Win rate"
              value={formatPct(data.winRate)}
              sub={
                slice === 'all'
                  ? `of closed ${FISCAL_PHASE_META[phase].label}`
                  : `of closed ${sliceLabel} ${FISCAL_PHASE_META[phase].label}`
              }
            />
          </>
        ),
        'contents',
      )}
      {renderQueryState(
        'registration queue depth',
        ops,
        (data) => (
          <KpiTile label="Awaiting review" value={`${data.pending}`} sub="registrations pending" />
        ),
        'contents',
      )}
      {renderQueryState(
        'certification record',
        certification,
        (profile) => {
          const record = profile?.certification;
          return (
            <>
              <KpiTile
                label="Partner strategists certified"
                value={
                  record
                    ? `${record.partnerStrategistsCertified}/${record.partnerStrategistsGoal}`
                    : '—'
                }
                sub={
                  record
                    ? attainmentText(
                        record.partnerStrategistsCertified,
                        record.partnerStrategistsGoal,
                      )
                    : 'No certification data'
                }
              />
              <KpiTile
                label="Partner engineers certified"
                value={
                  record
                    ? `${record.partnerEngineersCertified}/${record.partnerEngineersGoal}`
                    : '—'
                }
                sub={
                  record
                    ? attainmentText(record.partnerEngineersCertified, record.partnerEngineersGoal)
                    : 'No certification data'
                }
              />
            </>
          );
        },
        'contents',
      )}
    </div>
  );
}

/** The conversion-time bars from the ops answer's own times. */
function timelineRows(times: RegistrationOpsSummary['times']): MetricBarRow[] {
  const fmtDays = (days: number | null) => (days === null ? '—' : `${days.toFixed(1)}d`);
  return [
    {
      label: 'Submitted → Approved',
      value: times.submittedToApprovedBusinessDays ?? 0,
      displayValue: fmtDays(times.submittedToApprovedBusinessDays),
      // The approval hop is measured in the SLA's own unit, so the bar reads
      // directly against the response SLA.
      secondary: 'avg business days · 5-business-day SLA',
      color: '#7e7b78',
    },
    {
      label: 'Approved → Opportunity',
      value: times.approvedToOpportunityCalendarDays ?? 0,
      displayValue: fmtDays(times.approvedToOpportunityCalendarDays),
      secondary: 'avg elapsed calendar days · converted registrations',
      color: '#9a9693',
    },
    {
      label: 'Opportunity → Win',
      value: times.opportunityToWinCalendarDays ?? 0,
      displayValue: fmtDays(times.opportunityToWinCalendarDays),
      secondary: 'avg elapsed calendar days · converted & won',
      color: '#a0ca92',
    },
    {
      label: 'Submitted → Win',
      value: times.submittedToWinCalendarDays ?? 0,
      displayValue: fmtDays(times.submittedToWinCalendarDays),
      secondary: 'avg elapsed calendar days · converted & won',
      color: '#b8b3b0',
    },
  ];
}

function stageRows(stages: StageBreakdown): MetricBarRow[] {
  return stages.stages.map((row) => ({
    label: STAGE_META[row.stage].label,
    value: row.value,
    displayValue: formatUsdCompact(row.value),
    secondary: `${row.count} open`,
    color: STAGE_META[row.stage].color,
  }));
}

/**
 * The motion split: the phase's open pipeline across the partner's motions.
 * The partner audience's book holds no Sell To rows at all, so the two
 * portal motions sum to the whole visible pipeline.
 */
function motionRows(motions: TypeRow[]): MetricBarRow[] {
  const byType = new Map(motions.map((row) => [row.type, row]));
  const sellWith = byType.get('sell-with') ?? { count: 0, value: 0 };
  const allocate = byType.get('allocate') ?? { count: 0, value: 0 };
  const total = { count: sellWith.count + allocate.count, value: sellWith.value + allocate.value };
  return [
    {
      label: 'Total pipeline',
      value: total.value,
      displayValue: formatUsdCompact(total.value),
      secondary: `${total.count} open`,
      color: '#eeeeee',
    },
    {
      label: OPP_TYPE_META['sell-with'].label,
      value: sellWith.value,
      displayValue: formatUsdCompact(sellWith.value),
      secondary: `${sellWith.count} open`,
      color: OPP_TYPE_META['sell-with'].color,
    },
    {
      label: OPP_TYPE_META.allocate.label,
      value: allocate.value,
      displayValue: formatUsdCompact(allocate.value),
      secondary: `${allocate.count} open`,
      color: OPP_TYPE_META.allocate.color,
    },
  ];
}

/**
 * One partner's portal, mounted once a selection exists. Every card reads
 * its own scoped query — the provider computes each answer from the
 * partner's audience scope, so Sell To deals, conflicting registrations, and
 * every other partner's rows never reach this route. One rejected call fails
 * exactly one card; its retry repeats only that call.
 */
function PartnerViewBody({
  provider,
  partner,
  roster,
  phase,
  slice,
  prospects,
  onSelectPartner,
  onPhaseChange,
  onSliceChange,
}: {
  provider: DataProvider;
  partner: Partner;
  /** The picker's options: every partner, the frozen demo behavior. */
  roster: Partner[];
  phase: FiscalPhase;
  slice: PartnerSlice;
  prospects: Partner[];
  onSelectPartner: (partnerId: string) => void;
  onPhaseChange: (phase: FiscalPhase) => void;
  onSliceChange: (slice: PartnerSlice) => void;
}) {
  const queries = usePartnerViewQueries({
    provider,
    partnerId: partner.id,
    phase,
    slice,
    prospects,
  });
  const sliceLabel = slice === 'all' ? 'Sell With + Allocate' : OPP_TYPE_META[slice].label;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            Partner View
          </p>
          <h1 className="mt-2 text-3xl tracking-tight text-bone">{partner.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className={PARTNER_TIER_META[partner.tier].badgeClass}>
              {PARTNER_TIER_META[partner.tier].label}
            </Badge>
            <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
              {PARTNER_TYPE_META[partner.type]} · {REGION_META[partner.region]}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-granite">
            Account manager {partner.accountManager} · partner since {formatDate(partner.joinedAt)}
            {queries.history.meta !== null &&
              ` · ${queries.history.totalCount} lifetime registrations`}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PartnerPicker partners={roster} value={partner.id} onChange={onSelectPartner} />
          <FilterChips
            options={PHASE_OPTIONS}
            value={phase}
            onChange={onPhaseChange}
            ariaLabel="Select fiscal phase"
            size="xs"
          />
          <FilterChips
            options={SLICE_OPTIONS}
            value={slice}
            onChange={onSliceChange}
            ariaLabel="Slice pipeline by revenue motion"
          />
          <p className="max-w-xs text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            Demo selector — client filtering is not authorization; external use requires trusted
            sign-in and server-enforced row access
          </p>
        </div>
      </div>

      <PartnerKpis
        slice={slice}
        sliceLabel={sliceLabel}
        phase={phase}
        summary={queries.summary}
        ops={queries.ops}
        certification={queries.certification}
      />

      <Card title="Deal registrations" subtitle="Most recent first · all statuses">
        {renderQueryState('registration history', pageWindowAsQuery(queries.history), (rows) => (
          <>
            <RegistrationsTable
              registrations={rows}
              partners={roster}
              variant="history"
              showPartner={false}
              limit={rows.length}
            />
            <PageFooter state={queries.history} noun="registrations" pageSize={8} />
          </>
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Deal registration timeline"
          subtitle="Average conversion time across your registrations · submitted → approved → opportunity → win"
        >
          {renderQueryState('registration timeline', queries.ops, (ops) => (
            <MetricBars rows={timelineRows(ops.times)} />
          ))}
        </Card>
        <Card
          title="Exclusivity window"
          subtitle={
            queries.ops.data === null
              ? `Approved registrations without an opportunity · ${REGISTRATION_EXCLUSIVITY_DAYS}-day window from approval`
              : `${queries.ops.data.approvedNotConverted} approved registrations without an opportunity · ${REGISTRATION_EXCLUSIVITY_DAYS}-day window from approval`
          }
        >
          {renderQueryState(
            'exclusivity window',
            pageWindowAsQuery(queries.exclusivity),
            (rows) => (
              <>
                <ExclusivityTable
                  registrations={rows}
                  partners={roster}
                  showPartner={false}
                  limit={rows.length}
                />
                <PageFooter state={queries.exclusivity} noun="unconverted" pageSize={6} />
              </>
            ),
          )}
          <p className="mt-4 text-xs text-granite">
            Your approved leads keep exclusivity for {REGISTRATION_EXCLUSIVITY_DAYS} calendar days —
            introduce the lead within it or the window lapses.
          </p>
        </Card>
      </div>

      <Card
        title={`Pipeline opportunities · ${FISCAL_PHASE_META[phase].label}`}
        subtitle={
          queries.pipeline.meta === null
            ? 'Salesforce fields shown as mock data'
            : `${queries.pipeline.totalCount} opportunities · Salesforce fields shown as mock data`
        }
      >
        {renderQueryState('pipeline opportunities', pageWindowAsQuery(queries.pipeline), (rows) => (
          <>
            <OpportunityTable
              opportunities={rows}
              emptyMessage={`No ${
                slice === 'all' ? '' : `${sliceLabel} `
              }${FISCAL_PHASE_META[phase].label} opportunities.`}
            />
            <PageFooter state={queries.pipeline} noun="opportunities" pageSize={25} />
          </>
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Revenue vs. target"
          subtitle={
            slice === 'all'
              ? 'Closed-won by quarter against target'
              : `${sliceLabel} closed-won · target covers all revenue`
          }
        >
          {renderQueryState('revenue trend', queries.trend, (trend: QuarterRevenueRow[]) => (
            <RevenueTrend data={trend} />
          ))}
        </Card>
        <Card title="Pipeline by stage" subtitle={`Open ${sliceLabel} opportunities`}>
          {renderQueryState('pipeline by stage', queries.stages, (stages) => (
            <MetricBars rows={stageRows(stages)} />
          ))}
        </Card>
      </div>

      <Card
        title="Pipeline by revenue motion"
        subtitle={`Open ${FISCAL_PHASE_META[phase].label} pipeline split across your motions · always shows the full visible book`}
      >
        {renderQueryState('revenue motion split', queries.motions, (motions) => (
          <MetricBars rows={motionRows(motions)} />
        ))}
      </Card>
    </>
  );
}

/**
 * Partner-facing portal. In production this view would be scoped by partner
 * SSO; the picker here is an untrusted demo presentation selector, not a
 * security boundary, and the visible note next to it says so. Only Sell With
 * and Allocate opportunities are visible — Sell To is internal-only.
 *
 * The picker is the route's only whole-roster read, and it is frozen demo
 * behavior: every partner stays an option. Everything below it is the
 * selected partner's scoped projection through `usePartnerViewQueries`.
 */
export default function PartnerView({
  provider,
  prospects,
}: {
  provider: DataProvider;
  prospects: Partner[];
}) {
  const picker = usePartnerPickerQueries({ provider, prospects });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [slice, setSlice] = useState<PartnerSlice>('all');
  const [phase, setPhase] = useState<FiscalPhase>('q3');

  return (
    <div className="space-y-6">
      {renderQueryStates(
        'The partner list',
        [
          ['the partner list', picker.roster],
          ['the partner ranking', picker.defaultPick],
        ],
        () => {
          const roster = picker.roster.data ?? [];
          // Default to the top-performing partner on portal-visible revenue
          // so the first view is representative; the picker owns it after.
          const partnerId = selectedId ?? picker.defaultPick.data ?? roster[0]?.id;
          const partner = roster.find((candidate) => candidate.id === partnerId);
          if (partner === undefined) {
            return <p className="text-sm text-granite">No partners available.</p>;
          }
          return (
            <PartnerViewBody
              key={partner.id}
              provider={provider}
              partner={partner}
              roster={roster}
              phase={phase}
              slice={slice}
              prospects={prospects}
              onSelectPartner={setSelectedId}
              onPhaseChange={setPhase}
              onSliceChange={setSlice}
            />
          );
        },
      )}
    </div>
  );
}
