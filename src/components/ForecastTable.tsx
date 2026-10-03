import { useEffect, useId, useRef, useState } from 'react';
import {
  FORECAST_CATEGORIES,
  FORECAST_CATEGORY_FOR_STAGE,
  FORECAST_CATEGORY_META,
  OPP_TYPE_META,
  STAGE_META,
} from '../data/constants';
import type { ForecastCategory, Opportunity } from '../data/types';
import { formatDate, formatUsd } from '../lib/format';
import { forecastCategoryOf } from '../lib/metrics';
import { CheckIcon, CommentIcon, PencilIcon, XIcon } from './icons';
import TableRegion from './TableRegion';

interface ForecastTableProps {
  opportunities: Opportunity[];
  /**
   * Partner id to name. A lookup rather than the partner collection, because
   * the table needs one field of it and the collection is the whole partner
   * book — the thing the scoped contract exists to stop shipping.
   */
  partnerNames: Record<string, string>;
  /** Edited revenue per opportunity id, overriding the Salesforce figure. */
  revenueOverrides: Record<string, number>;
  /** Free-form partner-manager notes per opportunity id. */
  notes: Record<string, string>;
  /** Row-level next action per opportunity id, editable inline. */
  nextSteps: Record<string, string>;
  onSetRevenue: (opportunityId: string, value: number) => void;
  onSetNote: (opportunityId: string, note: string) => void;
  onSetNextStep: (opportunityId: string, nextStep: string) => void;
  onSetForecastCall: (opportunityId: string, category: ForecastCategory) => void;
  emptyMessage?: string;
  tableLabel?: string;
}

/** Commit first: managers read their book from most to least confident. */
const CATEGORY_OPTIONS = [...FORECAST_CATEGORIES].sort(
  (a, b) => FORECAST_CATEGORY_META[b].weight - FORECAST_CATEGORY_META[a].weight,
);

function ForecastCategoryCell({
  opportunity,
  editing,
  onStartEdit,
  onCommit,
  onCancel,
}: {
  opportunity: Opportunity;
  editing: boolean;
  onStartEdit: () => void;
  onCommit: (category: ForecastCategory) => void;
  onCancel: () => void;
}) {
  const called = forecastCategoryOf(opportunity);
  const categoryMeta = FORECAST_CATEGORY_META[called];

  if (opportunity.outcome !== undefined) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-graphite">—</span>
    );
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: categoryMeta.color }}
        />
        <select
          autoFocus
          value={called}
          onChange={(event) => onCommit(event.target.value as ForecastCategory)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onCancel();
          }}
          onBlur={onCancel}
          aria-label={`Forecast category for ${opportunity.accountName}`}
          className="cursor-pointer rounded border border-ash bg-carbon px-1.5 py-1 text-sm text-bone focus:border-signal focus:outline-none"
        >
          {CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category} className="bg-carbon text-bone">
              {`${FORECAST_CATEGORY_META[category].label} (${Math.round(
                FORECAST_CATEGORY_META[category].weight * 100,
              )}%)`}
            </option>
          ))}
        </select>
      </span>
    );
  }

  const impliedByStage = FORECAST_CATEGORY_FOR_STAGE[opportunity.stage];
  const offStage = called !== impliedByStage;

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: categoryMeta.color }}
      />
      <span className="text-stone">{categoryMeta.label}</span>
      <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
        {Math.round(categoryMeta.weight * 100)}%
      </span>
      <button
        type="button"
        onClick={onStartEdit}
        className="rounded p-0.5 text-granite transition-colors hover:text-stone"
        title="Edit forecast category"
        aria-label={`Edit forecast category for ${opportunity.accountName}`}
      >
        <PencilIcon className="h-3.5 w-3.5" />
      </button>
      {offStage && (
        <details className="text-xs text-signal">
          <summary
            aria-label={`Off stage explanation for ${opportunity.accountName}`}
            className="cursor-pointer"
          >
            Off stage
          </summary>
          <p className="max-w-64 whitespace-normal">
            Called {categoryMeta.label} while the deal sits in {STAGE_META[opportunity.stage].label}
            , which implies {FORECAST_CATEGORY_META[impliedByStage].label}.
          </p>
        </details>
      )}
    </span>
  );
}

function renderStage(opportunity: Opportunity) {
  return (
    <span
      className={
        opportunity.outcome === undefined
          ? 'text-stone'
          : opportunity.outcome === 'won'
            ? 'text-metric'
            : 'text-granite'
      }
    >
      {opportunity.outcome === undefined
        ? STAGE_META[opportunity.stage].label
        : opportunity.outcome === 'won'
          ? 'Closed won'
          : 'Closed lost'}
    </span>
  );
}

/**
 * In-quarter opportunity table for the VP of Partnerships. Revenue and Notes
 * carry a pencil so partner managers can edit the forecast locally; a note
 * never renders in the row body — the comment button is a disclosure that
 * reveals it on demand for pointer, keyboard, and touch alike. Next Step
 * renders inline and is editable per row — the row-level answer to "what
 * happens next" that the forecast call-outs and roadmap alerts build on.
 *
 * Every editor opens with the effective value — the session override when one
 * exists, else the provider's — so reading a field and saving it unchanged is
 * a no-op rather than an accidental clear. Escape and the cancel button
 * abandon the draft without a callback; saving an emptied field is an
 * explicit clear (an '' tombstone) that keeps the provider value hidden.
 *
 * Forecast category is a manager judgment, not a stage echo: it renders as a
 * static call until its pencil is clicked, which swaps in a dropdown of the
 * four probability buckets (Commit 90%, Best Case 50%, Pipeline 25%, Long
 * Shot 10%). Choosing one re-calls the deal and the weighted forecast moves
 * with it. Rows where the call disagrees with the stage are marked "off
 * stage": those are the forecast conversations. Closed rows carry no pencil —
 * the call stops mattering once the deal resolves.
 */
export default function ForecastTable({
  opportunities,
  partnerNames,
  revenueOverrides,
  notes,
  nextSteps,
  onSetRevenue,
  onSetNote,
  onSetNextStep,
  onSetForecastCall,
  emptyMessage = 'No in-quarter opportunities for this partner manager.',
  tableLabel = 'In-quarter opportunities',
}: ForecastTableProps) {
  const [editor, setEditor] = useState<Partial<
    Record<'revenue' | 'note' | 'nextStep' | 'category', string>
  > | null>(null);
  const [disclosedNote, setDisclosedNote] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const revenueErrorId = useId();
  const revenueInput = useRef<HTMLInputElement>(null);
  const invoker = useRef<Element | null>(null);
  useEffect(() => {
    if (editor) return;
    const saved = invoker.current;
    invoker.current = null;
    if (
      !saved ||
      !(document.activeElement === document.body || saved.contains(document.activeElement))
    )
      return;
    // The editor invoker is the final button in each editable cell, including
    // notes where a disclosure precedes it. Its label may change Add → Edit.
    Array.from(saved.querySelectorAll('button')).at(-1)?.focus();
  }, [editor]);

  const startEdit = (
    opportunityId: string,
    field: keyof NonNullable<typeof editor>,
    value: string | number = '',
  ) => {
    setEditor({ [field]: opportunityId });
    setRevenueError(null);
    // The row supplies its effective value, including explicit '' tombstones.
    setDraft(String(value));
  };

  const commitRevenue = (opportunityId: string) => {
    const value = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(value) || value < 0) {
      setRevenueError('Enter a non-negative number.');
      revenueInput.current?.focus();
      return;
    }
    onSetRevenue(opportunityId, value);
    setEditor(null);
    setRevenueError(null);
  };

  const cancelEdit = () => {
    setEditor(null);
    setRevenueError(null);
  };

  const renderEditor = (opportunity: Opportunity, field: 'revenue' | 'note' | 'next step') => {
    const revenue = field === 'revenue';
    const note = field === 'note';
    const error = revenue ? revenueError : null;
    const commit = () => {
      if (revenue) commitRevenue(opportunity.id);
      else {
        (note ? onSetNote : onSetNextStep)(opportunity.id, draft.trim());
        setEditor(null);
      }
    };
    return (
      <>
        <input
          ref={revenue ? revenueInput : undefined}
          autoFocus
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setRevenueError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') cancelEdit();
          }}
          aria-label={`${revenue ? 'Revenue forecast' : note ? 'Note' : 'Next step'} for ${opportunity.accountName}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? revenueErrorId : undefined}
          inputMode={revenue ? 'decimal' : undefined}
          placeholder={note ? 'Add a note…' : field === 'next step' ? 'Next action…' : undefined}
          className={`rounded border border-ash bg-carbon px-2 py-1 text-sm text-bone placeholder:text-graphite focus:border-signal focus:outline-none ${
            revenue ? 'w-28 text-right tabular-nums' : note ? 'w-44' : 'w-56'
          }`}
        />
        <button
          type="button"
          onClick={commit}
          aria-label={`Save ${field}`}
          className="rounded p-0.5 text-metric hover:bg-ash/30"
        >
          <CheckIcon className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          aria-label={`Cancel ${field} edit`}
          className="rounded p-0.5 text-granite hover:bg-ash/30"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
        {error && (
          <span id={revenueErrorId} className="w-full text-right text-xs text-signal" role="alert">
            {error}
          </span>
        )}
      </>
    );
  };

  /** Disclosure remains independent of the mutually exclusive editor. */
  const renderNotes = (opportunity: Opportunity, note: string | undefined) => {
    const disclosed = disclosedNote === opportunity.id;
    const disclosureId = `note-${opportunity.id}`;
    return (
      <td className="py-3 text-right">
        {editor?.note === opportunity.id ? (
          <span className="inline-flex items-center justify-end gap-1.5">
            {renderEditor(opportunity, 'note')}
          </span>
        ) : (
          <span className="inline-flex items-center justify-end gap-1.5">
            {note ? (
              <button
                type="button"
                onClick={() =>
                  setDisclosedNote((current) =>
                    current === opportunity.id ? null : opportunity.id,
                  )
                }
                aria-expanded={disclosed}
                aria-controls={disclosureId}
                aria-label={`${disclosed ? 'Hide' : 'View'} note for ${opportunity.accountName}`}
                className="rounded p-0.5 text-signal transition-colors hover:bg-ash/30"
              >
                <CommentIcon className="h-3.5 w-3.5" />
              </button>
            ) : (
              <span className="font-mono text-[10px] uppercase tracking-[0.05em] text-graphite">
                —
              </span>
            )}
            <button
              type="button"
              onClick={() => startEdit(opportunity.id, 'note', note)}
              className="rounded p-0.5 text-granite transition-colors hover:text-stone"
              title={note ? 'Edit note' : 'Add a note'}
              aria-label={`${note ? 'Edit' : 'Add'} note for ${opportunity.accountName}`}
            >
              <PencilIcon className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
        {disclosed && note && (
          <p
            id={disclosureId}
            className="mt-1 max-w-[16rem] text-left text-xs leading-snug text-stone"
          >
            {note}
          </p>
        )}
      </td>
    );
  };

  // The dropdown commits on pick — a category is a single choice, so there is
  // nothing further to type. Escape or blur (clicking elsewhere) keeps the
  // current call.
  const commitCategory = (opportunityId: string, category: ForecastCategory) => {
    onSetForecastCall(opportunityId, category);
    setEditor(null);
  };

  const th = 'pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite';

  return (
    <div
      onKeyDownCapture={(event) => {
        if (event.key === 'Enter' && (event.target as Element).tagName === 'INPUT') {
          event.preventDefault();
        }
      }}
      onClickCapture={(event) => {
        if (editor) return;
        const button = (event.target as Element).closest('button');
        const cell = button?.closest('td');
        if (cell) invoker.current = cell;
      }}
    >
      <TableRegion label={tableLabel} className="max-h-[480px]">
        <table aria-label={tableLabel} className="w-full min-w-[1180px] text-sm">
          <thead className="sticky top-0 z-[1] bg-canvas">
            <tr className="border-b border-carbon">
              <th scope="col" className={th}>
                Client
              </th>
              <th scope="col" className={th}>
                Partner
              </th>
              <th scope="col" className={`${th} text-right`}>
                Revenue forecast
              </th>
              <th scope="col" className={th}>
                Opportunity type
              </th>
              <th scope="col" className={th}>
                Stage
              </th>
              <th scope="col" className={th}>
                Forecast category
              </th>
              <th scope="col" className={`${th} text-right`}>
                Close date
              </th>
              <th scope="col" className={th}>
                Next step
              </th>
              <th scope="col" className={`${th} text-right`}>
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {opportunities.map((opportunity) => {
              const revenue = revenueOverrides[opportunity.id] ?? opportunity.forecastedRevenue;
              const edited = revenueOverrides[opportunity.id] !== undefined;
              const note = notes[opportunity.id] ?? opportunity.notes;
              const nextStep = nextSteps[opportunity.id] ?? opportunity.nextStep;

              return (
                <tr
                  key={opportunity.id}
                  data-opportunity-id={opportunity.id}
                  className="border-b border-carbon last:border-0"
                >
                  <td className="py-3 pr-3">
                    <p className="text-bone">{opportunity.accountName}</p>
                    <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.05em] text-granite">
                      AD {opportunity.factoryAccountDirector}
                    </p>
                  </td>
                  <td className="py-3 pr-3 text-granite">
                    {partnerNames[opportunity.partnerId] ?? opportunity.partnerId}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    {editor?.revenue === opportunity.id ? (
                      <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        {renderEditor(opportunity, 'revenue')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center justify-end gap-1.5">
                        <span className={`tabular-nums ${edited ? 'text-signal' : 'text-bone'}`}>
                          <span>{formatUsd(revenue)}</span>
                          {edited && (
                            <span className="block text-xs">
                              Edited — differs from Salesforce forecast
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEdit(opportunity.id, 'revenue', revenue)}
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
                  <td className="py-3 pr-3">{renderStage(opportunity)}</td>
                  <td className="py-3 pr-3">
                    <ForecastCategoryCell
                      opportunity={opportunity}
                      editing={editor?.category === opportunity.id}
                      onStartEdit={() => startEdit(opportunity.id, 'category')}
                      onCommit={(category) => commitCategory(opportunity.id, category)}
                      onCancel={cancelEdit}
                    />
                  </td>
                  <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums text-granite">
                    {formatDate(opportunity.closedAt ?? opportunity.expectedCloseDate)}
                  </td>
                  <td className="py-3 pr-3">
                    {editor?.nextStep === opportunity.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        {renderEditor(opportunity, 'next step')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className={
                            nextStep
                              ? 'text-stone'
                              : 'font-mono text-[10px] uppercase tracking-[0.05em] text-graphite'
                          }
                        >
                          {/* `||`, not `??`: a cleared next step is '' and still reads as "none". */}
                          {nextStep || '—'}
                        </span>
                        <button
                          type="button"
                          onClick={() => startEdit(opportunity.id, 'nextStep', nextStep)}
                          className="rounded p-0.5 text-granite transition-colors hover:text-stone"
                          title={nextStep ? 'Edit next step' : 'Add a next step'}
                          aria-label={`${nextStep ? 'Edit' : 'Add'} next step for ${opportunity.accountName}`}
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    )}
                  </td>
                  {renderNotes(opportunity, note)}
                </tr>
              );
            })}
            {opportunities.length === 0 && (
              <tr>
                <td colSpan={9} className="py-8 text-center text-sm text-granite">
                  {emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableRegion>
    </div>
  );
}
