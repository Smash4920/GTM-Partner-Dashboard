import type { DealRegistration, Partner } from '../data/types';
import { formatDate, formatUsd } from '../lib/format';
import { businessDaysWaiting, registrationSlaState } from '../lib/metrics';
import { StatusBadge } from './Badge';
import type { WorkflowActions } from '../data/workflows';

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

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className={`border-b ${rowBorder}`}>
          <th className={`${th} pr-3 text-left`}>Account</th>
          {showPartner && <th className={`${th} pr-3 text-left`}>Partner</th>}
          <th className={`${th} pr-3 text-right`}>Amount</th>
          <th className={`${th} pr-3 text-right`}>Submitted</th>
          <th className={`${th} pr-3 text-right`}>{isQueue ? 'Waiting (biz days)' : 'Decision'}</th>
          <th className={`${th} text-right`}>Status</th>
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
              <td className={`py-2.5 pr-3 text-right font-mono text-xs tabular-nums ${mutedClass}`}>
                {formatDate(reg.submittedAt)}
              </td>
              <td
                className={`py-2.5 pr-3 text-right font-mono text-xs tabular-nums ${
                  isQueue ? waitingClass : mutedClass
                }`}
                title={
                  isQueue
                    ? `${businessDaysWaiting(reg)} business days waiting · ${
                        slaState === 'within-sla' ? 'within' : 'past'
                      } the 5-business-day SLA`
                    : undefined
                }
              >
                {isQueue ? `${waiting}d` : reg.decisionAt ? formatDate(reg.decisionAt) : '—'}
              </td>
              <td className="py-2.5 text-right">
                <StatusBadge status={reg.status} tone={tone} />
                {reg.status === 'pending' && onWorkflow && (
                  <button
                    type="button"
                    className="mt-2 rounded border border-ash px-3 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-bone"
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
  );
}
