/**
 * The contract every source adapter in this directory satisfies.
 *
 * The mission is client-only: no CRM, PRM, calendar, enablement, or target
 * system is connected, and no credential exists to connect one. What exists
 * is the *shape* of that future ingestion path, as pure functions:
 * representative source-shaped records go in, canonical records (or typed
 * failures) come out, with provenance. Production ingestion — server-held
 * credentials, incremental sync, reconciliation — is Production: Prod Only,
 * and these adapters are written so that a server pipeline could call them
 * unchanged.
 *
 * The rules every adapter keeps:
 *
 * - **Pure.** No fetches, no storage, no logging of input, no clock reads,
 *   no randomness, no mutation of the input. Same input, same output.
 * - **Strict.** Required IDs, foreign keys, enums, ISO 8601 dates, and
 *   finite non-negative money are validated. A malformed value is a typed
 *   failure, never a guessed default: an unknown enum does not become the
 *   first enum, a bad date does not become today, a missing amount does not
 *   become zero.
 * - **Complete.** One call reports every issue it can find, in field order,
 *   so a rejected record describes the whole repair, not just its first
 *   fault.
 * - **Provenance-preserving.** A successful record carries the source
 *   system, the source record's own id, and the source fields consumed, so
 *   lineage survives the mapping.
 */

/** The representative source systems the demo models. */
type SourceSystem = 'crm' | 'prm' | 'calendar' | 'enablement' | 'targets' | 'certifications';

/**
 * Where a canonical record came from. `sourceRecordId` is the source system's
 * own stable key; the demo uses those keys as the canonical ids directly,
 * where a production pipeline would mint surrogate keys and keep this as the
 * mapping back.
 */
export interface SourceProvenance {
  source: SourceSystem;
  sourceRecordId: string;
  /** The source fields the canonical record consumed, sorted ascending. */
  fields: readonly string[];
}

/** The closed set of ways a source record can fail to normalize. */
export type NormalizationIssueCode =
  /** The input is not a plain object (or, for transcripts, an array). */
  | 'malformed-record'
  /** A required field is absent, null, or the wrong kind of value. */
  | 'missing-field'
  /** An id is not a non-empty slug-shaped string. */
  | 'invalid-identifier'
  /** A free-text field is not a non-empty string. */
  | 'invalid-string'
  /** A value is outside the source system's declared enum mapping. */
  | 'unknown-enum-value'
  /** A date or timestamp is not strict ISO 8601 UTC, or is not a real day. */
  | 'invalid-date'
  /** A money field is not a finite, non-negative number. */
  | 'invalid-money'
  /** A count or duration is not a finite non-negative integer. */
  | 'invalid-integer'
  /** A reference points at a record the source context does not know. */
  | 'unknown-foreign-key'
  /** Fields disagree, e.g. an outcome with no close date. */
  | 'inconsistent-state'
  /** A collection repeats a key it must contain once. */
  | 'duplicate-record';

export interface NormalizationIssue {
  code: NormalizationIssueCode;
  /**
   * Where the problem is, as a dot path into the source record:
   * `Amount__c`, `tracks.partnerEngineer.goal`, `rows[2].certified`.
   */
  path: string;
  /**
   * Stable technical detail: what the field must be, never the offending
   * value itself — raw input does not belong in logs, telemetry, or error
   * text that may leave the process.
   */
  detail: string;
}

/**
 * The result of one normalization: a canonical record with its provenance,
 * or every issue found. There is no third state — a record is never
 * partially normalized into plausible-looking output.
 */
export type NormalizationResult<T> =
  | { ok: true; record: T; provenance: SourceProvenance }
  | { ok: false; issues: NormalizationIssue[] };
