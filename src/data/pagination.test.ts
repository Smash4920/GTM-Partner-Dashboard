import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_LIMIT,
  isPageQueryError,
  MAX_PAGE_LIMIT,
  paginateRows,
  PageQueryError,
  resolvePageLimit,
} from './pagination';
import type { Page } from './pagination';

/**
 * VAL-DATA-009, at the primitive every row query shares: bounded validated
 * limits, opaque query-bound cursors, stable ordering, exhaustive walks,
 * and typed failures for every invalid limit or cursor class.
 */

interface Row {
  id: string;
}

/** Sixty stably ordered rows: enough for nine pages of seven. */
const ROWS: Row[] = Array.from({ length: 60 }, (_, index) => ({
  id: `row-${String(index).padStart(3, '0')}`,
}));

const QUERY_KEY = 'listQuarterOpportunities|access:internal:org|quarter:FY27-Q3|manager:all';
const AS_OF = '2026-09-18T00:00:00.000Z';

function page(args: {
  cursor?: string;
  limit?: number;
  rows?: Row[];
  queryKey?: string;
  asOf?: string;
}): Page<Row> {
  return paginateRows({
    rows: args.rows ?? ROWS,
    queryKey: args.queryKey ?? QUERY_KEY,
    asOf: args.asOf ?? AS_OF,
    cursor: args.cursor,
    limit: args.limit,
  });
}

/** The rejection a call produces, or a failure of the test itself. */
function rejectionOf(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('page limits', () => {
  it('defaults to at most 25 rows when the request names no limit', () => {
    const first = page({});
    expect(DEFAULT_PAGE_LIMIT).toBe(25);
    expect(first.rows).toHaveLength(25);
    expect(first.rows[0]?.id).toBe('row-000');
    expect(first.totalCount).toBe(60);
    expect(first.nextCursor).toEqual(expect.any(String));
  });

  it('serves the boundary limits: one row, and the maximum', () => {
    expect(page({ limit: 1 }).rows).toHaveLength(1);
    expect(page({ limit: MAX_PAGE_LIMIT }).rows).toHaveLength(60);
    expect(resolvePageLimit(MAX_PAGE_LIMIT)).toBe(MAX_PAGE_LIMIT);
  });

  it.each([0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, MAX_PAGE_LIMIT + 1, 500, 10_000])(
    'rejects the invalid or over-limit size %s with a typed error',
    (limit) => {
      const error = rejectionOf(() => page({ limit }));
      expect(isPageQueryError(error)).toBe(true);
      expect((error as PageQueryError).code).toBe('invalid-page-limit');
      expect(error).toBeInstanceOf(PageQueryError);
      // The message is technical: the rule and the received number, no rows.
      expect((error as Error).message).toContain(String(limit));
      expect((error as Error).message).not.toContain('row-000');
    },
  );
});

describe('cursor validation', () => {
  it('rejects tokens this contract never issued', () => {
    const cases: Record<string, string> = {
      garbage: 'not-a-cursor',
      'the retired offset format': 'offset:2',
      'base64 that is not the payload': btoa('{"o":2}'),
      'a payload with a fractional offset': btoa(
        JSON.stringify({ v: 1, q: 'deadbeef', at: AS_OF, o: 1.5 }),
      ),
      'a payload with a negative offset': btoa(
        JSON.stringify({ v: 1, q: 'deadbeef', at: AS_OF, o: -1 }),
      ),
      'a payload from another envelope version': btoa(
        JSON.stringify({ v: 2, q: 'deadbeef', at: AS_OF, o: 2 }),
      ),
    };
    for (const [label, cursor] of Object.entries(cases)) {
      const error = rejectionOf(() => page({ cursor }));
      expect(isPageQueryError(error), label).toBe(true);
      expect((error as PageQueryError).code, label).toBe('invalid-cursor');
    }
  });

  it('rejects a cursor minted for a different query rather than serving page one', () => {
    const { nextCursor } = page({ limit: 7 });
    if (nextCursor === undefined) throw new Error('expected a continuation');

    // Another manager, another quarter, another access scope: any change to
    // WHICH rows belong makes the cursor foreign.
    for (const queryKey of [
      'listQuarterOpportunities|access:internal:org|quarter:FY27-Q3|manager:pm-2',
      'listQuarterOpportunities|access:internal:org|quarter:FY27-Q4|manager:all',
      'listQuarterOpportunities|access:partner:partner-1|quarter:FY27-Q3|manager:all',
      'listActionItems|access:internal:org|quarter:FY27-Q3|manager:all',
    ]) {
      const error = rejectionOf(() => page({ cursor: nextCursor, limit: 7, queryKey }));
      expect(isPageQueryError(error), queryKey).toBe(true);
      expect((error as PageQueryError).code, queryKey).toBe('foreign-cursor');
    }
  });

  it('rejects a cursor minted against a data epoch that has moved on', () => {
    const { nextCursor } = page({ limit: 7 });
    if (nextCursor === undefined) throw new Error('expected a continuation');

    const error = rejectionOf(() =>
      page({ cursor: nextCursor, limit: 7, asOf: '2026-09-25T00:00:00.000Z' }),
    );
    expect(isPageQueryError(error)).toBe(true);
    expect((error as PageQueryError).code).toBe('expired-cursor');
  });

  it('rejects a cursor whose position no longer exists in the collection', () => {
    const { nextCursor } = page({ limit: 25 });
    if (nextCursor === undefined) throw new Error('expected a continuation');

    // The collection shrank past the marked position: the view of the data
    // this cursor pointed into is gone.
    const error = rejectionOf(() =>
      page({ cursor: nextCursor, limit: 7, rows: ROWS.slice(0, 10) }),
    );
    expect(isPageQueryError(error)).toBe(true);
    expect((error as PageQueryError).code).toBe('expired-cursor');
  });
});

describe('page walks', () => {
  it('walks the collection exactly once: stable, exhaustive, no duplicates', () => {
    const ids = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const current = page({ cursor, limit: 7 });
      expect(current.totalCount).toBe(60);
      expect(current.rows.length).toBeLessThanOrEqual(7);
      for (const row of current.rows) {
        expect(ids.has(row.id)).toBe(false);
        ids.add(row.id);
      }
      cursor = current.nextCursor;
      pages += 1;
    } while (cursor !== undefined);

    expect(pages).toBe(Math.ceil(60 / 7));
    expect(ids.size).toBe(60);
    // Exhaustive AND in order: the walk visited the stable ordering whole.
    expect([...ids]).toEqual(ROWS.map((row) => row.id));
  });

  it('answers the same request with the same page, twice', () => {
    const once = page({ limit: 7 });
    const again = page({ limit: 7 });
    expect(again).toEqual(once);
    // And the continuation is stable too: page two is page two.
    expect(page({ cursor: once.nextCursor, limit: 7 })).toEqual(
      page({ cursor: again.nextCursor, limit: 7 }),
    );
  });

  it('serves an empty collection as one empty page with no continuation', () => {
    const empty = page({ rows: [] });
    expect(empty).toEqual({ rows: [], totalCount: 0 });
  });

  it('mints cursors a caller cannot read or compute with', () => {
    const { nextCursor } = page({ limit: 7 });
    if (nextCursor === undefined) throw new Error('expected a continuation');

    // Not the retired `offset:N` shape, and no legible query: the payload
    // decodes to a fingerprint, an epoch, and a number only.
    expect(nextCursor).not.toMatch(/^offset:/);
    expect(nextCursor).not.toContain('FY27-Q3');
    const base64 = nextCursor.replaceAll('-', '+').replaceAll('_', '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))) as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(['at', 'o', 'q', 'v']);
    expect(payload.o).toBe(7);
    expect(payload.q).not.toContain('quarter');
    expect(payload.q).not.toContain('FY27-Q3');
    expect(payload.at).toBe(AS_OF);
  });
});
