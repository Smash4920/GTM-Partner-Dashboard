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
});
