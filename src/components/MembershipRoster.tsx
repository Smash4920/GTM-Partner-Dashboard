import { TEAM_ROLE_META, TEAM_USER_STATUS_META } from '../data/constants';
import type { PartnerManager, TeamUser } from '../data/types';
import { formatDate } from '../lib/format';
import TableRegion from './TableRegion';

/**
 * Who is on the internal roster, split into administrators and users by
 * role. The grouping is a display of the identity provider's projection, not
 * a permission: nothing here grants or revokes sign-in or data access.
 */

interface MembershipRosterProps {
  users: TeamUser[];
  partnerManagers: PartnerManager[];
}

export default function MembershipRoster({ users, partnerManagers }: MembershipRosterProps) {
  const administrators = users.filter((user) => TEAM_ROLE_META[user.role].administrator);
  const members = users.filter((user) => !TEAM_ROLE_META[user.role].administrator);
  const managerName = (id?: string) =>
    partnerManagers.find((manager) => manager.id === id)?.name ?? '—';

  return (
    <div className="space-y-6">
      <p className="text-xs text-granite">
        {users.length} members · {administrators.length} administrators · {members.length} users
      </p>
      <RosterTable label="Administrators" users={administrators} managerName={managerName} />
      <RosterTable label="Users" users={members} managerName={managerName} />
    </div>
  );
}

function RosterTable({
  label,
  users,
  managerName,
}: {
  label: string;
  users: TeamUser[];
  managerName: (id?: string) => string;
}) {
  const th = 'pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite';
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.08em] text-stone">
        {label} · {users.length}
      </h3>
      <div className="mt-2">
        <TableRegion label={label}>
          <table aria-label={label} className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-carbon">
                <th scope="col" className={th}>
                  Member
                </th>
                <th scope="col" className={th}>
                  Role
                </th>
                <th scope="col" className={th}>
                  Aligned manager
                </th>
                <th scope="col" className={th}>
                  Added
                </th>
                <th scope="col" className={th}>
                  Notifications
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const status = TEAM_USER_STATUS_META[user.status];
                return (
                  <tr key={user.id} className="border-b border-carbon last:border-0">
                    <td className="py-2.5 pr-3">
                      <p className="text-bone">{user.name}</p>
                      <p className="font-mono text-[10px] text-granite">{user.email}</p>
                    </td>
                    <td className="py-2.5 pr-3 text-stone">{TEAM_ROLE_META[user.role].label}</td>
                    <td className="py-2.5 pr-3 text-granite">
                      {user.role === 'partner-manager' ? managerName(user.partnerManagerId) : '—'}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs tabular-nums text-granite">
                      {formatDate(user.addedAt)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-1.5 w-1.5 rounded-full ${status.dotClass}`} />
                        <span
                          className={`font-mono text-[10px] uppercase tracking-[0.06em] ${status.textClass}`}
                        >
                          {status.label}
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-sm text-granite">
                    No {label.toLowerCase()} on the roster.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableRegion>
      </div>
    </div>
  );
}
