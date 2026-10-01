/**
 * The cursor-pagination primitive every row query on the scoped contract
 * shares.
 *
 * The guarantees, and why they are here rather than in each provider method:
 *
 * - **Bounded pages.** A request names a positive limit no greater than
 *   `MAX_PAGE_LIMIT`; one that omits the limit gets `DEFAULT_PAGE_LIMIT`.
 *   An unbounded page is a whole-book read wearing a cursor's clothes, so
 *   anything else — zero, negative, fractional, non-finite, or over the
 *   maximum — is rejected with a typed error, not silently clamped. A
 *   clamped answer would claim to be the page the caller asked for.
 * - **Sealed, provider-instance-bound cursors.** A cursor is a base64url
 *   token carrying a fingerprint of the query it was minted for, the data
 *   epoch it was minted against, the offset it marks, and a seal over all
 *   three that only the minting `CursorIssuer` can recompute. Callers
 *   cannot do arithmetic on it: an edited offset, epoch, or fingerprint
 *   fails the seal and is `invalid-cursor`, and so is any token this
 *   issuer did not mint — a hand-rolled forgery, or another provider
 *   instance's cursor, however identical its data. An intact cursor from
 *   this issuer presented to a different scope or business filter fails
 *   `foreign-cursor`, and one whose epoch or collection has moved on
 *   fails `expired-cursor`. Failing loudly is the contract — quietly
 *   serving page one would duplicate rows the caller already has.
 * - **Stable, exhaustive walks.** The caller hands rows over in a stable
 *   order (the provider sorts before it paginates), so under an unchanged
 *   scope and data epoch a walk visits every row exactly once and the same
 *   request returns the same page twice.
 *
 * The seam enforces all of this server-side-in-spirit: hooks pass cursors
 * back verbatim and limits straight through, and it is the provider —
 * through `paginateRows` — that validates, because in production the server
 * is the side that must.
 */

/** Rows served when a request does not name a limit: bounded from the start. */
export const DEFAULT_PAGE_LIMIT = 25;

/**
 * The most rows one request can ask for. A view that needs more rows asks
 * for more pages; nothing a view renders needs a hundred rows at once.
 */
export const MAX_PAGE_LIMIT = 100;

export interface PageRequest {
  /** Opaque cursor from a previous `Page`; omitted starts at the first page. */
  cursor?: string;
  /**
   * Rows to return: a positive integer no greater than `MAX_PAGE_LIMIT`.
   * Omitted, the provider serves `DEFAULT_PAGE_LIMIT`.
   */
  limit?: number;
}

export interface Page<T> {
  rows: T[];
  /** Opaque continuation token; absent once the last page has been served. */
  nextCursor?: string;
  /** Total rows matching the scope, for "showing 25 of 213". */
  totalCount: number;
}

/**
 * The ways a page request can be rejected. Stable codes, because the message
 * is for logs and the code is for programs: a hook can tell "ask for less"
 * from "start over" without parsing prose.
 */
export type PageErrorCode =
  'invalid-page-limit' | 'invalid-cursor' | 'foreign-cursor' | 'expired-cursor';

/** The typed rejection an invalid page request gets. Carries no row data. */
export class PageQueryError extends Error {
  readonly code: PageErrorCode;

  constructor(code: PageErrorCode, message: string) {
    super(message);
    this.name = 'PageQueryError';
    this.code = code;
  }
}

/** Structural check: true for a page-request rejection, however it travelled. */
export function isPageQueryError(error: unknown): error is PageQueryError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'PageQueryError' &&
    typeof (error as { code?: unknown }).code === 'string'
  );
}

/**
 * Validates the requested page size. Omitted means the default; anything
 * that is not a positive integer within the bound is a typed error — never
 * a clamp, never page one with a shrug.
 */
export function resolvePageLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_PAGE_LIMIT;
  if (!Number.isInteger(limit) || limit <= 0 || limit > MAX_PAGE_LIMIT) {
    throw new PageQueryError(
      'invalid-page-limit',
      `Invalid page limit: expected a positive integer of at most ${MAX_PAGE_LIMIT}, received ${String(
        limit,
      )}`,
    );
  }
  return limit;
}

/** Cursor envelope version, so a future format fails closed instead of weirdly. */
const CURSOR_VERSION = 1;

/**
 * What a cursor carries. The query rides as a fingerprint rather than the
 * key itself: the token stays opaque about the scope it belongs to, and a
 * log line that captures one learns nothing from it. The seal binds the
 * other three fields to the issuer that minted them, which is what makes
 * the readable payload useless to anyone holding only the token.
 */
interface CursorPayload {
  v: number;
  /** Fingerprint of the query the cursor belongs to. */
  q: string;
  /** Data epoch the cursor was minted against (the provider's as-of). */
  at: string;
  /** Row offset within the stably ordered, scoped collection. */
  o: number;
  /** The minting issuer's keyed seal over the fields above. */
  s: string;
}

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** FNV-1a continued from `state`, so keyed folds can be chained. */
function fnvMix(state: number, text: string): number {
  let hash = state;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0;
}

/**
 * FNV-1a, hex. Folds the query key into the cursor so a cursor minted for
 * one query is a typed error on any other, without the token carrying the
 * key around in readable form.
 */
function queryFingerprint(queryKey: string): string {
  return fnvMix(FNV_OFFSET_BASIS, queryKey).toString(16).padStart(8, '0');
}

/**
 * The issuer's seal over one payload, in the spirit of an envelope MAC:
 * the secret is folded in before AND after the canonical body, so a reader
 * can neither continue the fold (the prefix state is unknown) nor peel it
 * back to reuse the seal (the suffix pass hides the intermediate state).
 *
 * It is deliberately not cryptographic armor — it is the honest budget for
 * the demo's threat model, "the client cannot forge or launder a cursor":
 * without the instance's secret a forged seal is a 32-bit guess priced one
 * request per attempt, and every miss is a loud typed rejection rather
 * than a quieter page. A production server swaps this for HMAC without the
 * contract or the token shape changing.
 */
function sealPayload(secret: string, payload: Omit<CursorPayload, 's'>): string {
  const body = `${payload.v}|${payload.q}|${payload.at}|${payload.o}`;
  const inner = fnvMix(FNV_OFFSET_BASIS, `${secret}\n${body}`);
  return fnvMix(FNV_OFFSET_BASIS, `${secret}\n${inner.toString(36)}`).toString(36);
}

/**
 * One provider instance's cursor capability. Minting and verifying live
 * behind the same per-instance secret, so a cursor is a capability of the
 * instance that issued it: replayed against any other instance — a second
 * mock over the same book, the scaled provider, a forged re-encode — the
 * seal does not verify and the token is `invalid-cursor`, never a page.
 */
export interface CursorIssuer {
  /** Mint the continuation token for `offset` of one immutable query window. */
  mint(args: { queryKey: string; asOf: string; offset: number }): string;
  /**
   * The payload of a cursor this issuer minted, or null for a malformed
   * token, a tampered payload, or another issuer's cursor.
   */
  open(cursor: string): CursorPayload | null;
}

/**
 * A new issuer with an instance-random secret unless one is pinned. Pinning
 * exists for tests that model ONE logical provider across a data move: its
 * later instance must share the earlier one's secret for the old cursors to
 * classify as expired rather than forged. Two providers must never share
 * one — the seal is only as instance-bound as the secret is.
 */
export function createCursorIssuer(secret: string = crypto.randomUUID()): CursorIssuer {
  return {
    mint({ queryKey, asOf, offset }) {
      const unsigned = { v: CURSOR_VERSION, q: queryFingerprint(queryKey), at: asOf, o: offset };
      return encodeCursor({ ...unsigned, s: sealPayload(secret, unsigned) });
    },
    open(cursor) {
      const payload = decodeCursor(cursor);
      if (payload === null) return null;
      const { s, ...unsigned } = payload;
      return sealPayload(secret, unsigned) === s ? payload : null;
    },
  };
}

function encodeCursor(payload: CursorPayload): string {
  return btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/**
 * Parses a cursor back into its payload. Anything that does not decode into
 * exactly the sealed shape this module mints is not a cursor at all: the
 * provider never guesses at a token it did not issue. The seal itself is
 * checked by the issuer, not here.
 */
function decodeCursor(cursor: string): CursorPayload | null {
  let parsed: unknown;
  try {
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    parsed = JSON.parse(atob(padded));
  } catch {
    return null;
  }
  const payload = parsed as Partial<CursorPayload> | null;
  if (
    typeof payload !== 'object' ||
    payload === null ||
    payload.v !== CURSOR_VERSION ||
    typeof payload.q !== 'string' ||
    typeof payload.at !== 'string' ||
    !Number.isInteger(payload.o) ||
    (payload.o as number) < 0 ||
    typeof payload.s !== 'string' ||
    // No extra fields: an unknown rider would survive the seal check of the
    // five known ones, so the envelope is exactly these keys.
    Object.keys(payload).sort().join(',') !== 'at,o,q,s,v'
  ) {
    return null;
  }
  return payload as CursorPayload;
}

/**
 * Serves one page of an already scoped, already stably ordered collection.
 *
 * Ordering is the caller's half of the contract: the rows must arrive in an
 * order that cannot change between two requests over unchanged data, or no
 * cursor scheme can keep a walk exhaustive. This function keeps the other
 * half: the limit is validated, the cursor is checked against the query and
 * the data epoch, and the continuation token is minted only while rows
 * remain.
 */
export function paginateRows<T>(args: {
  /** The full scoped collection, in stable order. */
  rows: readonly T[];
  /**
   * The query's membership identity: everything that decides WHICH rows
   * belong — the access scope and the business scope — and nothing that
   * merely changes what a row says. A cursor minted under one key is a
   * `foreign-cursor` error under another.
   */
  queryKey: string;
  /**
   * The data epoch the answer is computed from. When the provider's data
   * moves on, every cursor minted against the older epoch is
   * `expired-cursor` rather than a silent pointer into moved rows.
   */
  asOf: string;
  /**
   * This provider instance's cursor capability: it mints continuations and
   * opens incoming cursors. A token whose seal this issuer did not make —
   * forged, tampered, or another instance's — is `invalid-cursor`.
   */
  issuer: CursorIssuer;
  cursor?: string;
  limit?: number;
}): Page<T> {
  const limit = resolvePageLimit(args.limit);
  let offset = 0;
  if (args.cursor !== undefined) {
    const payload = args.issuer.open(args.cursor);
    if (payload === null) {
      throw new PageQueryError(
        'invalid-cursor',
        'Invalid cursor: not a token this provider issued',
      );
    }
    if (payload.q !== queryFingerprint(args.queryKey)) {
      throw new PageQueryError(
        'foreign-cursor',
        'Foreign cursor: it was minted for a different query, so its position means nothing here',
      );
    }
    if (payload.at !== args.asOf || payload.o >= args.rows.length) {
      throw new PageQueryError(
        'expired-cursor',
        'Expired cursor: the data it marked a position in has moved on; restart the walk',
      );
    }
    offset = payload.o;
  }
  const rows = args.rows.slice(offset, offset + limit);
  const next = offset + rows.length;
  return {
    rows,
    totalCount: args.rows.length,
    ...(next < args.rows.length
      ? {
          nextCursor: args.issuer.mint({
            queryKey: args.queryKey,
            asOf: args.asOf,
            offset: next,
          }),
        }
      : {}),
  };
}
