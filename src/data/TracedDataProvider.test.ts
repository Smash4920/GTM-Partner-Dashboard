import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeProviderBook } from '../test/fixtures';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { TracedDataProvider } from './TracedDataProvider';
import { INTERNAL_DEMO_SCOPE } from './accessScope';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TracedDataProvider', () => {
  it('propagates W3C and request-id context across the provider seam', async () => {
    const inner: DataProvider = new MockDataProvider(makeProviderBook());
    const call = vi.spyOn(inner, 'getPartnerRoster');
    const provider = new TracedDataProvider(inner);

    await provider.getPartnerRoster(INTERNAL_DEMO_SCOPE, {});

    expect(call).toHaveBeenCalledOnce();
    const trace = call.mock.calls[0]?.[2]?.trace;
    expect(trace).toMatchObject({
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/),
      spanId: expect.stringMatching(/^[0-9a-f]{16}$/),
      requestId: expect.any(String),
      headers: {
        traceparent: expect.stringMatching(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/),
        'x-request-id': expect.any(String),
      },
    });
    expect(trace?.headers['x-request-id']).toBe(trace?.requestId);
  });

  it('passes the caller’s abort signal through untouched alongside the created trace', async () => {
    const inner: DataProvider = new MockDataProvider(makeProviderBook());
    const call = vi.spyOn(inner, 'getForecastSummary');
    const provider = new TracedDataProvider(inner);
    const controller = new AbortController();

    await provider.getForecastSummary(
      INTERNAL_DEMO_SCOPE,
      { quarter: 'FY27-Q3' },
      { signal: controller.signal },
    );

    const context = call.mock.calls[0]?.[2];
    expect(context?.signal).toBe(controller.signal);
    expect(context?.trace?.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });

  it('returns the underlying answer unchanged', async () => {
    const provider = new TracedDataProvider(new MockDataProvider(makeProviderBook()));
    const { data, meta } = await provider.getPartnerDirectory(INTERNAL_DEMO_SCOPE);
    expect(data).toEqual([{ id: 'partner-1', name: 'Northwind Systems' }]);
    expect(meta.providerId).toBe('local');
  });

  it('does not hide upstream failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('CRM timed out');
    const inner = new MockDataProvider(makeProviderBook());
    vi.spyOn(inner, 'getManagerDirectory').mockRejectedValue(failure);
    const provider = new TracedDataProvider(inner);

    await expect(provider.getManagerDirectory(INTERNAL_DEMO_SCOPE)).rejects.toBe(failure);
  });
});
