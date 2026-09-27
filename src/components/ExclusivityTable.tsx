import { REGISTRATION_EXCLUSIVITY_DAYS, SNAPSHOT_DATE } from '../data/constants';
import type { DealRegistration, Partner } from '../data/types';
import { formatDate, formatUsd } from '../lib/format';
import { calendarDaysBetween, exclusivityLapsed } from '../lib/metrics';

interface ExclusivityTableProps {
  /** Approved registrations that never produced an opportunity. */
  registrations: DealRegistration[];
  partners: Partner[];
  /** The partner column is hidden in the partner portal, which is single-scope. */
  showPartner?: boolean;
  limit?: number;
}

/**
 * Approved registrations still without an opportunity. Each row shows the
 * days since approval against the 60-day exclusivity window; rows past the
 * window are flagged "Exclusivity lapsed". Oldest decision first, so the
 * lapsed rows stack on top.
 */
export default function ExclusivityTable({
  registrations,
  partners,
  showPartner = true,
  limit = 8,
}: ExclusivityTableProps) {
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const rows = [...registrations]
    .sort(
      (a, b) =>
        new Date(a.decisionAt ?? a.submittedAt).getTime() -
        new Date(b.decisionAt ?? b.submittedAt).getTime(),
    )
    .slice(0, limit);

  const th = 'pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite';

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-carbon">
          <th className={`${th} text-left`}>Account</th>
          {showPartner && <th className={`${th} text-left`}>Partner</th>}
          <th className={`${th} text-right`}>Amount</th>
          <th className={`${th} text-right`}>Approved</th>
          <th className={`${th} text-right`}>Days since approval</th>
          <th className={`${th} text-right`}>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((reg) => {
          const reference = reg.decisionAt ?? reg.submittedAt;
          const daysSince = calendarDaysBetween(reference, SNAPSHOT_DATE.toISOString());
          const lapsed = exclusivityLapsed(reg);
          return (
            <tr key={reg.id} className="border-b border-carbon last:border-0">
              <td className="py-2.5 pr-3 text-bone">{reg.accountName}</td>
              {showPartner && (
                <td className="py-2.5 pr-3 text-granite">
                  {partnerById.get(reg.partnerId)?.name ?? reg.partnerId}
                </td>
              )}
              <td className="py-2.5 pr-3 text-right tabular-nums text-bone">
                {formatUsd(reg.amount)}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-xs tabular-nums text-granite">
                {reg.decisionAt ? formatDate(reg.decisionAt) : '—'}
              </td>
              <td className="py-2.5 pr-3 text-right font-mono text-xs tabular-nums text-granite">
                {daysSince}d
              </td>
              <td className="py-2.5 text-right">
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.06em] ${
                    lapsed ? 'text-signal' : 'text-granite'
                  }`}
                  title={`${REGISTRATION_EXCLUSIVITY_DAYS}-day exclusivity window from approval — the partner must introduce the lead within it`}
                >
                  {lapsed ? 'Exclusivity lapsed' : 'In window'}
                </span>
              </td>
            </tr>
          );
        })}
        {rows.length === 0 && (
          <tr>
            <td colSpan={showPartner ? 6 : 5} className="py-6 text-center text-sm text-granite">
              No approved registrations without an opportunity — nothing leaking.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
