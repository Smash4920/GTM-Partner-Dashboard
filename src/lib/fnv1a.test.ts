import { describe, expect, it } from 'vitest';
import { createCursorIssuer } from '../data/pagination';
import { INTERNAL_DEMO_SCOPE } from '../data/accessScope';
import { CURRENT_FISCAL_QUARTER } from '../data/constants';
import { MockDataProvider } from '../data/mock/MockDataProvider';
import { createSimulatedRemoteProvider } from '../data/mock/createSimulatedRemoteProvider';
import { mulberry32 } from '../data/mock/rng';
import { fingerprintError } from './telemetry/errors';
import { fnv1a } from './fnv1a';

/** Pre-extraction cursor/method fold: signed intermediates, unsigned result. */
function legacySignedMix(text: string, state = 0x811c9dc5): number {
  let hash = state;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Pre-extraction telemetry fold: unsigned after every multiplication. */
function legacyUnsignedMix(text: string, state = 0x811c9dc5): number {
  let hash = state;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const STATES = [0, -0, 1, -1, 0x7fffffff, -0x80000000, 0xffffffff, 0x811c9dc5, 0x100000001];
const TEXTS = [
  '',
  'hello',
  '\0',
  '\uffff',
  'é',
  'e\u0301',
  '漢字',
  '🚀',
  '\ud800',
  '\udfff',
  '\ud800x\udfff',
  '\udfff\ud800',
  '\ud800\udfff',
  'a\0🚀\ud800漢字'.repeat(512),
];

describe('UTF-16 FNV-1a compatibility', () => {
  it('preserves empty, Unicode, lone-surrogate and zero-state folds', () => {
    for (const state of STATES) {
      for (const text of TEXTS) {
        expect(fnv1a(text, state)).toBe(legacySignedMix(text, state));
        expect(fnv1a(text, state)).toBe(legacyUnsignedMix(text, state));
        // Method seeds XOR the fold with the caller seed before conversion.
        expect((state ^ fnv1a(text)) >>> 0).toBe((state ^ legacySignedMix(text)) >>> 0);
      }
    }
  });

  it.each(STATES)('matches both legacy loops for every UTF-16 code unit from state %s', (state) => {
    let mismatches = 0;
    for (let codeUnit = 0; codeUnit <= 0xffff; codeUnit += 1) {
      const unit = String.fromCharCode(codeUnit);
      for (const text of [unit, `${unit}\0🚀${unit}`]) {
        const actual = fnv1a(text, state);
        if (actual !== legacySignedMix(text, state) || actual !== legacyUnsignedMix(text, state)) {
          mismatches += 1;
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it('continues across every split, including inside an astral surrogate pair', () => {
    for (const text of TEXTS) {
      for (let split = 0; split <= text.length; split += 1) {
        expect(fnv1a(text.slice(split), fnv1a(text.slice(0, split), 0))).toBe(fnv1a(text, 0));
      }
    }
    expect(fnv1a('🚀')).toBe(legacyUnsignedMix('\ud83d\ude80'));
    expect(fnv1a('🚀')).not.toBe(legacyUnsignedMix('\ud83d'));
  });
});

describe('pre-extraction public hash outputs', () => {
  it.each([
    {
      secret: 'pagination-test-issuer',
      queryKey: 'listQuarterOpportunities|access:internal:org|quarter:FY27-Q3|manager:all',
      cursor:
        'eyJ2IjoxLCJxIjoiNjFmNzNlYjQiLCJhdCI6IjIwMjYtMDktMThUMDA6MDA6MDAuMDAwWiIsIm8iOjcsInMiOiI4eXd5czAifQ',
    },
    {
      secret: 'issuer\0\ud800🚀',
      queryKey: 'scope|é|e\u0301|漢字|🚀|\ud800|\udfff',
      cursor:
        'eyJ2IjoxLCJxIjoiOWI2MzNjNGYiLCJhdCI6IjIwMjYtMDktMThUMDA6MDA6MDAuMDAwWiIsIm8iOjcsInMiOiIxdDcwcGEwIn0',
    },
    {
      secret: '',
      queryKey: '',
      cursor:
        'eyJ2IjoxLCJxIjoiODExYzlkYzUiLCJhdCI6IjIwMjYtMDktMThUMDA6MDA6MDAuMDAwWiIsIm8iOjcsInMiOiJlaWtqcW4ifQ',
    },
  ])('preserves byte-exact minted cursor for $queryKey', ({ secret, queryKey, cursor }) => {
    const issuer = createCursorIssuer(secret);
    expect(issuer.mint({ queryKey, asOf: '2026-09-18T00:00:00.000Z', offset: 7 })).toBe(cursor);
    expect(issuer.open(cursor)).toMatchObject({ at: '2026-09-18T00:00:00.000Z', o: 7 });
  });

  it.each([
    { name: 'Error', message: 'CRM is down', expected: 'cb8ed289' },
    { name: '', message: '', expected: 'f90c4a3b' },
    { name: 'Error', message: 'é e\u0301 漢字 🚀 \ud800 \udfff', expected: 'b7f82699' },
    {
      name: 'TypeError',
      message: 'ignored',
      stack:
        'TypeError: bad\n    at run (https://cdn.test/assets/index.js:1:2345)\n    at 🚀 (file.js:3:9)\n\n\ud800:7:2\nnext:8:3\nignored:1:2',
      expected: '7c9080aa',
    },
    { name: 'Error', message: 'fallback\0', stack: ' \n\t', expected: '09177f7f' },
  ])('preserves exact fingerprint $expected', ({ name, message, stack, expected }) => {
    expect(fingerprintError(name, message, stack)).toBe(expected);
  });

  it.each([0, 7, 11, -1, 20260918])(
    'preserves per-method seeded failure streams with interleaving for seed %s',
    async (seed) => {
      const inner = new MockDataProvider();
      const provider = createSimulatedRemoteProvider(inner, {
        latencyMs: 0,
        failureRate: 0.5,
        seed,
      });
      const methods = ['getManagerDirectory', 'getPartnerDirectory', 'getForecastSummary'] as const;
      const streams = methods.map((method) => mulberry32((seed ^ legacySignedMix(method)) >>> 0));
      const actual: boolean[][] = methods.map(() => []);
      const expected: boolean[][] = methods.map(() => []);
      for (let call = 0; call < 12; call += 1) {
        for (const [index, method] of methods.entries()) {
          const random = streams[index]!;
          random(); // The jitter draw precedes the failure draw even at zero latency.
          expected[index]!.push(random() >= 0.5);
          const pending =
            method === 'getForecastSummary'
              ? provider.getForecastSummary(INTERNAL_DEMO_SCOPE, {
                  quarter: CURRENT_FISCAL_QUARTER,
                })
              : provider[method](INTERNAL_DEMO_SCOPE);
          const result = await pending.then(
            () => true,
            () => false,
          );
          actual[index]!.push(result);
        }
      }
      expect(actual).toEqual(expected);
      if (seed === 0) {
        expect(actual[0]).toEqual([
          false,
          false,
          false,
          false,
          true,
          true,
          true,
          false,
          false,
          true,
          false,
          true,
        ]);
      }
    },
  );
});
