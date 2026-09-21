import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Asset base path depends on where the build is served from:
 * - Vercel (and `vercel dev`) serve the app at a domain root, so '/'
 * - GitHub Pages serves a project site under /<repo>/
 *
 * Vercel sets VERCEL=1 in the build environment. Override explicitly with
 * BASE_PATH when serving from anywhere else.
 */
const base = process.env.BASE_PATH ?? (process.env.VERCEL ? '/' : '/GTM-Partner-Dashboard/');

export default defineConfig({
  plugins: [react()],
  base,
  build: {
    rollupOptions: {
      output: {
        // Recharts and its d3/victory deps form ~2/3 of the bundle. Split them
        // into cached vendor chunks so the app shell loads without pulling
        // the whole charting stack, and no single chunk trips the size
        // warning that would bury real regressions in CI output.
        manualChunks(id) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/react-smooth')) {
            return 'recharts';
          }
          if (id.includes('node_modules/victory-vendor') || /node_modules\/d3[-/]/.test(id)) {
            return 'charts-vendor';
          }
        },
      },
    },
  },
});
