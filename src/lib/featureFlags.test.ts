import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFeatureFlagClient,
  createFeatureFlagSubjectProvider,
  featureFlagBucket,
} from './featureFlags';

describe('feature flag client', () => {
  it('uses the safe default when no configuration is present', () => {
    const result = createFeatureFlagClient({}).evaluate('productionRequirements');

    expect(result).toEqual({ enabled: true, reason: 'default' });
  });

  it.each([
    ['true', true],
    ['ON', true],
    ['0', false],
    [' false ', false],
  ])('honors the %s environment override', (configured, enabled) => {
    const result = createFeatureFlagClient({
      VITE_FEATURE_PRODUCTION_REQUIREMENTS: configured,
      VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '0',
    }).evaluate('productionRequirements', { subjectKey: 'cohort-fixture' });

    expect(result).toEqual({ enabled, reason: 'environment-override' });
  });

  it('keeps the default when an override or rollout is invalid', () => {
    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS: 'sometimes',
      }).evaluate('productionRequirements'),
    ).toEqual({ enabled: true, reason: 'invalid-configuration' });

    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '101',
      }).evaluate('productionRequirements'),
    ).toEqual({ enabled: true, reason: 'invalid-configuration' });
    expect(
      createFeatureFlagClient({
        VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '10.5',
      }).evaluate('productionRequirements'),
    ).toEqual({ enabled: true, reason: 'invalid-configuration' });
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
      reason: 'percentage-rollout',
      rolloutPercentage: bucket + 1,
    });
  });

  it('does not make an unstable rollout decision without a subject', () => {
    const result = createFeatureFlagClient({
      VITE_FEATURE_PRODUCTION_REQUIREMENTS_ROLLOUT: '0',
    }).evaluate('productionRequirements');

    expect(result).toEqual({
      enabled: true,
      reason: 'missing-subject',
      rolloutPercentage: 0,
    });
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
