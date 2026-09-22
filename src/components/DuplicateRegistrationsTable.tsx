import type { Partner } from '../data/types';
import { formatDate } from '../lib/format';
import type { DuplicateRegistrationGroup } from '../lib/metrics';

interface DuplicateRegistrationsTableProps {
  groups: DuplicateRegistrationGroup[];
  partners: Partner[];
  limit?: number;
}

/**
 * Internal-only view of conflicting deal registrations: one client registered
 * by multiple partners. Submission dates are shown for every contender so the
 * first partner to submit (the exclusivity holder) is visible at a glance.
 * Never rendered in the partner portal.
 */
export default function DuplicateRegistrationsTable({
  groups,
  partners,
  limit = 6,
}: DuplicateRegistrationsTableProps) {
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const rows = groups.slice(0, limit);

  const th = 'pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite';
  const firstId = (group: DuplicateRegistrationGroup) => group.firstSubmitted.id;

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-carbon">
          <th className={`${th} text-left`}>Client</th>
          <th className={`${th} text-left`}>Partner</th>
          <th className={`${th} text-left`}>Submitted</th>
          <th className={`${th} text-right`}>Claim</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((group) =>
          group.registrations.map((reg, index) => (
            <tr key={reg.id} className="border-b border-carbon last:border-0">
              {index === 0 && (
                <td
                  className="py-2.5 pr-3 align-top text-bone"
                  rowSpan={group.registrations.length}
                >
                  {group.accountName}
                </td>
              )}
              <td className="py-2.5 pr-3 align-top text-granite">
                {partnerById.get(reg.partnerId)?.name ?? reg.partnerId}
              </td>
              <td className="py-2.5 pr-3 align-top font-mono text-xs tabular-nums text-granite">
                {formatDate(reg.submittedAt)}
              </td>
              <td className="py-2.5 align-top text-right">
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.06em] ${
                    reg.id === firstId(group) ? 'text-metric' : 'text-signal'
                  }`}
                >
                  {reg.id === firstId(group) ? 'First to submit' : 'Conflict — track closely'}
                </span>
              </td>
            </tr>
          )),
        )}
        {rows.length === 0 && (
          <tr>
            <td colSpan={4} className="py-6 text-center text-sm text-granite">
              No conflicting registrations in this scope.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
