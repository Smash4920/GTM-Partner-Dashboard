# Tooling

The dashboard is a Vite-built React single-page application: React 18 and TypeScript compiled by Vite, styled with Tailwind 3, one chart rendered by Recharts, and verified by ESLint plus a TypeScript project build. This page catalogs the tools behind `npm run dev`, `npm run lint`, `npm run build`, and `npm run preview`, and the configuration files that drive them.

## Vite

`vite.config.ts` registers `@vitejs/plugin-react` and selects the asset base path from the environment: `/` when `VERCEL` is set, `/GTM-Partner-Dashboard/` otherwise, with `BASE_PATH` overriding both. The scripts in `package.json` map to the Vite commands: `dev` runs the development server, `build` runs `tsc -b && vite build` into `dist/`, and `preview` serves the built output.

## TypeScript

Type checking is a TypeScript project build: `npm run build` starts with `tsc -b`. The root `tsconfig.json` is a solution file that references two projects:

- `tsconfig.app.json` — compiles `src/` with strict mode plus `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `isolatedModules`, `moduleResolution: "bundler"`, and `noEmit`.
- `tsconfig.node.json` — compiles `vite.config.ts` with the same strict posture.

Both projects write incremental build info under `node_modules/.tmp/`, which is why that path is not committed.

## ESLint

`eslint.config.js` is an ESLint 9 flat config built from the `typescript-eslint` helper: it ignores `dist` and `node_modules` and applies the recommended rule set. The `lint` script is `eslint .`. Lint covers static issues only; [Testing](testing.md) explains what it does and does not catch.

## Tailwind and PostCSS

Tailwind 3.4 scans `index.html` and `src/**/*.{ts,tsx}` per the content globs in `tailwind.config.js` and exposes the brand tokens — canvas, carbon, bone, signal, metric, and the rest of the palette — used across `src/`. `postcss.config.js` wires `tailwindcss` and `autoprefixer` into the build. `src/index.css` holds the `@tailwind` directives plus a few global rules; component styling is Tailwind utility classes.

## Recharts

Recharts 2.x powers the only chart in the app, `src/components/RevenueTrend.tsx`, a `ComposedChart` of a bar series and a dashed target line. Chart colors come from `src/data/constants.ts` or inline values in the component, and animation is disabled so the chart renders fully on first paint.

## npm and the lockfile

Dependencies are pinned by the committed `package-lock.json`. CI installs with `npm ci`, which is strict about the lockfile, so adding or removing a dependency requires an updated lockfile from `npm install` at the repository root. The current dependency set is catalogued in the package manifest: runtime packages are React, React DOM, Recharts, and the two Geist fontsource packages; everything else is development tooling.

## GitHub Actions

Two workflows live in `.github/workflows/`:

- `ci.yml` — runs `npm ci`, `npm run lint`, and `npm run build` on Node 20 for every pull request, plus manual `workflow_dispatch`.
- `deploy-pages.yml` — a manual-only GitHub Pages deploy. [Getting started](../overview/getting-started.md) notes that Pages cannot publish from a private repo on the Free plan, so Vercel is the current host and the workflow is kept as an optional one-click deploy.

## Configuration file table

| Path | Role |
| --- | --- |
| `package.json` | Scripts and dependency manifest |
| `package-lock.json` | Pinned dependency tree used by `npm ci` |
| `vite.config.ts` | React plugin and environment-driven base path |
| `tsconfig.json` | TypeScript solution file referencing the two projects |
| `tsconfig.app.json` | Strict compiler options for `src/` |
| `tsconfig.node.json` | Compiler options for `vite.config.ts` |
| `eslint.config.js` | ESLint 9 flat config (typescript-eslint recommended) |
| `tailwind.config.js` | Content globs and theme tokens |
| `postcss.config.js` | Tailwind and autoprefixer PostCSS plugins |
| `index.html` | Vite entry HTML that mounts `src/main.tsx` |
| `.gitignore` | `node_modules`, `dist`, build info, and logs |
| `.github/workflows/ci.yml` | PR and manual-dispatch lint and build |
| `.github/workflows/deploy-pages.yml` | Manual-only Pages deploy |

## Related pages

- [How to contribute](index.md) — the lens index and definition of done.
- [Development workflow](development-workflow.md) — how these tools run in the contribution loop.
- [Getting started](../overview/getting-started.md) — running the tools locally and the base-path table.
- [Architecture](../overview/architecture.md) — what the build produces and where it is served.
- [Debugging](debugging.md) — how the tool configuration surfaces as symptoms.
