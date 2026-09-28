/**
 * Structured logging.
 *
 * Every event is one flat record — `time`, `level`, `msg`, plus context fields
 * — rather than a string with values interpolated into it, so the browser
 * console can filter records by level and any future sink (a collector
 * endpoint, a test) can read the fields without parsing prose. Errors are
 * serialized instead of stringified, undefined fields are dropped, and values
 * that would recurse forever or nest arbitrarily deep are cut off, so a record
 * can always be shipped as JSON.
 *
 * The bar a log has to clear: someone debugging a session they did not watch
 * should be able to reconstruct what happened from the records alone.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * Numeric weight per level, so any consumer can compare severities — the
 * telemetry log-shipping sink uses it to decide which records are worth
 * sending without re-encoding the level order.
 */
export const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/** One event: the envelope fields plus any context fields, all flat. */
export interface LogRecord {
  time: string;
  level: LogLevel;
  msg: string;
  [field: string]: unknown;
}

/** Free-form fields merged into a record next to the envelope. */
export type LogContext = Record<string, unknown>;

/** Where a record goes once it is built. */
export type LogSink = (record: LogRecord) => void;

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && (LOG_LEVELS as readonly string[]).includes(value);
}

const MAX_DEPTH = 4;

/**
 * Turns a context value into something a record can carry and JSON can ship:
 * an Error becomes its name, message, and stack (a raw Error does not survive
 * `JSON.stringify`), a date becomes an ISO string, and anything that would
 * recurse forever or nest arbitrarily deep is cut off rather than thrown on.
 */
function serializeValue(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === 'function') return `[function ${value.name || 'anonymous'}]`;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const fields: Record<string, unknown> = { name: value.name, message: value.message };
    if (value.stack) fields.stack = value.stack;
    if (value.cause !== undefined) fields.cause = serializeValue(value.cause, seen, depth + 1);
    return fields;
  }
  if (typeof value !== 'object' || value === null) return value;
  if (seen.has(value)) return '[circular]';
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? '[truncated array]' : '[truncated object]';
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => serializeValue(item, seen, depth + 1));
    const fields: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) fields[key] = serializeValue(item, seen, depth + 1);
    }
    return fields;
  } finally {
    seen.delete(value);
  }
}

/**
 * The default sink: one record, one console call, at the severity the browser
 * console already knows how to filter. The record is passed whole rather than
 * stringified so DevTools shows every field without parsing.
 */
export const consoleSink: LogSink = (record) => {
  switch (record.level) {
    case 'debug':
      console.debug(record);
      break;
    case 'info':
      console.info(record);
      break;
    case 'warn':
      console.warn(record);
      break;
    case 'error':
      console.error(record);
      break;
  }
};

export interface Logger {
  debug(msg: string, context?: LogContext): void;
  info(msg: string, context?: LogContext): void;
  warn(msg: string, context?: LogContext): void;
  error(msg: string, context?: LogContext): void;
  /** A logger that carries these fields on every record; call-site context wins on collision. */
  child(fields: LogContext): Logger;
  /** Retargets this logger and every logger created from it, at any depth. */
  setLevel(level: LogLevel): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  sink?: LogSink;
  /** Fields every record carries, e.g. the component a logger belongs to. */
  fields?: LogContext;
}

interface LoggerState {
  level: LogLevel;
  sink: LogSink;
}

/**
 * Sinks every record reaches, on top of its logger's own sink. This is how
 * records can leave the browser (telemetry log shipping) without any call
 * site changing, and without the console sink losing the unredacted record a
 * local developer needs. Registrations are app-wide and apply to loggers
 * created before or after the registration.
 */
const globalSinks: LogSink[] = [];

/**
 * Adds a sink that receives every record every logger emits, and returns the
 * function that removes it. Sinks are expected not to throw — a shipping
 * failure is theirs to handle — but one that does is contained to its own
 * record rather than the call site that logged.
 */
export function addGlobalSink(sink: LogSink): () => void {
  globalSinks.push(sink);
  return () => {
    const index = globalSinks.indexOf(sink);
    if (index !== -1) globalSinks.splice(index, 1);
  };
}

function emitToSinks(state: LoggerState, record: LogRecord): void {
  state.sink(record);
  for (const sink of globalSinks) {
    try {
      sink(record);
    } catch (error) {
      // The one raw console call in the logging layer, as the last resort:
      // a sink that throws cannot be logged through a sink without recursing,
      // and hiding the failure entirely would leave a dead sink undiscovered.
      console.error('[logging] sink failed', error);
    }
  }
}

// The envelope is written last, so context named time/level/msg cannot clobber it.
function emit(
  state: LoggerState,
  base: LogContext,
  level: LogLevel,
  msg: string,
  context?: LogContext,
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[state.level]) return;
  const seen = new WeakSet<object>();
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined) record[key] = serializeValue(value, seen, 0);
  }
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      if (value !== undefined) record[key] = serializeValue(value, seen, 0);
    }
  }
  record.time = new Date().toISOString();
  record.level = level;
  record.msg = msg;
  emitToSinks(state, record as LogRecord);
}

/**
 * The default minimum level: `VITE_LOG_LEVEL` when it is one of the four
 * levels, otherwise `debug` in development and `warn` in production builds, so
 * a shipped build logs only what needs attention. Vite inlines it at build
 * time; a preview server does not re-read the environment.
 */
function defaultLevel(): LogLevel {
  const configured = import.meta.env.VITE_LOG_LEVEL;
  if (isLogLevel(configured)) return configured;
  return import.meta.env.PROD ? 'warn' : 'debug';
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const state: LoggerState = {
    level: options.level ?? defaultLevel(),
    sink: options.sink ?? consoleSink,
  };
  const make = (base: LogContext): Logger => {
    const log = (level: LogLevel, msg: string, context?: LogContext) =>
      emit(state, base, level, msg, context);
    return {
      debug: (msg, context) => log('debug', msg, context),
      info: (msg, context) => log('info', msg, context),
      warn: (msg, context) => log('warn', msg, context),
      error: (msg, context) => log('error', msg, context),
      child: (fields) => make({ ...base, ...fields }),
      setLevel: (level) => {
        state.level = level;
      },
    };
  };
  return make(options.fields ?? {});
}

/** The app-wide logger: console sink, level from `VITE_LOG_LEVEL` or the mode default. */
export const logger: Logger = createLogger();
