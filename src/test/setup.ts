import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { logger } from '../lib/logging';
// Registers the DOM matchers against vitest's `expect` and augments its
// Assertion type. This entry point imports `expect` directly, so it works
// without turning on `globals` — the existing suites import describe/it/expect
// explicitly and there is no reason to make two styles valid at once.
import '@testing-library/jest-dom/vitest';

// Auto-cleanup ships with Testing Library only under `globals`, so unmounting
// between tests is wired by hand for the same reason.
afterEach(cleanup);

// Application requests emit a start and completion record in development.
// Keep those records from flooding concurrent test-worker output; dedicated
// logging and tracing suites use their own sinks to assert the full records.
logger.setLevel('warn');

// jsdom implements no layout, so it has no ResizeObserver. Recharts'
// ResponsiveContainer constructs one on mount and throws without it, which
// would make every view carrying a chart untestable. The stub never fires a
// callback, so containers measure zero and render nothing — charts are not
// what these tests assert on, and Recharts' own rendering is not ours to
// verify.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

// Recharts warns once per chart that a zero-size container cannot be drawn,
// which is the expected consequence of the stub above. Dropping just that
// message keeps real warnings visible instead of training everyone to ignore
// the noise.
const warn = console.warn;
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].includes('of chart should be greater than 0')) {
    return;
  }
  warn(...args);
};
