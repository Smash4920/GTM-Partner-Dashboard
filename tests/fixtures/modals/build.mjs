import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

// Static assets only, served by Playwright fulfillment on the approved
// production-preview origin. No runtime flag or extra listening service.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const outDir = await realpath(resolve(process.argv[2]));
const suffix = relative(await realpath(tmpdir()), outDir);
if (!suffix.startsWith('gtm-modal-a11y-') || suffix.includes('..')) {
  throw new Error('Fixture output must be an isolated gtm-modal-a11y-* temporary directory');
}
await build({
  configFile: false,
  root,
  base: '/__modal-fixture__/',
  publicDir: false,
  plugins: [
    {
      name: 'isolated-workflow-prop-fixture',
      enforce: 'pre',
      resolveId(id, importer) {
        // Only the fixture's App composition uses the adapter. The adapter
        // itself imports the unchanged production component directly.
        if (id === './components/WorkflowPanel' && importer === join(root, 'src/App.tsx')) {
          return join(root, 'tests/fixtures/modals/workflow.test.tsx');
        }
      },
    },
    react(),
  ],
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: { input: join(root, 'tests/fixtures/modals/index.html') },
  },
});
