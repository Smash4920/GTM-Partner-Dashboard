/**
 * Tailwind theme tokens follow Factory's external brand system:
 * - Near-black canvas (#101010) with bone (#EEEEEE) type
 * - Carbon (#1D1A18) hairline surfaces, ash (#3D3A39) strokes
 * - Two functional accents only: signal orange (#EE6018) for
 *   live status / attention, metric green (#A0CA92) for positive data
 * - Color is reserved for data states, never chrome
 * - Flat surfaces, 1px borders, no shadows, radii 3px / 10px / 20px
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#101010',
        carbon: '#1d1a18',
        ash: '#3d3a39',
        graphite: '#4d4947',
        granite: '#8a8380',
        stone: '#b8b3b0',
        bone: '#eeeeee',
        chalk: '#fafafa',
        signal: '#ee6018',
        metric: '#a0ca92',
      },
      fontFamily: {
        sans: [
          'Geist',
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          '"Geist Mono"',
          '"JetBrains Mono"',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      borderRadius: {
        DEFAULT: '3px',
        card: '10px',
        panel: '20px',
      },
    },
  },
  plugins: [],
};
