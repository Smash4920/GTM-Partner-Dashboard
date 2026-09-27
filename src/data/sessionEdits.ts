import type { ForecastCategory, Opportunity } from './types';

/**
 * The edits a session holds on top of the provider's book.
 *
 * Every map is keyed by opportunity id. A key that is present but empty is a
 * deliberate clear, not an absent edit — see `applySessionEdits`.
 */
export interface SessionEdits {
  revenueOverrides: Record<string, number>;
  notes: Record<string, string>;
  nextSteps: Record<string, string>;
  forecastCalls: Record<string, ForecastCategory>;
}

export const NO_SESSION_EDITS: SessionEdits = {
  revenueOverrides: {},
  notes: {},
  nextSteps: {},
  forecastCalls: {},
};

/**
 * Folds the session's edits into the opportunity book, so every KPI, chart,
 * and table downstream reads the corrected figure rather than the one the
 * provider supplied. The weighted forecast therefore moves the moment a
 * manager re-calls a deal.
 *
 * Presence, not truthiness, decides whether a field was edited. An emptied
 * note or next step is stored as '' and has to survive as '': treating it as
 * "no edit" would fall back to the provider's value, and clearing a field the
 * CRM populated would silently restore it.
 *
 * Untouched opportunities are returned by reference so downstream memoisation
 * can still tell what actually changed.
 */
export function applySessionEdits(
  book: Opportunity[],
  edits: SessionEdits,
): Opportunity[] {
  const { revenueOverrides, notes, nextSteps, forecastCalls } = edits;
  return book.map((opportunity) => {
    const revenue = revenueOverrides[opportunity.id];
    const note = notes[opportunity.id];
    const nextStep = nextSteps[opportunity.id];
    const call = forecastCalls[opportunity.id];
    if (
      revenue === undefined &&
      note === undefined &&
      nextStep === undefined &&
      call === undefined
    ) {
      return opportunity;
    }
    return {
      ...opportunity,
      forecastedRevenue: revenue ?? opportunity.forecastedRevenue,
      notes: note ?? opportunity.notes,
      nextStep: nextStep ?? opportunity.nextStep,
      forecastCategory: call ?? opportunity.forecastCategory,
    };
  });
}
