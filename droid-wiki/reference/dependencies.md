# Dependencies

The GTM Partner Dashboard declares 16 direct dependencies in `package.json`: 5 runtime packages and 11 development packages. All versions below are copied verbatim from `package.json` at the current `HEAD`; nothing here is inferred. There is no test framework, no backend runtime, and no database client — the app has no server side, and neither list contains a server, API, or storage package.

## Runtime dependencies

These packages ship in the production bundle in `dist/`.

| Package | Version in `package.json` | Purpose |
| --- | --- | --- |
| `react` | `^18.3.1` | UI library: components, hooks, and the element model |
| `react-dom` | `^18.3.1` | DOM renderer that mounts the app in `src/main.tsx` |
| `recharts` | `^2.15.0` | Charting library behind `src/components/RevenueTrend.tsx` |
| `@fontsource/geist-sans` | `^5.3.0` | Self-hosted Geist Sans font, the primary typeface |
| `@fontsource/geist-mono` | `^5.3.0` | Self-hosted Geist Mono font for numeric and mono styling |

## Development dependencies

These packages are needed to develop, type-check, lint, and build; they do not ship in the bundle.

| Package | Version in `package.json` | Purpose |
| --- | --- | --- |
| `typescript` | `~5.6.3` | Type checker; `npm run build` runs `tsc -b` over the tsconfig projects |
| `vite` | `^5.4.11` | Development server and bundler, configured by `vite.config.ts` |
| `@vitejs/plugin-react` | `^4.3.4` | React JSX transform and fast refresh for Vite |
| `eslint` | `^9.17.0` | Linter using the flat config in `eslint.config.js` |
| `typescript-eslint` | `^8.18.1` | TypeScript lint rules for ESLint 9 |
| `tailwindcss` | `^3.4.17` | Utility CSS framework; theme tokens live in `tailwind.config.js` |
| `postcss` | `^8.4.49` | CSS processing pipeline configured in `postcss.config.js` |
| `autoprefixer` | `^10.4.20` | Vendor-prefix generation within the PostCSS pipeline |
| `@types/node` | `^22.10.2` | Node.js type definitions for config files such as `vite.config.ts` |
| `@types/react` | `^18.3.12` | React type definitions |
| `@types/react-dom` | `^18.3.1` | `react-dom` type definitions |

## Lockfile and reproducibility

`package-lock.json` is the npm lockfile for this project. Both CI workflows (`.github/workflows/ci.yml` and `.github/workflows/deploy-pages.yml`) install with `npm ci` and the `cache: npm` option, which installs exactly the locked versions on a clean checkout and reuses the npm cache. Keep the lockfile in sync with `package.json` — commit lockfile changes together with dependency changes — so local installs, CI, Vercel builds, and the Pages workflow all resolve the same tree.

## Related pages

- [Reference index](index.md) — where this page sits in the lens.
- [Getting started](../overview/getting-started.md) — installing these packages and running the npm scripts.
- [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md) — the lint and TypeScript conventions these tools enforce.
- [Configuration](configuration.md) — the build and lint configuration these packages back.
- [Deployment](../deployment.md) — which of these packages the hosted build needs at runtime.
