import { useMemo, useState } from 'react';
import Badge from '../components/Badge';
import Card from '../components/Card';
import KpiTile from '../components/KpiTile';
import MetricBars, { type MetricBarRow } from '../components/MetricBars';
import PartnerPicker from '../components/PartnerPicker';
import RegistrationsTable from '../components/RegistrationsTable';
import RevenueTrend from '../components/RevenueTrend';
import {
  CURRENT_YEAR,
  PARTNER_TIER_META,
  PARTNER_TYPE_META,
  REGION_META,
  STAGE_META,
} from '../data/constants';
import type { DashboardData } from '../data/types';
import { formatDate, formatPct, formatUsdCompact } from '../lib/format';
import {
  closedWonYtd,
  coverageRatio,
  formatCoverage,
  openPipeline,
  partnerLeaderboard,
  pendingRegistrations,
  quarterlyClosedWonAndTarget,
  recentRegistrations,
  stageBreakdown,
  winRateYtd,
  ytdTarget,
} from '../lib/metrics';

/**
 * Partner-facing portal. In production this view is scoped by partner SSO;
 * the picker here simulates that. Only Sell With and Allocate opportunities
 * are visible — Sell To is internal-only.
 */
export default function PartnerView({ data }: { data: DashboardData }) {
  const [partnerId, setPartnerId] = useState<string>(
    () => partnerLeaderboard(data, 'all')[0]?.partner.id ?? data.partners[0]?.id ?? '',
  );

  // Default to the top-performing partner so the first view is representative.
  const partner =
    data.partners.find((candidate) => candidate.id === partnerId) ?? data.partners[0];

  const partnerOpps = useMemo(
    () =>
      data.opportunities.filter(
        (opp) => opp.partnerId === partnerId && opp.oppType !== 'sell-to',
      ),
    [data.opportunities, partnerId],
  );
  const partnerTargets = useMemo(
    () => data.targets.filter((target) => target.partnerId === partnerId),
    [data.targets, partnerId],
  );
  const partnerRegistrations = useMemo(
    () => data.registrations.filter((reg) => reg.partnerId === partnerId),
    [data.registrations, partnerId],
  );

  if (!partner) {
    return <p className="text-sm text-granite">No partners available.</p>;
  }

  const pipeline = openPipeline(partnerOpps);
  const wonYtd = closedWonYtd(partnerOpps);
  const winRate = winRateYtd(partnerOpps);
  const pending = pendingRegistrations(data.registrations, partnerId);
  const target = ytdTarget(partnerTargets);
  const attainment = target > 0 ? wonYtd / target : 0;
  const coverage = coverageRatio(partnerOpps, partnerTargets);
  const quarterly = quarterlyClosedWonAndTarget(partnerOpps, partnerTargets);
  const stages = stageBreakdown(partnerOpps);
  const registrations = recentRegistrations(data.registrations, partnerId, 8);

  const stageRows: MetricBarRow[] = stages.map((row) => ({
    label: STAGE_META[row.stage].label,
    value: row.value,
    displayValue: formatUsdCompact(row.value),
    secondary: `${row.count} open`,
    color: STAGE_META[row.stage].color,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-signal">
            Partner portal
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
            Account manager {partner.accountManager} · partner since{' '}
            {formatDate(partner.joinedAt)} · {partnerRegistrations.length} lifetime registrations
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <PartnerPicker partners={data.partners} value={partner.id} onChange={setPartnerId} />
          <p className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
            In production, scoped by partner SSO
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label="Open pipeline"
          value={formatUsdCompact(pipeline.value)}
          sub={`${pipeline.count} open · ${
            coverage === null ? 'target met' : `${formatCoverage(coverage)} coverage`
          }`}
        />
        <KpiTile
          label="Closed-won YTD"
          value={formatUsdCompact(wonYtd)}
          sub={`${formatPct(attainment)} of their ${CURRENT_YEAR} target`}
        />
        <KpiTile label="Win rate" value={formatPct(winRate)} sub="of closed YTD" />
        <KpiTile
          label="Awaiting review"
          value={`${pending.length}`}
          sub="registrations pending"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Revenue vs. target" subtitle="Their closed-won by quarter vs. their target">
          <RevenueTrend data={quarterly} />
        </Card>
        <Card title="Their pipeline by stage" subtitle="Open Sell With + Allocate opportunities">
          <MetricBars rows={stageRows} />
        </Card>
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
    </div>
  );
}
