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
        statements: 95,
        branches: 90,
        functions: 96,
        lines: 96,
      },
    },
  },
  build: {
    // Safe two-pass compression keeps the full Action Center contract inside
    // the existing budgets; no unsafe transforms or property mangling.
    minify: 'terser',
    terserOptions: { compress: { passes: 2 } },
    // No public source maps in production: a published .map hands anyone the
    // full original source and pairs with stack traces to expose internals.
    // This app ships nothing to an error collector, so maps would exist only
    // as an information leak. The bundle policy scan (check-telemetry-policy)
    // fails the build if a .map file or sourceMappingURL ever reappears.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Vendor chunks contain exactly the packages matched below. Without
        // this, a manual chunk silently drags its whole dependency closure
        // in, so unrelated modules could land in a budgeted vendor chunk (or
        // a lazy route chunk) and distort what each budget measures.
        onlyExplicitManualChunks: true,
        // Recharts and its d3/victory deps form ~2/3 of the bundle. Split them
        // into cached vendor chunks so the app shell loads without pulling
        // the whole charting stack, and no single chunk trips the size
        // warning that would bury real regressions in CI output.
        //
        // The recharts chunk must carry every runtime that only Recharts
        // imports (redux toolkit, immer, es-toolkit, decimal.js-light, and
        // friends). Rollup used to co-locate them automatically, but route
        // code splitting gives it reason to hoist them into the shared core
        // chunk — which would quietly halve the measured "Recharts chunk"
        // while shipping the same bytes under an unbudgeted name. Pinning
        // them here keeps the VAL-QUAL-003 Recharts budget honest.
        manualChunks(id) {
          if (
            id.includes('node_modules/recharts') ||
            /node_modules\/(@reduxjs\/toolkit|immer|redux|redux-thunk|reselect|react-redux|react-is|use-sync-external-store|tiny-invariant|es-toolkit|decimal\.js-light|eventemitter3|clsx)\//.test(
              id,
            )
          ) {
            return 'recharts';
          }
          if (
            id.includes('node_modules/victory-vendor') ||
            id.includes('node_modules/internmap') ||
            /node_modules\/d3[-/]/.test(id)
          ) {
            return 'charts-vendor';
          }
          // The React framework gets its own plainly named chunk: it is
          // shared by the entry and the lazy route chunk, and naming it keeps
          // the Application chunk budget (dist/assets/index-*.js) measuring
          // application code only, as its reason states. Merging it into the
          // recharts chunk measured worse: the cross-chunk export wiring cost
          // more than the boundary it removed.
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
            return 'react-core';
          }
          // These operational routes and their exclusive dependencies remain
          // lazy, but share a compression dictionary rather than shipping
          // several tiny chunks. Keep the provider's Action Center rules here
          // too: its dynamic query import otherwise adds two more boundaries.
          // Match only these modules, not their eager dependency closure;
          // framework/vendor and shared app code retain their honest budgets.
          if (
            /\/src\/views\/(system|DataConnectionsView|ProductionRequirementsView|ActionCenterView)\.tsx?$/.test(
              id,
            ) ||
            /\/src\/components\/(NotificationComposer|ActionNotificationPanel|SlaAlertPanel|TeamAccessPanel|WireDiagram|ActionPolicyForm|ActionItemRow|ActionPagination)\.tsx$/.test(
              id,
            ) ||
            /\/src\/data\/(connections|useDataConnectionsQueries|actionCenter|useActionCenterQueries|mock\/actionCenterQueries)\.ts$/.test(
              id,
            ) ||
            /\/src\/lib\/(notifications|partnerHealthRules|actionRules|actionRouting|actionEvidence)\.ts$/.test(
              id,
            )
          ) {
            return 'system';
          }
        },
      },
    },
  },
});
