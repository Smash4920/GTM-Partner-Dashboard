import { PARTNER_TIER_META, PARTNER_TYPE_META, REGION_META } from '../data/constants';
import { formatPct, formatUsd } from '../lib/format';
import type { PartnerCertification } from '../data/types';
import type { LeaderboardRow } from '../lib/metrics';
import Badge from './Badge';
import TableRegion from './TableRegion';

interface LeaderboardProps {
  rows: LeaderboardRow[];
  limit?: number;
  /** Closed-won column header; callers pass the selected fiscal phase. */
  closedWonLabel?: string;
  /** When supplied, add enablement counts and attainment for every row. */
  certifications?: PartnerCertification[];
}

export default function Leaderboard({
  rows,
  limit = 10,
  closedWonLabel = 'Closed-won',
  certifications,
}: LeaderboardProps) {
  const top = rows.slice(0, limit);
  const certificationByPartner = new Map(
    (certifications ?? []).map((certification) => [certification.partnerId, certification]),
  );
  const showCertifications = certifications !== undefined;
  const th = 'pb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-granite';
  const label = showCertifications ? 'Partner leaderboard & enablement' : 'Partner leaderboard';
  return (
    <TableRegion label={label}>
      <table aria-label={label} className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-carbon">
            <th scope="col" className={`${th} pr-3 text-left`}>
              #
            </th>
            <th scope="col" className={`${th} pr-3 text-left`}>
              Partner
            </th>
            <th scope="col" className={`${th} pr-3 text-right`}>
              Open pipeline
            </th>
            <th scope="col" className={`${th} pr-3 text-right`}>
              {closedWonLabel}
            </th>
            <th scope="col" className={`${th} pr-3 text-right`}>
              Win rate
            </th>
            {showCertifications && (
              <>
                <th scope="col" className={`${th} pr-3 text-right`}>
                  Strategists
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Engineers
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {top.map((row, index) => {
            const certification = certificationByPartner.get(row.partner.id);
            return (
              <tr key={row.partner.id} className="border-b border-carbon last:border-0">
                <td className="py-2.5 pr-3 font-mono text-xs text-granite tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </td>
                <td className="py-2.5 pr-3">
                  <p className="text-bone">{row.partner.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge className={PARTNER_TIER_META[row.partner.tier].badgeClass}>
                      {PARTNER_TIER_META[row.partner.tier].label}
                    </Badge>
                    <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-granite">
                      {PARTNER_TYPE_META[row.partner.type]} · {REGION_META[row.partner.region]}
                    </span>
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-right text-stone tabular-nums">
                  {formatUsd(row.openPipelineValue)}
                </td>
                <td className="py-2.5 pr-3 text-right text-bone tabular-nums">
                  {formatUsd(row.closedWonValue)}
                </td>
                <td className="py-2.5 text-right text-stone tabular-nums">
                  {formatPct(row.winRate)}
                </td>
                {showCertifications && (
                  <>
                    <CertificationCell
                      certified={certification?.partnerStrategistsCertified}
                      goal={certification?.partnerStrategistsGoal}
                    />
                    <CertificationCell
                      certified={certification?.partnerEngineersCertified}
                      goal={certification?.partnerEngineersGoal}
                    />
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableRegion>
  );
}

function CertificationCell({ certified, goal }: { certified?: number; goal?: number }) {
  if (certified === undefined || goal === undefined) {
    return (
      <td className="py-2.5 text-right text-granite">
        <span className="font-mono text-xs">—</span>
        <span className="mt-0.5 block text-[10px]">No data</span>
      </td>
    );
  }

  return (
    <td className="py-2.5 text-right">
      <span className="font-mono text-xs tabular-nums text-bone">
        {certified}/{goal}
      </span>
      <span className="mt-0.5 block text-[10px] tabular-nums text-granite">
        {goal > 0 ? `${formatPct(certified / goal)} of goal` : 'No goal'}
      </span>
    </td>
  );
}
