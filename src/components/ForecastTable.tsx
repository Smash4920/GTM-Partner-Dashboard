import { useState } from 'react';
import { OPP_TYPE_META, STAGE_META } from '../data/constants';
import type { Opportunity, Partner } from '../data/types';
import { formatDate, formatUsd } from '../lib/format';
import { CheckIcon, CommentIcon, PencilIcon, XIcon } from './icons';

interface ForecastTableProps {
  opportunities: Opportunity[];
  partners: Partner[];
  /** Edited revenue per opportunity id, overriding the Salesforce figure. */
  revenueOverrides: Record<string, number>;
  /** Free-form partner-manager notes per opportunity id. */
  notes: Record<string, string>;
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
  emptyMessage?: string;
}

/**
 * In-quarter opportunity table for the VP of Partnerships. Revenue and Notes
 * carry a pencil so partner managers can edit the forecast locally; notes are
 * stored as comments and surface on hover, not inline.
 */
export default function ForecastTable({
  opportunities,
  partners,
  revenueOverrides,
  notes,
  onSetRevenue,
  onSetNote,
  emptyMessage = 'No in-quarter opportunities for this partner manager.',
}: ForecastTableProps) {
  const [editingRevenue, setEditingRevenue] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [revenueDraft, setRevenueDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [revenueError, setRevenueError] = useState<string | null>(null);

  const partnerById = new Map(partners.map((partner) => [partner.id, partner]));

  const startRevenueEdit = (opportunityId: string) => {
    setEditingNotes(null);
    setEditingRevenue(opportunityId);
    setRevenueError(null);
    setRevenueDraft(
      String(
        revenueOverrides[opportunityId] ??
          opportunities.find((opportunity) => opportunity.id === opportunityId)?.forecastedRevenue ??
          '',
      ),
    );
  };

  const commitRevenue = (opportunityId: string) => {
    const value = Number(revenueDraft);
    if (revenueDraft.trim() === '' || !Number.isFinite(value) || value < 0) {
      setRevenueError('Enter a non-negative number.');
      return;
    }
    onSetRevenue(opportunityId, value);
    setEditingRevenue(null);
    setRevenueError(null);
  };

  const startNoteEdit = (opportunityId: string) => {
    setEditingRevenue(null);
    setRevenueError(null);
    setEditingNotes(opportunityId);
    setNoteDraft(notes[opportunityId] ?? '');
  };

  const commitNote = (opportunityId: string) => {
    onSetNote(opportunityId, noteDraft.trim());
    setEditingNotes(null);
  };

  const cancelRevenueEdit = () => {
    setEditingRevenue(null);
    setRevenueError(null);
  };

  const th = 'pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite';

  return (
    <div
      className="max-h-[480px] overflow-auto rounded-card focus:outline-none focus-visible:ring-1 focus-visible:ring-ash"
      tabIndex={0}
      role="region"
      aria-label="In-quarter opportunities, scrollable"
    >
      <table className="w-full min-w-[900px] text-sm">
        <thead className="sticky top-0 z-[1] bg-canvas">
          <tr className="border-b border-carbon">
            <th className={th}>Client</th>
            <th className={th}>Partner</th>
            <th className={`${th} text-right`}>Revenue forecast</th>
            <th className={th}>Opportunity type</th>
            <th className={th}>Stage</th>
            <th className={`${th} text-right`}>Close date</th>
            <th className={`${th} text-right`}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => {
            const revenue = revenueOverrides[opportunity.id] ?? opportunity.forecastedRevenue;
            const edited = revenueOverrides[opportunity.id] !== undefined;
            const note = notes[opportunity.id] ?? opportunity.notes;

            return (
              <tr key={opportunity.id} className="border-b border-carbon last:border-0">
                <td className="py-3 pr-3">
                  <p className="text-bone">{opportunity.accountName}</p>
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
                    AD {opportunity.factoryAccountDirector}
                  </p>
                </td>
                <td className="py-3 pr-3 text-granite">
                  {partnerById.get(opportunity.partnerId)?.name ?? opportunity.partnerId}
                </td>
                <td className="py-3 pr-3 text-right">
                  {editingRevenue === opportunity.id ? (
                    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <input
                        autoFocus
                        value={revenueDraft}
                        onChange={(event) => {
                          setRevenueDraft(event.target.value);
                          setRevenueError(null);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitRevenue(opportunity.id);
                          if (event.key === 'Escape') cancelRevenueEdit();
                        }}
                        aria-label={`Revenue forecast for ${opportunity.accountName}`}
                        aria-invalid={revenueError ? true : undefined}
                        inputMode="decimal"
                        className="w-28 rounded border border-ash bg-carbon px-2 py-1 text-right text-sm tabular-nums text-bone focus:border-signal focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => commitRevenue(opportunity.id)}
                        aria-label="Save revenue"
                        className="rounded p-0.5 text-metric hover:bg-ash/30"
                      >
                        <CheckIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelRevenueEdit}
                        aria-label="Cancel revenue edit"
                        className="rounded p-0.5 text-granite hover:bg-ash/30"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                      {revenueError && (
                        <span className="w-full text-right text-xs text-signal" role="alert">
                          {revenueError}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <span
                        className={`tabular-nums ${edited ? 'text-signal' : 'text-bone'}`}
                        title={edited ? 'Edited — differs from Salesforce forecast' : undefined}
                      >
                        {formatUsd(revenue)}
                      </span>
                      <button
                        type="button"
                        onClick={() => startRevenueEdit(opportunity.id)}
                        className="rounded p-0.5 text-granite transition-colors hover:text-stone"
                        title="Edit revenue forecast"
                        aria-label={`Edit revenue forecast for ${opportunity.accountName}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </td>
                <td className="py-3 pr-3 font-mono text-[11px] uppercase tracking-[0.05em] text-stone">
                  {OPP_TYPE_META[opportunity.oppType].label}
                </td>
                <td className="py-3 pr-3">
                  {opportunity.outcome ? (
                    <span className={opportunity.outcome === 'won' ? 'text-metric' : 'text-granite'}>
                      {opportunity.outcome === 'won' ? 'Closed won' : 'Closed lost'}
                    </span>
                  ) : (
                    <span className="text-stone">{STAGE_META[opportunity.stage].label}</span>
                  )}
                </td>
                <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums text-granite">
                  {formatDate(opportunity.closedAt ?? opportunity.expectedCloseDate)}
                </td>
                <td className="py-3 text-right">
                  {editingNotes === opportunity.id ? (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      <input
                        autoFocus
                        value={noteDraft}
                        onChange={(event) => setNoteDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitNote(opportunity.id);
                          if (event.key === 'Escape') setEditingNotes(null);
                        }}
                        placeholder="Add a note…"
                        aria-label={`Note for ${opportunity.accountName}`}
                        className="w-44 rounded border border-ash bg-carbon px-2 py-1 text-sm text-bone placeholder:text-graphite focus:border-signal focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => commitNote(opportunity.id)}
                        aria-label="Save note"
                        className="rounded p-0.5 text-metric hover:bg-ash/30"
                      >
                        <CheckIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNotes(null)}
                        aria-label="Cancel note edit"
                        className="rounded p-0.5 text-granite hover:bg-ash/30"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ) : (
                    <span className="inline-flex items-center justify-end gap-1.5">
                      {note ? (
                        <span
                          className="flex items-center gap-1 text-granite"
                          title={note}
                        >
                          <CommentIcon className="h-3.5 w-3.5 text-signal" />
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-graphite">
                          —
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => startNoteEdit(opportunity.id)}
                        className="rounded p-0.5 text-granite transition-colors hover:text-stone"
                        title={note ? `Note: ${note}` : 'Add a note'}
                        aria-label={`${note ? 'Edit' : 'Add'} note for ${opportunity.accountName}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
          {opportunities.length === 0 && (
            <tr>
              <td colSpan={7} className="py-8 text-center text-sm text-granite">
                {emptyMessage}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
