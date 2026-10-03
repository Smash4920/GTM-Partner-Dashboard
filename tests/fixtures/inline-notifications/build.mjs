import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { build } from 'vite';

// Build only. Playwright fulfills these static assets through the existing
// approved preview origin; this script never starts a listening service.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const outDir = await realpath(resolve(process.argv[2]));
const temporaryRoot = await realpath(tmpdir());
const suffix = relative(temporaryRoot, outDir);
if (!suffix.startsWith('gtm-inline-a11y-') || suffix.includes('..')) {
  throw new Error('Fixture output must be an isolated gtm-inline-a11y-* temporary directory');
}
await build({
  configFile: false,
  root,
  base: '/__inline-notification-fixture__/',
  plugins: [react()],
  publicDir: false,
  build: {
    outDir,
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      input: join(root, 'tests/fixtures/inline-notifications/index.html'),
    },
  },
});
