import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';

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
  plugins: [
    react(),
    visualizer({
      filename: 'build-metrics/bundle-report.html',
      template: 'treemap',
      gzipSize: true,
      brotliSize: true,
    }),
  ],
  base,
  test: {
    // `{ts,tsx}`, not `*.test.ts`: the component suites are `.tsx`, and the
    // narrower glob silently ran only the pure modules — every view test
    // skipped, and the coverage gate never met.
    include: ['src/**/*.test.{ts,tsx}'],
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
        statements: 94,
        branches: 88,
        functions: 92,
        lines: 95,
      },
    },
  },
  build: {
    // No public source maps in production: a published .map hands anyone the
    // full original source and pairs with stack traces to expose internals.
    // This app ships nothing to an error collector, so maps would exist only
    // as an information leak. The bundle policy scan (check-telemetry-policy)
    // fails the build if a .map file or sourceMappingURL ever reappears.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Recharts and its d3/victory deps form ~2/3 of the bundle. Split them
        // into cached vendor chunks so the app shell loads without pulling
        // the whole charting stack, and no single chunk trips the size
        // warning that would bury real regressions in CI output.
        //
        // Recharts 3 reaches its redux/immer runtime only from its own entry,
        // so Rollup co-locates those in this chunk without an explicit rule.
        manualChunks(id) {
          if (id.includes('node_modules/recharts')) {
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
