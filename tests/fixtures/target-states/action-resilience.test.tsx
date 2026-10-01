import { createRoot } from 'react-dom/client';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-mono/400.css';
import App from '../../../src/App';
import { MockDataProvider } from '../../../src/data/mock/MockDataProvider';
import '../../../src/index.css';

declare global {
  interface Window {
    actionResilienceFixture: { calls: Record<string, number> };
  }
}

// Isolated production-built test input, never an ordinary runtime URL override.
const provider = new MockDataProvider();
const calls: Record<string, number> = {};
window.actionResilienceFixture = { calls };
const count = (method: string) => (calls[method] = (calls[method] ?? 0) + 1);
const summary = provider.getActionCenterSummary.bind(provider);
provider.getActionCenterSummary = async (...args) => {
  if (count('getActionCenterSummary') === 1) throw new Error('PRIVATE summary sentinel');
  return summary(...args);
};
const list = provider.listActionItems.bind(provider);
provider.listActionItems = async (...args) => {
  if (count('listActionItems') === 2) throw new Error('PRIVATE page sentinel');
  const result = await list(...args);
  return {
    ...result,
    meta: {
      ...result.meta,
      completeness: 'partial',
      warnings: [
        {
          code: 'unattributed-opportunities',
          message: 'Fixture: one opportunity lacks manager attribution; usable actions remain.',
        },
      ],
    },
  };
};
const health = provider.getForecastSummary.bind(provider);
provider.getForecastSummary = async (...args) => {
  if (count('getForecastSummary') === 1) throw new Error('PRIVATE startup sentinel');
  return health(...args);
};
createRoot(document.getElementById('root')!).render(<App providerFactory={() => provider} />);
