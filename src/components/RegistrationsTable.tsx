import type { DealRegistration, Partner } from '../data/types';
import { formatDate, formatUsd } from '../lib/format';
import { businessDaysWaiting, registrationSlaState } from '../lib/metrics';
import { StatusBadge } from './Badge';
import type { WorkflowActions } from '../data/workflows';
import { REGISTRATION_SLA_BUSINESS_DAYS } from '../data/constants';
import TableRegion from './TableRegion';

interface RegistrationsTableProps extends WorkflowActions {
  registrations: DealRegistration[];
  partners: Partner[];
  variant: 'queue' | 'history';
  tone?: 'dark' | 'light';
  limit?: number;
  showPartner?: boolean;
}

/** Deal registration rows. `queue` = pending, oldest first; `history` = newest first. */
export default function RegistrationsTable({
  registrations,
  partners,
  variant,
  tone = 'dark',
  limit = 8,
  showPartner = true,
  onWorkflow,
}: RegistrationsTableProps) {
  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));
  const isQueue = variant === 'queue';
  const isLight = tone === 'light';

  const rows = [...registrations]
    .sort((a, b) =>
      isQueue
        ? new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
        : new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
    )
    .slice(0, limit);

  const th = `pb-2 font-mono text-[10px] uppercase tracking-[0.06em] ${
    isLight ? 'text-graphite' : 'text-granite'
  }`;
  const rowBorder = isLight ? 'border-ash/30' : 'border-carbon';
  const accountClass = isLight ? 'text-canvas' : 'text-bone';
  const mutedClass = isLight ? 'text-granite' : 'text-granite';
  const label = isQueue ? 'Registrations awaiting review' : 'Deal registrations';

  return (
    <TableRegion label={label}>
      <table aria-label={label} className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className={`border-b ${rowBorder}`}>
            <th scope="col" className={`${th} pr-3 text-left`}>
              Account
            </th>
            {showPartner && (
              <th scope="col" className={`${th} pr-3 text-left`}>
                Partner
              </th>
            )}
            <th scope="col" className={`${th} pr-3 text-right`}>
              Amount
            </th>
            <th scope="col" className={`${th} pr-3 text-right`}>
              Submitted
            </th>
            <th scope="col" className={`${th} pr-3 text-right`}>
              {isQueue ? 'Waiting (biz days)' : 'Decision'}
            </th>
            <th scope="col" className={`${th} text-right`}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((reg) => {
            // The counter and the color must speak the same unit. The SLA is 5
            // business days, so the number shown is business days too: a
            // calendar count would read "6d" green on a Saturday submission that
            // has only used 4 working days, which looks like the SLA was missed.
            const waiting = businessDaysWaiting(reg);
            const slaState = registrationSlaState(reg);
            const waitingClass = isQueue
              ? slaState === 'within-sla'
                ? 'text-metric'
                : 'text-signal'
              : mutedClass;
            return (
              <tr key={reg.id} className={`border-b ${rowBorder} last:border-0`}>
                <td className="py-2.5 pr-3">
                  <p className={accountClass}>{reg.accountName}</p>
                  {variant === 'history' && reg.reason && (
                    <p
                      className={`mt-0.5 font-mono text-[10px] uppercase tracking-[0.06em] ${mutedClass}`}
                    >
                      {reg.reason}
                    </p>
                  )}
                </td>
                {showPartner && (
                  <td className={`py-2.5 pr-3 ${mutedClass}`}>
                    {partnerById.get(reg.partnerId)?.name ?? reg.partnerId}
                  </td>
                )}
                <td className={`py-2.5 pr-3 text-right tabular-nums ${accountClass}`}>
                  {formatUsd(reg.amount)}
                </td>
                <td
                  className={`py-2.5 pr-3 text-right font-mono text-xs tabular-nums ${mutedClass}`}
                >
                  {formatDate(reg.submittedAt)}
                </td>
                <td
                  className={`py-2.5 pr-3 text-right font-mono text-xs tabular-nums ${
                    isQueue ? waitingClass : mutedClass
                  }`}
                >
                  {isQueue ? (
                    <>
                      <span className="block">{waiting} business days waiting</span>
                      <span className={`mt-0.5 block text-[10px] ${mutedClass}`}>
                        {slaState === 'within-sla' ? 'Within' : 'Past'} the{' '}
                        {REGISTRATION_SLA_BUSINESS_DAYS}-business-day SLA
                      </span>
                    </>
                  ) : reg.decisionAt ? (
                    formatDate(reg.decisionAt)
                  ) : (
                    '—'
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <StatusBadge status={reg.status} tone={tone} />
                  {reg.status === 'pending' && onWorkflow && (
                    <button
                      type="button"
                      className="mt-2 min-h-6 min-w-6 rounded border border-ash px-3 py-2 text-xs"
                      aria-label={`Decide ${reg.id}`}
                      onClick={() => onWorkflow({ kind: 'registration', entityIds: [reg.id] })}
                    >
                      Decide
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={showPartner ? 6 : 5} className="py-6 text-center text-sm text-granite">
                Nothing here — the queue is clear.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </TableRegion>
  );
}
