import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Base path matches the GitHub Pages project URL:
// https://smash4920.github.io/GTM-Partner-Dashboard/
export default defineConfig({
  plugins: [react()],
  base: '/GTM-Partner-Dashboard/',
});
