import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-mono/400.css';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initializePerformanceTelemetry } from './lib/performanceTelemetry';
import './index.css';

initializePerformanceTelemetry();

// Native focus-visible retains its state when a pointer reuses the same control.
// Native focus scroll can also leave a partially visible outline clipped.
for (const type of ['keydown', 'pointerdown', 'focusin']) {
  document.addEventListener(type, () => {
    if (type !== 'focusin') {
      document.documentElement.classList.toggle('pointer', type === 'pointerdown');
    } else {
      document.activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <StrictMode>
      <App />
    </StrictMode>
  </ErrorBoundary>,
);
