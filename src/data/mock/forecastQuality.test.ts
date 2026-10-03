import { describe, expect, it, vi } from 'vitest';
import { makeOpportunity, makePartner, makeProviderBook } from '../../test/fixtures';
import { INTERNAL_DEMO_SCOPE } from '../accessScope';
import type { DataProvider, MismatchRow } from '../DataProvider';
import { ForecastQualitySampleSizeError, MAX_FORECAST_QUALITY_SAMPLE_SIZE } from '../DataProvider';
import { CURRENT_FISCAL_QUARTER } from '../constants';
import { traceDataProvider } from '../traceDataProvider';
import { createSimulatedRemoteProvider } from './createSimulatedRemoteProvider';
import { MockDataProvider } from './MockDataProvider';
import { ScaleDataProvider } from './ScaleDataProvider';

const quarter = CURRENT_FISCAL_QUARTER;
const above = Array.from({ length: 15 }, (_, index) =>
  makeOpportunity({
    id: `above-${index}`,
    forecastCategory: 'commit',
    forecastedRevenue: index + 1,
  }),
);
const below = Array.from({ length: 15 }, (_, index) =>
  makeOpportunity({
    id: `below-${index}`,
    stage: 'vendor-of-choice',
    forecastCategory: 'long-shot',
    forecastedRevenue: (index + 1) * 10,
  }),
);
const opportunities = [
  ...above.flatMap((row, index) => [row, below[index]!]),
  makeOpportunity({ id: 'agrees', forecastCategory: 'pipeline' }),
];
const book = {
  ...makeProviderBook(),
  get opportunities() {
    return opportunities;
  },
};
const inner = new MockDataProvider(book);
const remote = createSimulatedRemoteProvider(inner, { latencyMs: 0, failureRate: 0 });
const PROVIDERS: [string, DataProvider, string][] = [
  ['mock', inner, 'local'],
  ['traced mock', traceDataProvider(inner), 'local'],
  ['remote', remote, 'remote'],
  ['traced remote', traceDataProvider(remote), 'remote'],
  [
    'remote traced mock',
    createSimulatedRemoteProvider(traceDataProvider(inner), {
      latencyMs: 0,
      failureRate: 0,
    }),
    'remote',
  ],
];
const INVALID_SIZES = [
  Number.NaN,
  Infinity,
  -Infinity,
  1.5,
  Number.MIN_VALUE,
  0,
  -1,
  -10,
  11,
  1_000_000,
];

function sampleRows(size: number): MismatchRow[] {
  return [
    ...above.slice(0, size).map((row) => ({
      opportunityId: row.id,
      accountName: row.accountName,
      stage: row.stage,
      forecastedRevenue: row.forecastedRevenue,
      called: 'commit' as const,
      fromStage: 'pipeline' as const,
      direction: 'above' as const,
    })),
    ...below.slice(0, size).map((row) => ({
      opportunityId: row.id,
      accountName: row.accountName,
      stage: row.stage,
      forecastedRevenue: row.forecastedRevenue,
      called: 'long-shot' as const,
      fromStage: 'commit' as const,
      direction: 'below' as const,
    })),
  ];
}

describe.each(PROVIDERS)(
  'forecast-quality sample contract through %s',
  (_name, provider, providerId) => {
    it.each([1, 3, 6, 10])(
      'preserves full-set counts, order and metadata for size %s',
      async (size) => {
        const result = await provider.getForecastQuality(INTERNAL_DEMO_SCOPE, { quarter }, size);
        expect(result.data).toEqual({
          openCount: 31,
          aboveCount: 15,
          aboveValue: 120,
          belowCount: 15,
          belowValue: 1_200,
          sample: sampleRows(size),
        });
        const summary = await inner.getForecastSummary(INTERNAL_DEMO_SCOPE, { quarter });
        expect(result.meta).toEqual({ ...summary.meta, providerId });
      },
    );

    it.each(INVALID_SIZES)(
      'rejects size %s before reading the aggregation inputs',
      async (size) => {
        const read = vi.spyOn(book, 'opportunities', 'get');
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const error = await provider
            .getForecastQuality(INTERNAL_DEMO_SCOPE, { quarter }, size)
            .catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(ForecastQualitySampleSizeError);
          expect(error).toMatchObject({
            name: 'ForecastQualitySampleSizeError',
            code: 'invalid-forecast-quality-sample-size',
            message: 'Forecast-quality sample size must be a positive integer of at most 10',
          });
          expect(read).not.toHaveBeenCalled();
        } finally {
          read.mockRestore();
          log.mockRestore();
        }
      },
    );
  },
);

describe('VAL-DATA-010: forecast-quality fixed bounds at 1× and 100×', () => {
  it('pins the forecast-specific maximum independently of page and SLA limits', () => {
    expect(MAX_FORECAST_QUALITY_SAMPLE_SIZE).toBe(10);
  });
  it.each([1, 100])(
    'caps each direction at ten on the %s× book without changing totals',
    async (scale) => {
      const provider = new ScaleDataProvider(scale, book);
      const result = await provider.getForecastQuality(INTERNAL_DEMO_SCOPE, { quarter }, 10);
      expect(result.data).toMatchObject({
        openCount: 31 * scale,
        aboveCount: 15 * scale,
        aboveValue: 120 * scale,
        belowCount: 15 * scale,
        belowValue: 1_200 * scale,
      });
      expect(result.data.sample).toEqual(sampleRows(10));
      expect(result.data.sample.filter((row) => row.direction === 'above')).toHaveLength(10);
      expect(result.data.sample.filter((row) => row.direction === 'below')).toHaveLength(10);
      expect(JSON.stringify(result).length).toBeLessThan(6_000);
      for (const size of INVALID_SIZES) {
        await expect(
          provider.getForecastQuality(INTERNAL_DEMO_SCOPE, { quarter }, size),
        ).rejects.toMatchObject({
          name: 'ForecastQualitySampleSizeError',
          code: 'invalid-forecast-quality-sample-size',
        });
      }
    },
  );

  it('applies access, manager, quarter and open-state filters before sampling', async () => {
    const provider = new MockDataProvider(
      makeProviderBook({
        partners: [makePartner(), makePartner({ id: 'other', partnerManagerId: 'pm-2' })],
        opportunities: [
          makeOpportunity({ id: 'other-manager', partnerId: 'other', forecastCategory: 'commit' }),
          makeOpportunity({ id: 'sell-to', oppType: 'sell-to', forecastCategory: 'commit' }),
          makeOpportunity({ id: 'closed', outcome: 'won', closedAt: '2026-09-01T00:00:00.000Z' }),
          makeOpportunity({ id: 'outside', expectedCloseDate: '2027-01-01T00:00:00.000Z' }),
          ...opportunities,
        ],
      }),
    );
    const partner = await provider.getForecastQuality(
      { audience: 'partner', partnerId: 'partner-1' },
      { quarter },
      3,
    );
    expect(partner.data).toEqual({
      openCount: 31,
      aboveCount: 15,
      aboveValue: 120,
      belowCount: 15,
      belowValue: 1_200,
      sample: sampleRows(3),
    });
    const manager = await provider.getForecastQuality(
      INTERNAL_DEMO_SCOPE,
      { quarter, partnerManagerId: 'pm-1' },
      3,
    );
    expect(manager.data.openCount).toBe(32);
    expect(manager.data.aboveCount).toBe(16);
    expect(manager.data.sample[0]!.opportunityId).toBe('sell-to');
  });
});
