import { STAGE_META } from '../data/constants';
import type { Opportunity } from '../data/types';
import { formatDate, formatUsd } from '../lib/format';
import TableRegion from './TableRegion';

interface OpportunityTableProps {
  opportunities: Opportunity[];
  /** Shown when the fiscal-phase / motion filters empty the table. */
  emptyMessage?: string;
}

/** Salesforce-shaped opportunity rows for the selected partner and phase. */
export default function OpportunityTable({
  opportunities,
  emptyMessage = 'No opportunities in this phase.',
}: OpportunityTableProps) {
  return (
    <TableRegion label="Pipeline opportunities" className="max-h-[440px]">
      <table aria-label="Pipeline opportunities" className="w-full min-w-[720px] text-sm">
        <thead className="sticky top-0 bg-canvas">
          <tr className="border-b border-carbon">
            <th
              scope="col"
              className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
            >
              Client
            </th>
            <th
              scope="col"
              className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
            >
              Factory Account Director
            </th>
            <th
              scope="col"
              className="pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
            >
              Stage
            </th>
            <th
              scope="col"
              className="pb-2 pr-3 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
            >
              Forecasted revenue
            </th>
            <th
              scope="col"
              className="pb-2 text-right font-mono text-[10px] uppercase tracking-[0.06em] text-granite"
            >
              Close date
            </th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => (
            <tr key={opportunity.id} className="border-b border-carbon last:border-0">
              <td className="py-3 pr-3 text-bone">
                <p>{opportunity.accountName}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
                  {opportunity.oppType.replace('-', ' ')}
                </p>
              </td>
              <td className="py-3 pr-3 text-granite">{opportunity.factoryAccountDirector}</td>
              <td className="py-3 pr-3">
                {opportunity.outcome ? (
                  <span className={opportunity.outcome === 'won' ? 'text-metric' : 'text-granite'}>
                    {opportunity.outcome === 'won' ? 'Closed won' : 'Closed lost'}
                  </span>
                ) : (
                  <span className="text-stone">{STAGE_META[opportunity.stage].label}</span>
                )}
              </td>
              <td className="py-3 pr-3 text-right tabular-nums text-bone">
                {formatUsd(opportunity.forecastedRevenue)}
              </td>
              <td className="py-3 text-right font-mono text-xs tabular-nums text-granite">
                {/* Closed rows show the actual close date, matching Salesforce
                    Opportunity.CloseDate semantics; open rows show the
                    expected close. */}
                {formatDate(opportunity.closedAt ?? opportunity.expectedCloseDate)}
              </td>
            </tr>
          ))}
          {opportunities.length === 0 && (
            <tr>
              <td colSpan={5} className="py-8 text-center text-sm text-granite">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </TableRegion>
  );
}
