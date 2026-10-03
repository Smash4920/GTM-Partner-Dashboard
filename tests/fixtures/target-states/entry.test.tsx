import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-mono/400.css';
import App from '../../../src/App';
import ErrorBoundary from '../../../src/components/ErrorBoundary';
import { MockDataProvider } from '../../../src/data/mock/MockDataProvider';
import { initializePerformanceTelemetry } from '../../../src/lib/performanceTelemetry';
import { makeOpportunity, makeProviderBook } from '../../../src/test/fixtures';
import '../../../src/index.css';

const root = document.getElementById('root')!;
const state = root.dataset.targetState;
const book = makeProviderBook({
  ...(state === 'no-target' ? { targets: [] } : {}),
  ...(state === 'target-met'
    ? {
        opportunities: [
          makeOpportunity({
            outcome: 'won',
            forecastedRevenue: 500_000,
            closedAt: '2026-09-10T00:00:00.000Z',
          }),
        ],
      }
    : {}),
});
initializePerformanceTelemetry();
createRoot(root).render(
  <ErrorBoundary>
    <StrictMode>
      <App providerFactory={() => new MockDataProvider(book)} />
    </StrictMode>
  </ErrorBoundary>,
);
