import type { LogRecord, LogSink } from './logging';

/**
 * Field-level redaction for data that leaves the browser.
 *
 * Everything the telemetry transport ships passes through `redactRecord` — a
 * record is a flat structured-log shape or an envelope payload, and any field
 * whose key looks like a credential, an identifier of a person, or an
 * authorization artifact is replaced before the payload is queued. Values are
 * treated as sensitive as their key says they are: the whole value is
 * replaced, not just the interesting characters, so a password cannot leak
 * through a nested object or an array of objects under a sensitive key.
 *
 * The browser console sink is deliberately NOT redacted: it stays on the
 * user's machine, and a developer debugging locally needs the real values.
 * Redaction is for the boundary — `scrubbingSink` wraps any sink that carries
 * records somewhere else.
 */

/** What a sensitive field is replaced with. */
export const REDACTED = '[redacted]';

/** What an email address is masked to, keeping the domain for debugging. */
const EMAIL_MASK = '$1***@$2';

/**
 * Keys that name something that must not leave the browser. Matched
 * case-insensitively and against compound keys (`userEmail`, `api-key`,
 * `refresh_token`), because field naming is exactly where drift happens.
 * `email` is included: it is a person identifier, and the dashboard has no
 * signed-in user model, so no envelope needs one.
 */
const SENSITIVE_KEY_PATTERN =
  /password|passphrase|secret|token|authorization|auth|api[-_]?key|credential|cookie|session[-_]?id|ssn|email/i;

// First character kept so "which person" stays debuggable to a point, rest of
// the local part dropped; domain kept so "which company" survives.
const EMAIL_IN_STRING = /([^\s"'@,;])[^\s"'@,;]*@([^\s"',;]+\.[^\s"',;]+)/g;

const MAX_DEPTH = 6;

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Masks email addresses inside otherwise-fine prose: `dana@corp.example`
 * becomes `d***@corp.example`. The domain survives because "which company
 * wrote in" is operational context; the local part is the person, and it goes.
 */
export function maskEmailsInString(value: string): string {
  return value.replace(EMAIL_IN_STRING, EMAIL_MASK);
}

function redactUnknown(value: unknown, key: string, seen: WeakSet<object>, depth: number): unknown {
  if (isSensitiveKey(key)) return REDACTED;
  if (typeof value === 'string') return maskEmailsInString(value);
  if (typeof value !== 'object' || value === null) return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    // An error under a non-sensitive key keeps its diagnostic shape, but its
    // message and stack are strings like any other, so emails in them mask.
    return {
      name: value.name,
      message: maskEmailsInString(value.message),
      ...(value.stack ? { stack: maskEmailsInString(value.stack) } : {}),
    };
  }
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[truncated array]' : '[truncated object]';
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactUnknown(item, key, seen, depth + 1));
    }
    const fields: Record<string, unknown> = {};
    for (const [fieldKey, item] of Object.entries(value)) {
      if (item !== undefined) fields[fieldKey] = redactUnknown(item, fieldKey, seen, depth + 1);
    }
    return fields;
  } finally {
    seen.delete(value);
  }
}

/**
 * A copy of a record with every sensitive field replaced and every email
 * address masked. The input is not mutated; nesting is walked rather than
 * flattened so structured context keeps its shape on the collector side.
 */
export function redactRecord<T extends Record<string, unknown>>(record: T): T {
  const seen = new WeakSet<object>();
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined) scrubbed[key] = redactUnknown(value, key, seen, 0);
  }
  return scrubbed as T;
}

/**
 * Wraps a sink so records are redacted only on their way through it — the
 * pattern for a sink that ships logs to a collector while the console sink
 * keeps the originals.
 */
export function scrubbingSink(sink: LogSink): LogSink {
  return (record: LogRecord) => sink(redactRecord(record));
}
