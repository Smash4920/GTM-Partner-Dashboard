import { useMemo, useState } from 'react';
import Badge from '../components/Badge';
import Card from '../components/Card';
import ExclusivityTable from '../components/ExclusivityTable';
import FilterChips, { type ChipOption } from '../components/FilterChips';
import KpiTile from '../components/KpiTile';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import OpportunityTable from '../components/OpportunityTable';
import PartnerPicker from '../components/PartnerPicker';
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
import type { DashboardData, FiscalPhase, Opportunity } from '../data/types';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import {
  approvedNotConverted,
  closedWonForPhase,
  coverageRatio,
  filterByPhase,
  formatCoverage,
  openPipeline,
  partnerLeaderboard,
  pendingRegistrations,
  quarterlyClosedWonAndTarget,
  recentRegistrations,
  registrationConversionTimes,
  stageBreakdown,
  targetsForPhase,
  winRateForPhase,
  ytdTarget,
} from '../lib/metrics';

/** Partners see their whole book or one revenue motion within it. */
type PartnerSlice = 'all' | 'sell-with' | 'allocate';

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

/**
 * Partner-facing portal. In production this view is scoped by partner SSO;
 * the picker here simulates that. Only Sell With and Allocate opportunities
 * are visible — Sell To is internal-only.
 */
export default function PartnerView({ data }: { data: DashboardData }) {
  const [partnerId, setPartnerId] = useState<string>(() => {
    // Rank the default partner on revenue the portal can actually show:
    // Sell To is internal-only, so it must not drive the "top" pick.
    const visible = data.opportunities.filter((opp) => opp.oppType !== 'sell-to');
    return (
      partnerLeaderboard({ ...data, opportunities: visible }, 'all')[0]?.partner.id ??
      data.partners[0]?.id ??
      ''
    );
  });
  const [slice, setSlice] = useState<PartnerSlice>('all');
  const [phase, setPhase] = useState<FiscalPhase>('q3');

  // Default to the top-performing partner so the first view is representative.
  const partner = data.partners.find((candidate) => candidate.id === partnerId) ?? data.partners[0];

  // Everything the partner is allowed to see: Sell To is internal-only.
  const visibleOpps = useMemo(
    () =>
      data.opportunities.filter((opp) => opp.partnerId === partnerId && opp.oppType !== 'sell-to'),
    [data.opportunities, partnerId],
  );
  const phaseVisibleOpps = useMemo(() => filterByPhase(visibleOpps, phase), [visibleOpps, phase]);
  const partnerOpps = useMemo(
    () =>
      slice === 'all'
        ? phaseVisibleOpps
        : phaseVisibleOpps.filter((opp: Opportunity) => opp.oppType === slice),
    [phaseVisibleOpps, slice],
  );
  const partnerTargets = useMemo(
    () => data.targets.filter((target) => target.partnerId === partnerId),
    [data.targets, partnerId],
  );
  const partnerRegistrations = useMemo(
    () => data.registrations.filter((reg) => reg.partnerId === partnerId),
    [data.registrations, partnerId],
  );
  // The portal pairs the deal-registration ops section with each partner's
  // own book: their conversion times and their exclusivity window. Conflicts
  // and other partners' submissions stay internal.
  const partnerLeaking = useMemo(
    () => approvedNotConverted(partnerRegistrations),
    [partnerRegistrations],
  );
  const partnerTimes = useMemo(
    () => registrationConversionTimes(partnerRegistrations, visibleOpps),
    [partnerRegistrations, visibleOpps],
  );

  if (!partner) {
    return <p className="text-sm text-granite">No partners available.</p>;
  }

  const pipeline = openPipeline(partnerOpps);
  const wonYtd = closedWonForPhase(partnerOpps, phase);
  const winRate = winRateForPhase(partnerOpps, phase);
  const pending = pendingRegistrations(data.registrations, partnerId);
  const phaseTargets = targetsForPhase(partnerTargets, phase);
  const target = phase === 'fy' ? ytdTarget(partnerTargets) : ytdTarget(phaseTargets);
  const attainment = target > 0 ? wonYtd / target : 0;
  const coverage = coverageRatio(partnerOpps, partnerTargets, phase);
  // The chart buckets by fiscal quarter itself, so it gets the partner's
  // motion-scoped book *before* phase filtering — phase-filtered input would
  // draw $0 for every quarter outside the selected phase.
  const quarterlyOpps =
    slice === 'all' ? visibleOpps : visibleOpps.filter((opp) => opp.oppType === slice);
  const quarterly = quarterlyClosedWonAndTarget(quarterlyOpps, partnerTargets);
  const stages = stageBreakdown(partnerOpps);
  const registrations = recentRegistrations(data.registrations, partnerId, 8);

  const stageRows: MetricBarRow[] = stages.map((row) => ({
    label: STAGE_META[row.stage].label,
    value: row.value,
    displayValue: formatUsdCompact(row.value),
    secondary: `${row.count} open`,
    color: STAGE_META[row.stage].color,
  }));

  // Always computed over everything visible, so the split stays readable
  // regardless of which slice is selected above.
  const sellWith = openPipeline(phaseVisibleOpps.filter((opp) => opp.oppType === 'sell-with'));
  const allocate = openPipeline(phaseVisibleOpps.filter((opp) => opp.oppType === 'allocate'));
  const total = openPipeline(phaseVisibleOpps);
  const certification = data.certifications.find((item) => item.partnerId === partnerId);

  const sliceRows: MetricBarRow[] = [
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

  const sliceLabel = slice === 'all' ? 'Sell With + Allocate' : OPP_TYPE_META[slice].label;

  const fmtDays = (days: number | null) => (days === null ? '—' : `${days.toFixed(1)}d`);
  const timelineRows: MetricBarRow[] = [
    {
      label: 'Submitted → Approved',
      value: partnerTimes.submittedToApproved ?? 0,
      displayValue: fmtDays(partnerTimes.submittedToApproved),
      secondary: '5-business-day SLA',
      color: '#7e7b78',
    },
    {
      label: 'Approved → Opportunity',
      value: partnerTimes.approvedToOpportunity ?? 0,
      displayValue: fmtDays(partnerTimes.approvedToOpportunity),
      secondary: 'converted registrations',
      color: '#9a9693',
    },
    {
      label: 'Opportunity → Win',
      value: partnerTimes.opportunityToWin ?? 0,
      displayValue: fmtDays(partnerTimes.opportunityToWin),
      secondary: 'converted & won',
      color: '#a0ca92',
    },
    {
      label: 'Submitted → Win',
      value: partnerTimes.submittedToWin ?? 0,
      displayValue: fmtDays(partnerTimes.submittedToWin),
      secondary: 'converted & won',
      color: '#b8b3b0',
    },
  ];

  return (
    <div className="space-y-6">
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
            Account manager {partner.accountManager} · partner since {formatDate(partner.joinedAt)}{' '}
            · {partnerRegistrations.length} lifetime registrations
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PartnerPicker partners={data.partners} value={partner.id} onChange={setPartnerId} />
          <FilterChips
            options={PHASE_OPTIONS}
            value={phase}
            onChange={setPhase}
            ariaLabel="Select fiscal phase"
            size="xs"
          />
          <FilterChips
            options={SLICE_OPTIONS}
            value={slice}
            onChange={setSlice}
            ariaLabel="Slice pipeline by revenue motion"
          />
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            In production, scoped by partner SSO
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label={slice === 'all' ? 'Open pipeline' : `Open ${sliceLabel} pipeline`}
          value={formatUsdCompact(pipeline.value)}
          sub={
            slice === 'all'
              ? `${pipeline.count} open · ${
                  coverage === null ? 'target met' : `${formatCoverage(coverage)} coverage`
                }`
              : `${pipeline.count} open ${sliceLabel} opp${pipeline.count === 1 ? '' : 's'}`
          }
        />
        <KpiTile
          label={`Closed-won ${FISCAL_PHASE_META[phase].label}`}
          value={formatUsdCompact(wonYtd)}
          sub={
            slice === 'all'
              ? `${formatPct(attainment)} of their ${
                  phase === 'fy' ? FISCAL_YEAR : FISCAL_PHASE_META[phase].label
                } target`
              : `${sliceLabel} only · target covers all revenue`
          }
        />
        <KpiTile
          label="Win rate"
          value={formatPct(winRate)}
          sub={
            slice === 'all'
              ? `of closed ${FISCAL_PHASE_META[phase].label}`
              : `of closed ${sliceLabel} ${FISCAL_PHASE_META[phase].label}`
          }
        />
        <KpiTile label="Awaiting review" value={`${pending.length}`} sub="registrations pending" />
        <KpiTile
          label="Partner strategists certified"
          value={
            certification
              ? `${certification.partnerStrategistsCertified}/${certification.partnerStrategistsGoal}`
              : '—'
          }
          sub={
            certification
              ? attainmentText(
                  certification.partnerStrategistsCertified,
                  certification.partnerStrategistsGoal,
                )
              : 'No certification data'
          }
        />
        <KpiTile
          label="Partner engineers certified"
          value={
            certification
              ? `${certification.partnerEngineersCertified}/${certification.partnerEngineersGoal}`
              : '—'
          }
          sub={
            certification
              ? attainmentText(
                  certification.partnerEngineersCertified,
                  certification.partnerEngineersGoal,
                )
              : 'No certification data'
          }
        />
      </div>

      <Card title="Deal registrations" subtitle="Most recent first · all statuses">
        <RegistrationsTable
          registrations={registrations}
          partners={data.partners}
          variant="history"
          showPartner={false}
          limit={8}
        />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Deal registration timeline"
          subtitle="Average conversion time across your registrations · submitted → approved → opportunity → win"
        >
          <MetricBars rows={timelineRows} />
        </Card>
        <Card
          title="Exclusivity window"
          subtitle={`${partnerLeaking.length} approved registrations without an opportunity · ${REGISTRATION_EXCLUSIVITY_DAYS}-day window from approval`}
        >
          <ExclusivityTable
            registrations={partnerLeaking}
            partners={data.partners}
            showPartner={false}
            limit={6}
          />
          <p className="mt-4 text-xs text-granite">
            Your approved leads keep exclusivity for {REGISTRATION_EXCLUSIVITY_DAYS} calendar days —
            introduce the lead within it or the window lapses.
          </p>
        </Card>
      </div>

      <Card
        title={`Pipeline opportunities · ${FISCAL_PHASE_META[phase].label}`}
        subtitle={`${partnerOpps.length} opportunities · Salesforce fields shown as mock data`}
      >
        <OpportunityTable
          opportunities={partnerOpps}
          emptyMessage={`No ${
            slice === 'all' ? '' : `${sliceLabel} `
          }${FISCAL_PHASE_META[phase].label} opportunities.`}
        />
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
          <RevenueTrend data={quarterly} />
        </Card>
        <Card title="Pipeline by stage" subtitle={`Open ${sliceLabel} opportunities`}>
          <MetricBars rows={stageRows} />
        </Card>
      </div>

      <Card
        title="Pipeline by revenue motion"
        subtitle={`Open ${FISCAL_PHASE_META[phase].label} pipeline split across your motions · always shows the full visible book`}
      >
        <MetricBars rows={sliceRows} />
      </Card>
    </div>
  );
}
