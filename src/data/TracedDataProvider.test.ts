import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeProviderBook } from '../test/fixtures';
import type { DataProvider } from './DataProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { TracedDataProvider } from './TracedDataProvider';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TracedDataProvider', () => {
  it('propagates W3C and request-id context across the provider seam', async () => {
    const inner: DataProvider = new MockDataProvider(makeProviderBook());
    const call = vi.spyOn(inner, 'listPartners');
    const provider = new TracedDataProvider(inner);

    await provider.listPartners();

    expect(call).toHaveBeenCalledOnce();
    const trace = call.mock.calls[0]?.[0];
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

  it('returns the underlying answer unchanged', async () => {
    const provider = new TracedDataProvider(new MockDataProvider(makeProviderBook()));
    await expect(provider.getPartnerDirectory()).resolves.toEqual([
      { id: 'partner-1', name: 'Northwind Systems' },
    ]);
  });

  it('does not hide upstream failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('CRM timed out');
    const inner = new MockDataProvider(makeProviderBook());
    vi.spyOn(inner, 'getTargets').mockRejectedValue(failure);
    const provider = new TracedDataProvider(inner);

    await expect(provider.getTargets()).rejects.toBe(failure);
  });
});
