import type { NormalizationIssue, NormalizationIssueCode } from './types';

/**
 * The field validators every adapter is built from. Each reads one field
 * out of a source record, pushes a typed issue when the value fails, and
 * returns `undefined` for a value that failed (or an absent optional), so an
 * adapter collects all of a record's issues in field order and never builds
 * a canonical record out of a value that did not validate.
 *
 * Everything here is pure: no I/O, no clock, no mutation of the input.
 */

/**
 * Canonical and source ids are slug-shaped strings. The demo uses the source
 * system's stable keys as canonical ids, so both sides share one shape.
 */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;

/** `2026-09-14` — date-only, no timezone to misread. */
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-09-14T15:30:00Z` or with milliseconds — UTC, and only UTC. */
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;

/** The input of every record-level adapter, or null when it is not one. */
export function asRecord(input: unknown): Record<string, unknown> | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  return input as Record<string, unknown>;
}

export function issue(
  issues: NormalizationIssue[],
  code: NormalizationIssueCode,
  path: string,
  detail: string,
): void {
  issues.push({ code, path, detail });
}

export function malformedRecord(path: string, expected: string): NormalizationIssue {
  return { code: 'malformed-record', path, detail: `expected ${expected}` };
}

/** A required non-empty string. */
export function readString(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): string | undefined {
  const value = source[field];
  if (typeof value !== 'string' || value.trim() === '') {
    issue(
      issues,
      value === undefined || value === null ? 'missing-field' : 'invalid-string',
      path,
      'expected a non-empty string',
    );
    return undefined;
  }
  return value;
}

/** A required canonical/source identifier. */
export function readIdentifier(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    issue(issues, 'missing-field', path, 'expected a record identifier');
    return undefined;
  }
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
    issue(
      issues,
      'invalid-identifier',
      path,
      'expected a slug-shaped identifier (letters, digits, dash, underscore)',
    );
    return undefined;
  }
  return value;
}

/**
 * A required enum, mapped through the source system's declared table. An
 * unmapped value fails: guessing the nearest canonical enum is how a
 * "Referral" partner quietly becomes a "Reseller".
 */
export function readEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  mapping: Record<string, T>,
  issues: NormalizationIssue[],
  path: string = field,
): T | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    issue(issues, 'missing-field', path, 'expected one of the declared source values');
    return undefined;
  }
  if (typeof value !== 'string' || !(value in mapping)) {
    issue(
      issues,
      'unknown-enum-value',
      path,
      `expected one of: ${Object.keys(mapping).join(', ')}`,
    );
    return undefined;
  }
  return mapping[value];
}

/** An optional enum: null/absent means "not set", anything else must map. */
export function readOptionalEnum<T extends string>(
  source: Record<string, unknown>,
  field: string,
  mapping: Record<string, T>,
  issues: NormalizationIssue[],
  path: string = field,
): T | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  return readEnum(source, field, mapping, issues, path);
}

/** A required money amount: a finite, non-negative number. */
export function readMoney(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): number | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    issue(issues, 'missing-field', path, 'expected a finite, non-negative amount');
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    issue(issues, 'invalid-money', path, 'expected a finite, non-negative amount');
    return undefined;
  }
  return value;
}

/** A required count or duration: a finite, non-negative integer. */
export function readCount(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): number | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    issue(issues, 'missing-field', path, 'expected a non-negative integer');
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issue(issues, 'invalid-integer', path, 'expected a non-negative integer');
    return undefined;
  }
  return value;
}

/** Calendar components as a real UTC instant, or null for an impossible day. */
function isoFromParts(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const instant = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));
  // Date.UTC rolls impossible days over (Feb 30 → Mar 2): a round-trip that
  // disagrees with the input is the only honest answer.
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    return null;
  }
  return instant.toISOString();
}

/**
 * A required ISO 8601 UTC timestamp, canonicalized to millisecond form.
 * Date.parse alone accepts prose dates and offset-less local times; both are
 * rejected here so the same source record normalizes identically in every
 * timezone.
 */
export function readIsoTimestamp(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    issue(issues, 'missing-field', path, 'expected an ISO 8601 UTC timestamp');
    return undefined;
  }
  const match = typeof value === 'string' ? ISO_TIMESTAMP.exec(value) : null;
  const iso =
    match === null
      ? null
      : isoFromParts(
          Number(match[1]),
          Number(match[2]),
          Number(match[3]),
          Number(match[4]),
          Number(match[5]),
          Number(match[6]),
        );
  if (iso === null) {
    issue(
      issues,
      'invalid-date',
      path,
      'expected an ISO 8601 UTC timestamp (YYYY-MM-DDTHH:mm:ssZ)',
    );
    return undefined;
  }
  return iso;
}

/** An optional timestamp: null/absent means "not set". */
export function readOptionalIsoTimestamp(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) return undefined;
  return readIsoTimestamp(source, field, issues, path);
}

/** A required ISO 8601 date-only value, normalized to UTC midnight. */
export function readIsoDate(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null) {
    issue(issues, 'missing-field', path, 'expected an ISO 8601 date');
    return undefined;
  }
  const match = typeof value === 'string' ? ISO_DATE_ONLY.exec(value) : null;
  const iso =
    match === null
      ? null
      : isoFromParts(Number(match[1]), Number(match[2]), Number(match[3]), 0, 0, 0);
  if (iso === null) {
    issue(
      issues,
      'invalid-date',
      path,
      'expected an ISO 8601 date (YYYY-MM-DD) that is a real day',
    );
    return undefined;
  }
  return iso;
}

/** A required reference into the set of records the context knows. */
export function readForeignKey(
  source: Record<string, unknown>,
  field: string,
  known: ReadonlySet<string>,
  issues: NormalizationIssue[],
  path: string = field,
): string | undefined {
  const value = readIdentifier(source, field, issues, path);
  if (value === undefined) return undefined;
  if (!known.has(value)) {
    issue(
      issues,
      'unknown-foreign-key',
      path,
      'references a record the source context does not know',
    );
    return undefined;
  }
  return value;
}

/** An optional string: null/absent/blank means "not set". */
export function readOptionalString(
  source: Record<string, unknown>,
  field: string,
  issues: NormalizationIssue[],
  path: string = field,
): string | undefined {
  const value = source[field];
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    issue(issues, 'invalid-string', path, 'expected a string when set');
    return undefined;
  }
  return value;
}
