import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-mono/400.css';
import App from '../../../src/App';
import { DATA_PROVIDER_CONTEXT_SLOTS, type DataProvider } from '../../../src/data/DataProvider';
import { ScaleDataProvider } from '../../../src/data/mock/ScaleDataProvider';
import { createProvider } from '../../../src/data/providers';
import type { QueryContext } from '../../../src/data/queryContext';
import '../../../src/index.css';

declare global {
  interface Window {
    scaledRetryFixture: {
      scale: number;
      size: { partners: number; opportunities: number };
      calls: Record<string, number>;
      delegated: Record<string, number>;
      failures: Record<string, number>;
      signals: Record<string, number>;
      pending: number;
      armed: keyof DataProvider | null;
      arm: (method: keyof DataProvider) => void;
    };
  }
}

// Alternate build input only. Never replace records/results, serialize query
// arguments, alter signals, or route the failure through the remote simulator.
const inner = new ScaleDataProvider(100);
const fixture: Window['scaledRetryFixture'] = {
  scale: inner.scale,
  size: { partners: inner.size.partners, opportunities: inner.size.opportunities },
  calls: {},
  delegated: {},
  failures: {},
  signals: {},
  pending: 0,
  armed: null,
  arm(method) {
    if (!Object.hasOwn(DATA_PROVIDER_CONTEXT_SLOTS, method) || fixture.armed !== null) {
      throw new Error('Invalid fixture fault arm');
    }
    fixture.armed = method;
  },
};
const increment = (counts: Record<string, number>, method: string) =>
  (counts[method] = (counts[method] ?? 0) + 1);
const provider = new Proxy(inner, {
  get(target, prop) {
    const value: unknown = Reflect.get(target, prop);
    if (typeof prop !== 'string' || typeof value !== 'function') return value;
    return async (...args: unknown[]) => {
      increment(fixture.calls, prop);
      const context = args[DATA_PROVIDER_CONTEXT_SLOTS[prop as keyof DataProvider]] as
        QueryContext | undefined;
      if (context?.signal instanceof AbortSignal) increment(fixture.signals, prop);
      fixture.pending += 1;
      try {
        if (fixture.armed === prop) {
          fixture.armed = null;
          increment(fixture.failures, prop);
          throw new Error('fixture-query-unavailable');
        }
        increment(fixture.delegated, prop);
        // Use the real receiver and unchanged arguments, including context.
        return await (value as (...parameters: unknown[]) => unknown).apply(target, args);
      } finally {
        fixture.pending -= 1;
      }
    };
  },
});
window.scaledRetryFixture = fixture;
createRoot(document.getElementById('root')!).render(
  <App providerFactory={(id) => (id === 'scaled' ? provider : createProvider(id))} />,
);
