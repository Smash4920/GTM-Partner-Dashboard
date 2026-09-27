import { defineConfig } from 'vitest/config';
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
  test: {
    // jsdom for everything rather than per-file: the pure metric suites run
    // fine under it, and one environment means a new component test never
    // fails for want of a docblock.
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/main.tsx',
        'src/test/**',
        // Type-only modules and icon paths: nothing to assert, and counting
        // them would let real gaps hide behind a comfortable percentage.
        'src/data/types.ts',
        'src/data/DataProvider.ts',
        'src/components/icons.tsx',
        '**/*.test.{ts,tsx}',
      ],
      reporter: ['text-summary', 'html'],
      // A ratchet, set just under what the suite currently reaches. Raise it
      // as coverage lands; never lower it to make a red build green. The view
      // layer sat at 0% before Phase 0 of docs/migration-plan.md, which is how
      // a refactor of 5,700 unverified lines came to look survivable.
      thresholds: {
        statements: 88,
        branches: 83,
        functions: 70,
        lines: 88,
      },
    },
  },
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
