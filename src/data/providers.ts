import type { DataProvider } from './DataProvider';
import { traceDataProvider } from './traceDataProvider';
import { instrumentProvider } from '../lib/telemetry/instrumentProvider';
import { MockDataProvider } from './mock/MockDataProvider';
import { ScaleDataProvider } from './mock/ScaleDataProvider';
import {
  createSimulatedRemoteProvider,
  type FailurePlanEntry,
} from './mock/createSimulatedRemoteProvider';

/**
 * The provider the app is wired to, switchable from the header.
 *
 * This selector is the demo's one piece of stagecraft, and it earns its place:
 * the abstraction's whole claim is that swapping the source behind the seam
 * changes nothing above it. Clicking through the three options is the claim
 * being performed rather than described — the same views, the same
 * components, three different answers arriving at three different speeds
 * through three different failure profiles.
 */
export type ProviderId = 'local' | 'remote' | 'scaled';

export interface ProviderOption {
  id: ProviderId;
  label: string;
  /** What the option demonstrates, in one line, shown under the header. */
  summary: string;
}

export const PROVIDER_OPTIONS: readonly ProviderOption[] = [
  {
    id: 'local',
    label: 'Local mock',
    summary:
      'The deterministic in-memory book. Every call resolves on the next microtask, which is fast and hides every loading state.',
  },
  {
    id: 'remote',
    label: 'Simulated remote',
    summary:
      'The same book behind ~250 ms round trips with a 15% simulated failure rate, so the per-widget loading, error, and retry paths are exercised rather than theoretical.',
  },
  {
    id: 'scaled',
    label: 'Scaled 100×',
    summary:
      '100 copies of the book: 2,500 partners, 21,300 opportunities, 191,000 weekly snapshot rows — about 45 MB of JSON, and ~87% of it snapshots. The scoped queries still return the same kilobytes (five aggregates, 25 rows a page) and the same latency, and there is no load-everything path left to degrade — which is the entire argument. The aggregation still runs in this tab, because the mock stands in for the server, so the queue of complaints is honest about what a real one would pre-compute.',
  },
];

export function providerOption(id: ProviderId): ProviderOption {
  return PROVIDER_OPTIONS.find((option) => option.id === id) ?? PROVIDER_OPTIONS[0]!;
}

/**
 * Demo and browser-test plumbing: `?remoteFailFirst=2` puts the simulated
 * remote on a deterministic positional failure plan — its first two calls
 * fail and everything after succeeds — so the provider-switch failure and
 * retry path can be exercised in a browser without depending on the seeded
 * draw. `?remoteFailMethods=getForecastSummary:2,listQuarterOpportunities:1` instead
 * fails the first N calls of each named method, which survives the readiness
 * probe: only the named widgets fail, so per-widget failure and focused retry
 * can be exercised past a committed provider. The three-part form
 * `?remoteFailMethods=listWeeklyClassificationMeetings:1:1` skips the first
 * call, then fails exactly one — the load-more failure a retained page has to
 * survive. Unset in normal use, and meaningless for the local and scaled
 * providers, which never fail.
 */
function scriptedRemoteFailures():
  | { failFirstCalls: number }
  | { failMethods: Partial<Record<keyof DataProvider, number | FailurePlanEntry>> }
  | undefined {
  if (typeof window === 'undefined') return undefined;
  const params = new URLSearchParams(window.location.search);
  const named = params.get('remoteFailMethods');
  if (named !== null) {
    const failMethods: Partial<Record<keyof DataProvider, number | FailurePlanEntry>> = {};
    for (const pair of named.split(',')) {
      const [method, first, second] = pair.split(':');
      // Two parts are `method:fail`; three are `method:skip:fail`.
      const skip = second === undefined ? 0 : Number.parseInt(first ?? '', 10);
      const count = Number.parseInt(second ?? first ?? '', 10);
      if (
        method !== undefined &&
        Number.isFinite(skip) &&
        skip >= 0 &&
        Number.isFinite(count) &&
        count > 0
      ) {
        failMethods[method as keyof DataProvider] = skip > 0 ? { skip, fail: count } : count;
      }
    }
    return { failMethods };
  }
  const raw = params.get('remoteFailFirst');
  if (raw === null) return undefined;
  const count = Number.parseInt(raw, 10);
  return Number.isFinite(count) && count > 0 ? { failFirstCalls: count } : undefined;
}

export function createProvider(id: ProviderId): DataProvider {
  let base: DataProvider;
  switch (id) {
    case 'remote': {
      const plan = scriptedRemoteFailures();
      // The answers crossing the simulated wire are the remote provider's:
      // their metadata is stamped accordingly, so a figure on screen can
      // never read as local data that arrived over the remote wire.
      base = createSimulatedRemoteProvider(new MockDataProvider(), {
        ...(plan ?? {}),
        providerId: 'remote',
      });
      break;
    }
    case 'scaled':
      base = new ScaleDataProvider();
      break;
    case 'local':
      base = new MockDataProvider();
      break;
  }
  // Every provider the header can select crosses the seam through both
  // wrappers. traceDataProvider creates the W3C trace context the underlying
  // provider receives — correlating the call in the log, and, for a real HTTP
  // provider, in its request headers — and instrumentProvider measures the
  // whole seam: one telemetry span, one counter, and one duration per call,
  // with failures captured under their span's trace context. The outer
  // wrapper is identity-safe — it delegates through a Proxy and adds nothing
  // to the contract — and the telemetry master flag can switch the
  // measurement off at runtime without unwiring the trace context.
  return instrumentProvider(traceDataProvider(base), id);
}
