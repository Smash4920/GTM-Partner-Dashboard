import { describe, expect, it } from 'vitest';
import { ACTION_POLICY_FIELDS, DEFAULT_ACTION_POLICY, validateActionPolicy } from './actionPolicy';

describe('Demo Action Center policy', () => {
  it('uses the exact six approved defaults', () => {
    expect(Object.values(DEFAULT_ACTION_POLICY)).toEqual([400_000, 14, 60, 7, 28, 2]);
    expect(validateActionPolicy(DEFAULT_ACTION_POLICY)).toEqual({
      policy: DEFAULT_ACTION_POLICY,
      errors: {},
    });
    expect(Object.isFrozen(DEFAULT_ACTION_POLICY)).toBe(true);
  });

  it.each(['', ' ', 'no', 'NaN', 'Infinity', '-Infinity', '1.5', '0', '-1'])(
    'blocks %j for every field without producing an applied policy',
    (value) => {
      for (const { key } of ACTION_POLICY_FIELDS) {
        const result = validateActionPolicy({ ...DEFAULT_ACTION_POLICY, [key]: value });
        expect(result.policy).toBeUndefined();
        expect(result.errors).toEqual({ [key]: 'Enter a finite positive integer.' });
      }
    },
  );

  it.each([5, 100])('constrains deteriorating drivers to 1..4 (%s)', (value) => {
    expect(
      validateActionPolicy({ ...DEFAULT_ACTION_POLICY, minimumDeterioratingDrivers: value }),
    ).toEqual({ errors: { minimumDeterioratingDrivers: 'Enter an integer from 1 to 4.' } });
  });

  it('accepts trimmed numeric drafts and all driver boundary values', () => {
    for (const minimumDeterioratingDrivers of ['1', '4']) {
      expect(
        validateActionPolicy({
          ...DEFAULT_ACTION_POLICY,
          highValueAmount: ' 500000 ',
          minimumDeterioratingDrivers,
        }).policy,
      ).toEqual({
        ...DEFAULT_ACTION_POLICY,
        highValueAmount: 500_000,
        minimumDeterioratingDrivers: Number(minimumDeterioratingDrivers),
      });
    }
  });
});
