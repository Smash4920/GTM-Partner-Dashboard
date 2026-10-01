import { useState } from 'react';
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
        <span
          className="shrink-0 font-mono text-[10px] uppercase tracking-[0.05em] text-signal"
          title={`Called ${categoryMeta.label} while the deal sits in ${STAGE_META[opportunity.stage].label}, which implies ${FORECAST_CATEGORY_META[impliedByStage].label}.`}
        >
          Off stage
        </span>
      )}
    </span>
  );
}

function OpportunityStage({ opportunity }: { opportunity: Opportunity }) {
  if (opportunity.outcome === undefined) {
    return <span className="text-stone">{STAGE_META[opportunity.stage].label}</span>;
  }

  return (
    <span className={opportunity.outcome === 'won' ? 'text-metric' : 'text-granite'}>
      {opportunity.outcome === 'won' ? 'Closed won' : 'Closed lost'}
    </span>
  );
}

/**
 * The Notes cell: an inline editor, or the pencil plus — when a note exists —
 * a disclosure that reveals the note on demand. The note itself never renders
 * in the row body by default, and the disclosure (not hover text) is what
 * makes it available to keyboard, touch, and screen readers.
 */
function NotesCell({
  opportunity,
  note,
  editing,
  disclosed,
  draft,
  onDraftChange,
  onCommit,
  onCancel,
  onStartEdit,
  onToggleDisclosure,
}: {
  opportunity: Opportunity;
  /** The effective note: session override when present, else the provider's. */
  note: string | undefined;
  editing: boolean;
  disclosed: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  onStartEdit: () => void;
  onToggleDisclosure: () => void;
}) {
  const disclosureId = `note-${opportunity.id}`;

  return (
    <td className="py-3 text-right">
      {editing ? (
        <span className="inline-flex items-center justify-end gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onCommit();
              if (event.key === 'Escape') onCancel();
            }}
            placeholder="Add a note…"
            aria-label={`Note for ${opportunity.accountName}`}
            className="w-44 rounded border border-ash bg-carbon px-2 py-1 text-sm text-bone placeholder:text-graphite focus:border-signal focus:outline-none"
          />
          <button
            type="button"
            onClick={onCommit}
            aria-label="Save note"
            className="rounded p-0.5 text-metric hover:bg-ash/30"
          >
            <CheckIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel note edit"
            className="rounded p-0.5 text-granite hover:bg-ash/30"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </span>
      ) : (
        <span className="inline-flex items-center justify-end gap-1.5">
          {note ? (
            <button
              type="button"
              onClick={onToggleDisclosure}
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
            onClick={onStartEdit}
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
}: ForecastTableProps) {
  const [editingRevenue, setEditingRevenue] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [editingNextStep, setEditingNextStep] = useState<string | null>(null);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [disclosedNote, setDisclosedNote] = useState<string | null>(null);
  const [revenueDraft, setRevenueDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [nextStepDraft, setNextStepDraft] = useState('');
  const [revenueError, setRevenueError] = useState<string | null>(null);

  const startRevenueEdit = (opportunityId: string) => {
    setEditingNotes(null);
    setEditingNextStep(null);
    setEditingCategory(null);
    setEditingRevenue(opportunityId);
    setRevenueError(null);
    setRevenueDraft(
      String(
        revenueOverrides[opportunityId] ??
          opportunities.find((opportunity) => opportunity.id === opportunityId)
            ?.forecastedRevenue ??
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
    setEditingNextStep(null);
    setEditingCategory(null);
    setRevenueError(null);
    setEditingNotes(opportunityId);
    // Initialize from the effective value — the session override when one
    // exists, else the provider's note. Opening blank would turn a blind
    // save into an accidental clear. `??`, not `||`: an explicit '' clear is
    // the draft to start from, not a reason to resurrect the provider value.
    setNoteDraft(
      notes[opportunityId] ??
        opportunities.find((opportunity) => opportunity.id === opportunityId)?.notes ??
        '',
    );
  };

  const commitNote = (opportunityId: string) => {
    onSetNote(opportunityId, noteDraft.trim());
    setEditingNotes(null);
  };

  const startNextStepEdit = (opportunityId: string) => {
    setEditingRevenue(null);
    setEditingNotes(null);
    setEditingCategory(null);
    setRevenueError(null);
    setEditingNextStep(opportunityId);
    // Same effective-value rule as the note editor: session override first,
    // then the provider's next step; a stored '' clear stays ''.
    setNextStepDraft(
      nextSteps[opportunityId] ??
        opportunities.find((opportunity) => opportunity.id === opportunityId)?.nextStep ??
        '',
    );
  };

  const commitNextStep = (opportunityId: string) => {
    onSetNextStep(opportunityId, nextStepDraft.trim());
    setEditingNextStep(null);
  };

  const cancelRevenueEdit = () => {
    setEditingRevenue(null);
    setRevenueError(null);
  };

  const startCategoryEdit = (opportunityId: string) => {
    setEditingRevenue(null);
    setEditingNotes(null);
    setEditingNextStep(null);
    setRevenueError(null);
    setEditingCategory(opportunityId);
  };

  // The dropdown commits on pick — a category is a single choice, so there is
  // nothing further to type. Escape or blur (clicking elsewhere) keeps the
  // current call.
  const commitCategory = (opportunityId: string, category: ForecastCategory) => {
    onSetForecastCall(opportunityId, category);
    setEditingCategory(null);
  };

  const cancelCategoryEdit = () => setEditingCategory(null);

  const th = 'pb-2 pr-3 text-left font-mono text-[10px] uppercase tracking-[0.06em] text-granite';

  return (
    <div
      className="max-h-[480px] overflow-auto rounded-card focus:outline-none focus-visible:ring-1 focus-visible:ring-ash"
      tabIndex={0}
      role="region"
      aria-label="In-quarter opportunities, scrollable"
    >
      <table className="w-full min-w-[1180px] text-sm">
        <thead className="sticky top-0 z-[1] bg-canvas">
          <tr className="border-b border-carbon">
            <th className={th}>Client</th>
            <th className={th}>Partner</th>
            <th className={`${th} text-right`}>Revenue forecast</th>
            <th className={th}>Opportunity type</th>
            <th className={th}>Stage</th>
            <th className={th}>Forecast category</th>
            <th className={`${th} text-right`}>Close date</th>
            <th className={th}>Next step</th>
            <th className={`${th} text-right`}>Notes</th>
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
                  <OpportunityStage opportunity={opportunity} />
                </td>
                <td className="py-3 pr-3">
                  <ForecastCategoryCell
                    opportunity={opportunity}
                    editing={editingCategory === opportunity.id}
                    onStartEdit={() => startCategoryEdit(opportunity.id)}
                    onCommit={(category) => commitCategory(opportunity.id, category)}
                    onCancel={cancelCategoryEdit}
                  />
                </td>
                <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums text-granite">
                  {formatDate(opportunity.closedAt ?? opportunity.expectedCloseDate)}
                </td>
                <td className="py-3 pr-3">
                  {editingNextStep === opportunity.id ? (
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={nextStepDraft}
                        onChange={(event) => setNextStepDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitNextStep(opportunity.id);
                          if (event.key === 'Escape') setEditingNextStep(null);
                        }}
                        placeholder="Next action…"
                        aria-label={`Next step for ${opportunity.accountName}`}
                        className="w-56 rounded border border-ash bg-carbon px-2 py-1 text-sm text-bone placeholder:text-graphite focus:border-signal focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => commitNextStep(opportunity.id)}
                        aria-label="Save next step"
                        className="rounded p-0.5 text-metric hover:bg-ash/30"
                      >
                        <CheckIcon className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNextStep(null)}
                        aria-label="Cancel next step edit"
                        className="rounded p-0.5 text-granite hover:bg-ash/30"
                      >
                        <XIcon className="h-3.5 w-3.5" />
                      </button>
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
                        onClick={() => startNextStepEdit(opportunity.id)}
                        className="rounded p-0.5 text-granite transition-colors hover:text-stone"
                        title={nextStep ? 'Edit next step' : 'Add a next step'}
                        aria-label={`${nextStep ? 'Edit' : 'Add'} next step for ${opportunity.accountName}`}
                      >
                        <PencilIcon className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  )}
                </td>
                <NotesCell
                  opportunity={opportunity}
                  note={note}
                  editing={editingNotes === opportunity.id}
                  disclosed={disclosedNote === opportunity.id}
                  draft={noteDraft}
                  onDraftChange={setNoteDraft}
                  onCommit={() => commitNote(opportunity.id)}
                  onCancel={() => setEditingNotes(null)}
                  onStartEdit={() => startNoteEdit(opportunity.id)}
                  onToggleDisclosure={() =>
                    setDisclosedNote((current) =>
                      current === opportunity.id ? null : opportunity.id,
                    )
                  }
                />
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
    </div>
  );
}
