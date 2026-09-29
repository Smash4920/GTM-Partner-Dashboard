/**
 * The metadata every scoped query answer carries.
 *
 * An aggregate is only as trustworthy as what the reader knows about it: who
 * produced it, as of when, what it was computed from, and whether anything
 * it needed was missing. The scoped contract therefore returns an envelope —
 * `QueryResult<T>` pairs the answer with a `QueryMeta` — rather than a bare
 * value, so a stale or partial figure can never masquerade as a complete,
 * current one.
 *
 * The semantics, per field:
 *
 * - `providerId`: the committed provider that produced the answer. Hooks gate
 *   results by provider object identity, so a rendered envelope always belongs
 *   to the provider the session committed to; the id is the visible evidence
 *   of that.
 * - `asOf`: the deterministic instant the answer describes, as ISO. Mock
 *   providers answer as of the fixed snapshot date, never the wall clock, so
 *   the same question always carries the same as-of.
 * - `lineage`: the typed inputs the answer was computed from — the seeded
 *   book, any session edits folded in before aggregation, recorded weekly
 *   snapshots.
 * - `completeness`: `complete` when every required input was present,
 *   `partial` when the answer is usable but something it should have included
 *   is missing. Partial is derived from the warnings, never asserted
 *   separately, so the two cannot disagree.
 * - `warnings`: what is missing, as stable typed codes with safe technical
 *   messages. Warnings carry counts and codes, never user or customer prose.
 */

type DataCompleteness = 'complete' | 'partial';

/** The inputs a scoped answer can descend from. */
type LineageSource = 'mock-book' | 'session-edits' | 'weekly-snapshots';

export interface DataLineage {
  source: LineageSource;
  /** Technical detail: what and how much, never user-entered text. */
  description: string;
}

/**
 * The degradations the demo providers can report. Each code names one way an
 * answer can be usable but incomplete; adding a degradation means adding a
 * code here, so the set a UI can meet is closed.
 */
type DataWarningCode = 'weekly-history-reconstructed' | 'unattributed-opportunities';

export interface DataWarning {
  code: DataWarningCode;
  /** Safe to render verbatim: counts and facts, no free-form input. */
  message: string;
}

export interface QueryMeta {
  providerId: string;
  /** ISO instant the answer describes — deterministic per provider. */
  asOf: string;
  lineage: readonly DataLineage[];
  completeness: DataCompleteness;
  warnings: readonly DataWarning[];
}

/** A scoped answer plus the metadata that makes it honest. */
export interface QueryResult<T> {
  data: T;
  meta: QueryMeta;
}

/**
 * Folds lineage and warnings into the envelope metadata. Completeness is
 * derived — any warning means partial — so a caller cannot mark an answer
 * complete while reporting that part of it is missing.
 */
export function buildQueryMeta(input: {
  providerId: string;
  asOf: string;
  lineage: readonly DataLineage[];
  warnings?: readonly DataWarning[];
}): QueryMeta {
  const warnings = input.warnings ?? [];
  return {
    providerId: input.providerId,
    asOf: input.asOf,
    lineage: input.lineage,
    completeness: warnings.length > 0 ? 'partial' : 'complete',
    warnings,
  };
}

/** Pairs an answer with its metadata. */
export function queryResult<T>(data: T, meta: QueryMeta): QueryResult<T> {
  return { data, meta };
}

/**
 * Some closed weeks of the quarter had no recorded snapshot, so the series
 * reconstructed them from the current book — which backdates every later
 * change into those weeks (see PipelineSnapshot in types.ts). The chart is
 * still usable; the warning says which part of it is a reconstruction.
 */
export function weeklyHistoryReconstructedWarning(
  reconstructedWeeks: number,
  closedWeeks: number,
): DataWarning {
  return {
    code: 'weekly-history-reconstructed',
    message: `${reconstructedWeeks} of ${closedWeeks} closed weeks were reconstructed from the current book; no recorded snapshot exists for them`,
  };
}

/**
 * In-quarter opportunities whose partner is missing from the partner
 * dimension cannot be attributed to a manager, so the per-manager groups
 * drop them while the quarter totals still count them. Without the warning
 * the group figures would silently sum to less than the headline numbers.
 */
export function unattributedOpportunitiesWarning(count: number): DataWarning {
  return {
    code: 'unattributed-opportunities',
    message: `${count} in-quarter ${count === 1 ? 'opportunity' : 'opportunities'} could not be attributed to a partner manager and ${count === 1 ? 'is' : 'are'} missing from the manager groups`,
  };
}
