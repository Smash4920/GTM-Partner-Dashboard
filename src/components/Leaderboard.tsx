import { PARTNER_TIER_META, PARTNER_TYPE_META, REGION_META } from '../data/constants';
import { formatPct, formatUsd } from '../lib/format';
import type { LeaderboardRow } from '../lib/metrics';
import Badge from './Badge';

interface LeaderboardProps {
  rows: LeaderboardRow[];
  limit?: number;
  /** Closed-won column header; callers pass the selected fiscal phase. */
  closedWonLabel?: string;
}

export default function Leaderboard({
  rows,
  limit = 10,
  closedWonLabel = 'Closed-won',
}: LeaderboardProps) {
  const top = rows.slice(0, limit);
  const th =
    'pb-2 font-mono text-[10px] uppercase tracking-[0.06em] text-granite';
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-carbon">
          <th className={`${th} pr-3 text-left`}>#</th>
          <th className={`${th} pr-3 text-left`}>Partner</th>
          <th className={`${th} pr-3 text-right`}>Open pipeline</th>
          <th className={`${th} pr-3 text-right`}>{closedWonLabel}</th>
          <th className={`${th} text-right`}>Win rate</th>
        </tr>
      </thead>
      <tbody>
        {top.map((row, index) => (
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}
