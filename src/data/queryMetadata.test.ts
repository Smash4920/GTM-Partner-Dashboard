import { describe, expect, it } from 'vitest';
import {
  buildQueryMeta,
  queryResult,
  unattributedOpportunitiesWarning,
  weeklyHistoryReconstructedWarning,
} from './queryMetadata';

/**
 * VAL-DATA-006, contract half: the envelope every scoped answer travels in.
 * The provider-side behavior is pinned in MockDataProvider.test.ts; the
 * rendered states are pinned in src/views/queryStates.test.tsx.
 */
describe('buildQueryMeta', () => {
  const base = {
    providerId: 'local',
    asOf: '2026-09-18T00:00:00.000Z',
    lineage: [{ source: 'mock-book' as const, description: 'Deterministic seeded book' }],
  };

  it('marks a warning-free answer complete', () => {
    const meta = buildQueryMeta(base);
    expect(meta).toEqual({
      providerId: 'local',
      asOf: '2026-09-18T00:00:00.000Z',
      lineage: [{ source: 'mock-book', description: 'Deterministic seeded book' }],
      completeness: 'complete',
      warnings: [],
    });
  });

  it('derives partial completeness from the warnings, never separately', () => {
    const meta = buildQueryMeta({ ...base, warnings: [unattributedOpportunitiesWarning(2)] });
    expect(meta.completeness).toBe('partial');
    expect(meta.warnings).toHaveLength(1);
  });

  it('carries the committed provider identity and the deterministic as-of verbatim', () => {
    const meta = buildQueryMeta({ ...base, providerId: 'remote' });
    expect(meta.providerId).toBe('remote');
    // ISO, parseable, and exactly what the caller stamped — the mock never
    // reads the wall clock for this.
    expect(meta.asOf).toBe('2026-09-18T00:00:00.000Z');
    expect(Number.isNaN(Date.parse(meta.asOf))).toBe(false);
  });
});

describe('queryResult', () => {
  it('pairs the answer with its metadata untouched', () => {
    const meta = buildQueryMeta({
      providerId: 'scaled',
      asOf: '2026-09-18T00:00:00.000Z',
      lineage: [],
    });
    const result = queryResult({ total: 42 }, meta);
    expect(result.data).toEqual({ total: 42 });
    expect(result.meta).toBe(meta);
  });
});

describe('data warnings', () => {
  it('describes reconstructed weekly history with exact counts', () => {
    expect(weeklyHistoryReconstructedWarning(3, 7)).toEqual({
      code: 'weekly-history-reconstructed',
      message:
        '3 of 7 closed weeks were reconstructed from the current book; no recorded snapshot exists for them',
    });
  });

  it('describes unattributed opportunities with an exact count', () => {
    expect(unattributedOpportunitiesWarning(1).message).toContain('1 in-quarter opportunity');
    expect(unattributedOpportunitiesWarning(4)).toEqual({
      code: 'unattributed-opportunities',
      message:
        '4 in-quarter opportunities could not be attributed to a partner manager and are missing from the manager groups',
    });
  });
});
