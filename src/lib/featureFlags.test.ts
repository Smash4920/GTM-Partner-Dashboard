import { beforeEach, describe, expect, it, vi } from 'vitest';
import { auditFlagLifecycle, FLAG_GOVERNANCE_AS_OF, type FlagLifecycle } from './flagGovernance';
import {
  createFailSafeEvaluator,
  createFeatureFlagClient,
  createFeatureFlagSubjectProvider,
  FEATURE_FLAG_DEFINITIONS,
  FLAG_CACHE_MAX_AGE_MS,
  featureFlagBucket,
  type FeatureFlagEvaluation,
  type FeatureFlagKey,
  type FlagSourceOutcome,
} from './featureFlags';

const GOVERNANCE_AS_OF = new Date(FLAG_GOVERNANCE_AS_OF);

function validLifecycle(): FlagLifecycle {
  return {
    owner: 'GTM platform',
    purpose: 'Gates the example feature while its staged rollout is verified.',
    environments: ['development', 'preview', 'production'],
    safeDefault: false,
    rolloutTrigger: 'Raise rollout once staging error rates stay flat for a week.',
    rollbackTrigger: 'Return to the safe default on any elevated error rate.',
    reviewDate: '2026-12-31',
    expiresAt: '2027-03-31',
    removalCondition: 'Delete the flag once the guarded path is the only path.',
  };
}

function auditDraft(lifecycle: Partial<FlagLifecycle>, asOf: Date = GOVERNANCE_AS_OF) {
  return auditFlagLifecycle([{ key: 'example.flag', lifecycle }], asOf);
}

describe('product flag registry lifecycle policy', () => {
  it('enumerates every product flag with complete lifecycle metadata', () => {
    const keys = Object.keys(FEATURE_FLAG_DEFINITIONS) as FeatureFlagKey[];
    expect(keys).toEqual(['productionRequirements']);

    const violations = auditFlagLifecycle(
      keys.map((key) => ({ key, lifecycle: FEATURE_FLAG_DEFINITIONS[key].lifecycle })),
      GOVERNANCE_AS_OF,
    );

    expect(violations).toEqual([]);
  });

  it.each([
    ['owner', { owner: '' }],
    ['owner', { owner: undefined }],
    ['purpose', { purpose: '' }],
    ['purpose', { purpose: undefined }],
    ['environments', { environments: [] }],
    ['environments', { environments: undefined }],
    ['safeDefault', { safeDefault: undefined }],
    ['rolloutTrigger', { rolloutTrigger: '' }],
    ['rollbackTrigger', { rollbackTrigger: undefined }],
    ['removalCondition', { removalCondition: '  ' }],
  ] as const)('fails deterministically when %s is missing', (field, patch) => {
    const violations = auditDraft({ ...validLifecycle(), ...patch });

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ flagKey: 'example.flag', field });
  });

  it('rejects unparseable review and expiry dates', () => {
    expect(auditDraft({ ...validLifecycle(), reviewDate: 'soon' })).toEqual([
      expect.objectContaining({ field: 'reviewDate' }),
    ]);
    expect(auditDraft({ ...validLifecycle(), expiresAt: 'eventually' })).toEqual([
      expect.objectContaining({ field: 'expiresAt' }),
    ]);
  });

  it('rejects dates Date.parse accepts but ISO 8601 does not', () => {
    // Prose and slash forms parse fine in V8 but are not ISO 8601; an
    // impossible day rolls over silently. All must fail the date check.
    for (const bad of ['December 31, 2026', '2026/12/31', '2026-02-30']) {
      expect(auditDraft({ ...validLifecycle(), expiresAt: bad })).toEqual([
        expect.objectContaining({ field: 'expiresAt' }),
      ]);
    }
    // Offset-less times parse in the local timezone, so they are rejected as
    // non-deterministic; the UTC form is the accepted timestamp.
    expect(auditDraft({ ...validLifecycle(), reviewDate: '2026-12-31T00:00:00' })).toEqual([
      expect.objectContaining({ field: 'reviewDate' }),
    ]);
    expect(auditDraft({ ...validLifecycle(), reviewDate: '2026-12-31T00:00:00.000Z' })).toEqual([]);
  });

  it('rejects an expired flag at the governance date', () => {
    const violations = auditDraft({
      ...validLifecycle(),
      reviewDate: '2026-06-01',
      expiresAt: '2026-09-01',
    });

    expect(violations).toEqual([
      expect.objectContaining({ field: 'expiresAt', problem: expect.stringContaining('expired') }),
    ]);
  });

  it('accepts the same flag before its expiry — the check is clock-injected', () => {
    const violations = auditDraft(
      { ...validLifecycle(), reviewDate: '2026-06-01', expiresAt: '2026-09-01' },
      new Date('2026-01-01T00:00:00.000Z'),
    );

    expect(violations).toEqual([]);
  });

  it('rejects a review scheduled after the flag expires', () => {
    const violations = auditDraft({
      ...validLifecycle(),
      reviewDate: '2027-06-01',
      expiresAt: '2027-03-31',
    });

    expect(violations).toEqual([expect.objectContaining({ field: 'reviewDate' })]);
  });
});

const FRESH_ON: FlagSourceOutcome = {
  kind: 'value',
  enabled: true,
  via: 'environment-override',
};
const FRESH_OFF: FlagSourceOutcome = {
  kind: 'value',
  enabled: false,
  via: 'environment-override',
};

/**
 * A fail-safe evaluator driven by a scripted source and an injected clock, so
 * every cache-age decision is exact. The default max age is 500ms here to
 * keep the arithmetic small; the shipped default is FLAG_CACHE_MAX_AGE_MS.
 */
function createHarness(maxCacheAgeMs = 500) {
  let now = 10_000;
  const queue: FlagSourceOutcome[] = [];
  const evaluator = createFailSafeEvaluator(() => queue.shift() ?? { kind: 'unavailable' }, {
    now: () => now,
    maxCacheAgeMs,
  });
  return {
    evaluator,
    push: (...outcomes: FlagSourceOutcome[]) => queue.push(...outcomes),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('fail-safe evaluation policy', () => {
  it('uses the registry safe default on cold start, before any value exists', () => {
    const { evaluator } = createHarness();

    expect(evaluator.evaluate('productionRequirements')).toEqual({
      enabled: true,
      source: 'safe-default',
      cause: 'unavailable',
      cache: 'absent',
    });
  });

  it('uses a fresh valid value and records it as last known good', () => {
    const { evaluator, push } = createHarness();
    push(FRESH_OFF);

    expect(evaluator.evaluate('productionRequirements')).toEqual({
      enabled: false,
      source: 'fresh',
      cause: 'environment-override',
      cache: 'recorded',
    });
  });

  it.each([
    ['timeout', { kind: 'timeout' }],
    ['unavailable', { kind: 'unavailable' }],
    ['malformed', { kind: 'malformed' }],
  ] as const)(
    'serves the bounded last-known-good value on %s within the maximum age',
    (cause, outcome) => {
      const { evaluator, push, advance } = createHarness();
      push(FRESH_OFF);
      evaluator.evaluate('productionRequirements');

      advance(200);
      push(outcome);

      expect(evaluator.evaluate('productionRequirements')).toEqual({
        enabled: false,
        source: 'last-known-good',
        cause,
        cache: 'used',
        cacheAgeMs: 200,
      });
    },
  );

  it('serves the cache at exactly the shipped maximum age and the safe default one tick later', () => {
    const { evaluator, push, advance } = createHarness(FLAG_CACHE_MAX_AGE_MS);
    push(FRESH_OFF);
    evaluator.evaluate('productionRequirements');

    advance(FLAG_CACHE_MAX_AGE_MS);
    push({ kind: 'timeout' });
    const atBound: FeatureFlagEvaluation = evaluator.evaluate('productionRequirements');
    expect(atBound).toEqual({
      enabled: false,
      source: 'last-known-good',
      cause: 'timeout',
      cache: 'used',
      cacheAgeMs: FLAG_CACHE_MAX_AGE_MS,
    });

    push(FRESH_OFF);
    evaluator.evaluate('productionRequirements');
    advance(FLAG_CACHE_MAX_AGE_MS + 1);
    push({ kind: 'unavailable' });
    expect(evaluator.evaluate('productionRequirements')).toEqual({
      enabled: true,
      source: 'safe-default',
      cause: 'unavailable',
      cache: 'stale',
      cacheAgeMs: FLAG_CACHE_MAX_AGE_MS + 1,
    });
  });

  it('uses the safe default when the source fails before any value was cached', () => {
    const { evaluator, push } = createHarness();
    push({ kind: 'timeout' });

    expect(evaluator.evaluate('productionRequirements')).toEqual({
      enabled: true,
      source: 'safe-default',
      cause: 'timeout',
      cache: 'absent',
    });
  });

  it('replaces the cache on recovery and serves the new value afterwards', () => {
    const { evaluator, push, advance } = createHarness();
    push(FRESH_OFF);
    evaluator.evaluate('productionRequirements');
    advance(600);
    push({ kind: 'timeout' });
    expect(evaluator.evaluate('productionRequirements').source).toBe('safe-default');

    // Recovery: a fresh valid value is used immediately and replaces the cache.
    push(FRESH_ON);
    expect(evaluator.evaluate('productionRequirements')).toEqual({
      enabled: true,
      source: 'fresh',
      cause: 'environment-override',
      cache: 'recorded',
    });

    advance(100);
    push({ kind: 'unavailable' });
    expect(evaluator.evaluate('productionRequirements')).toEqual({
      enabled: true,
      source: 'last-known-good',
      cause: 'unavailable',
      cache: 'used',
      cacheAgeMs: 100,
    });
  });
});

describe('environment-backed evaluation', () => {
  it('uses the safe default when no configuration is present', () => {
    const result = createFeatureFlagClient({}).evaluate('productionRequirements');

    expect(result).toEqual({
      enabled: true,
      source: 'safe-default',
      cause: 'unavailable',
      cache: 'absent',
    });
  });

  it.each([
    ['true', true],
    ['ON', true],
    ['0', false],
    [' false ', false],
  ])('honors the %s environment override as a fresh value', (configured, enabled) => {
    const result = createFeatureFlagClient({
      VITE_FEATURE_PRODUCTION_REQUIREMENTS: configured,
      VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '0',
    }).evaluate('productionRequirements', { subjectKey: 'cohort-fixture' });

    expect(result).toEqual({
      enabled,
      source: 'fresh',
      cause: 'environment-override',
      cache: 'recorded',
    });
  });

  it('treats an unparsable override or rollout as malformed and fails safe', () => {
    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS: 'sometimes',
      }).evaluate('productionRequirements'),
    ).toEqual({ enabled: true, source: 'safe-default', cause: 'malformed', cache: 'absent' });

    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '101',
      }).evaluate('productionRequirements'),
    ).toEqual({ enabled: true, source: 'safe-default', cause: 'malformed', cache: 'absent' });
    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '10.5',
      }).evaluate('productionRequirements'),
    ).toEqual({ enabled: true, source: 'safe-default', cause: 'malformed', cache: 'absent' });
  });

  it('assigns a subject to a deterministic percentage cohort', () => {
    const subjectKey = 'cohort-fixture';
    const bucket = featureFlagBucket('productionRequirements', subjectKey);

    expect(featureFlagBucket('productionRequirements', subjectKey)).toBe(bucket);
    expect(bucket).toBeGreaterThanOrEqual(0);
    expect(bucket).toBeLessThan(100);
    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: String(bucket),
      }).isEnabled('productionRequirements', { subjectKey }),
    ).toBe(false);
    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: String(bucket + 1),
      }).evaluate('productionRequirements', { subjectKey }),
    ).toEqual({
      enabled: true,
      source: 'fresh',
      cause: 'percentage-rollout',
      cache: 'recorded',
      rolloutPercentage: bucket + 1,
    });
  });

  it('fails safe instead of making an unstable rollout decision without a subject', () => {
    const result = createFeatureFlagClient({
      VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '0',
    }).evaluate('productionRequirements');

    expect(result).toEqual({
      enabled: true,
      source: 'safe-default',
      cause: 'missing-subject',
      cache: 'absent',
      rolloutPercentage: 0,
    });
  });

  it('recovers through the environment source: fresh, bounded cache, stale, recovery', () => {
    let now = 50_000;
    const environment: Record<string, string> = {
      VITE_FEATURE_PRODUCTION_REQUIREMENTS: 'false',
    };
    const client = createFeatureFlagClient(environment, {
      now: () => now,
      maxCacheAgeMs: 1_000,
    });

    expect(client.isEnabled('productionRequirements')).toBe(false);

    // The configured value vanishes (e.g. a bad deploy): the bounded cache holds.
    delete environment.VITE_FEATURE_PRODUCTION_REQUIREMENTS;
    now += 400;
    expect(client.evaluate('productionRequirements')).toEqual({
      enabled: false,
      source: 'last-known-good',
      cause: 'unavailable',
      cache: 'used',
      cacheAgeMs: 400,
    });

    // Past the bound, the safe default takes over.
    now += 601;
    expect(client.evaluate('productionRequirements')).toEqual({
      enabled: true,
      source: 'safe-default',
      cause: 'unavailable',
      cache: 'stale',
      cacheAgeMs: 1001,
    });

    // Recovery: the next valid configuration is used and re-arms the cache.
    environment.VITE_FEATURE_PRODUCTION_REQUIREMENTS = 'false';
    expect(client.evaluate('productionRequirements').source).toBe('fresh');
    delete environment.VITE_FEATURE_PRODUCTION_REQUIREMENTS;
    now += 10;
    expect(client.evaluate('productionRequirements')).toEqual({
      enabled: false,
      source: 'last-known-good',
      cause: 'unavailable',
      cache: 'used',
      cacheAgeMs: 10,
    });
  });
});

describe('authorization invariance', () => {
  it('never alters demo access scope or returned row ids in any evaluator state', () => {
    // Representative demo scope and rows. The evaluator API has no scope,
    // role, or partner parameter — this test pins that no evaluator state can
    // change which rows a scope returns. The typed DemoAccessScope contract
    // lands with the scoped provider migration; the invariant must already
    // hold for the filtering it will govern.
    const scope = { audience: 'partner', partnerId: 'partner-1' } as const;
    const rows = [
      { id: 'row-1', partnerId: 'partner-1' },
      { id: 'row-2', partnerId: 'partner-2' },
      { id: 'row-3', partnerId: 'partner-1' },
    ];
    const visibleRowIds = () =>
      rows.filter((row) => row.partnerId === scope.partnerId).map((row) => row.id);

    const baseline = visibleRowIds();
    const { evaluator, push, advance } = createHarness();
    const states: FlagSourceOutcome[] = [
      FRESH_ON,
      FRESH_OFF,
      { kind: 'timeout' },
      { kind: 'unavailable' },
      { kind: 'malformed' },
    ];

    for (const outcome of states) {
      push(outcome);
      const evaluation = evaluator.evaluate('productionRequirements');
      advance(100);

      expect(visibleRowIds()).toEqual(baseline);
      expect(scope).toEqual({ audience: 'partner', partnerId: 'partner-1' });
      expect(evaluation).not.toHaveProperty('role');
      expect(evaluation).not.toHaveProperty('scope');
      expect(evaluation).not.toHaveProperty('partnerId');
    }

    // A disabled flag hides a route; it can never widen the visible row set.
    push(FRESH_OFF, { kind: 'timeout' });
    evaluator.evaluate('productionRequirements');
    advance(50);
    evaluator.evaluate('productionRequirements');
    expect(visibleRowIds()).toEqual(['row-1', 'row-3']);
  });
});

describe('feature flag subject', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('creates and reuses an opaque browser subject', () => {
    const getSubject = createFeatureFlagSubjectProvider(window.localStorage, () => 'anonymous-123');

    expect(getSubject()).toBe('anonymous-123');
    expect(getSubject()).toBe('anonymous-123');
  });

  it('keeps a page-scoped subject when storage is unavailable', () => {
    const blockedStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };

    const getSubject = createFeatureFlagSubjectProvider(blockedStorage, () => 'page-subject');
    const first = getSubject();
    const second = getSubject();

    expect(first).toBe('page-subject');
    expect(second).toBe(first);
  });
});
