# Configuration

This page is the look-up list for the GTM Partner Dashboard's configuration surface: the files that shape the build, the environment and build variables the build reads, the npm commands, and the fixed data constants. The app is a static client with no runtime secrets or runtime configuration — everything below is build-time or render-time only.

## Config files

| File | Role |
| --- | --- |
| `package.json` | Project metadata, npm scripts, runtime and development dependencies |
| `vite.config.ts` | Vite configuration: the React plugin and the host-aware asset base path |
| `tsconfig.json` | TypeScript project references pointing at `tsconfig.app.json` and `tsconfig.node.json` |
| `tsconfig.app.json` | Strict TypeScript settings for `src/` (ES2022, `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `jsx: react-jsx`) |
| `tsconfig.node.json` | Strict TypeScript settings for config files such as `vite.config.ts` |
| `eslint.config.js` | ESLint 9 flat config: `typescript-eslint` recommended rules, ignoring `dist` and `node_modules` |
| `tailwind.config.js` | Tailwind theme tokens: the Factory-inspired palette (`canvas`, `bone`, `signal`, `metric`, and friends), Geist font stacks, and radii |
| `postcss.config.js` | PostCSS pipeline: `tailwindcss` and `autoprefixer` plugins |
| `index.html` | Vite entry HTML: `#root` mount point, favicon, title, and metadata |
| `.github/workflows/ci.yml` | Pull-request verification: `npm ci`, `npm run lint`, `npm run build` |
| `.github/workflows/deploy-pages.yml` | Manual-only GitHub Pages deploy (see [Deployment](../deployment.md)) |

## Environment and build variables

`vite.config.ts` reads two environment variables, both of which affect only the base path baked into the built assets:

| Variable | Meaning | Effect on base |
| --- | --- | --- |
| `VERCEL` | Set by Vercel in its build environment | Base becomes `/` when set, unless `BASE_PATH` is set |
| `BASE_PATH` | Explicit override supplied on the command line | Takes precedence over `VERCEL` and the Pages default; for example `BASE_PATH=/preview/ npm run build` |

With neither variable set, the default base is `/GTM-Partner-Dashboard/`, matching the GitHub Pages project-site path. The exact precedence expression is `process.env.BASE_PATH ?? (process.env.VERCEL ? '/' : '/GTM-Partner-Dashboard/')`. See [Deployment](../deployment.md) for the full host/base table.

## npm commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite development server, normally at `http://localhost:5173` |
| `npm run lint` | Runs ESLint over the repository using `eslint.config.js` |
| `npm run build` | Runs `tsc -b` (type-checks both tsconfig projects), then `vite build` into `dist/` |
| `npm run preview` | Serves the built `dist/` locally to verify a production build |

There is no `test` script in `package.json`; the repository has no test directory or test framework.

## Fixed data constants

`src/data/constants.ts` holds the shared constants the model and views reference:

| Constant | Value |
| --- | --- |
| `SNAPSHOT_DATE` | `2026-09-18T00:00:00Z` — the fixed date all relative ("today") logic uses |
| `CURRENT_YEAR` | `2026` |
| `QUARTERS` | `2024-Q4` through `2026-Q3`, oldest first |
| `STAGES` | Discovery, Scope, Tech Validation, Business Case, Vendor of Choice, Deal Desk Review |
| `OPP_TYPES` | Sell To, Sell With, Allocate |
| `WON_COLOR` / `LOST_COLOR` / `TARGET_COLOR` | `#a0ca92` / `#4d4947` / `#8a8380` |

Related metadata maps in the same file: `STAGE_META`, `OPP_TYPE_META`, `PARTNER_TYPE_META`, `PARTNER_TIER_META`, `REGION_META`, and `REGISTRATION_STATUS_META`. The mock generator adds its own pinned seed, `20260918`, in `src/data/mock/generate.ts` via the mulberry32 helper in `src/data/mock/rng.ts`; changing the snapshot means updating the constants above and the generator's local `SNAPSHOT` constant together, as described in [Data provider](../systems/data-provider.md).

## Runtime secrets and configuration

The dashboard has no runtime environment variables, no server-side config file, and no secrets. `VERCEL`, `BASE_PATH`, and `VITE_LOG_LEVEL` are read at build time only — the first two pick the asset base path, the last sets the minimum log level (see [Debugging](../how-to-contribute/debugging.md)) — and the deployed `dist/` is static. Authentication is not part of the app: the partner portal picker simulates a partner identity, and any access control lives at the hosting layer (Vercel Authentication) or, in the future, in partner SSO. A future CRM adapter (see [Data provider](../systems/data-provider.md)) is where credentials would belong — not in this repository's configuration.

## Related pages

- [Getting started](../overview/getting-started.md) — running the commands above locally.
- [Deployment](../deployment.md) — how the build variables are used by Vercel and Pages.
- [Dependencies](dependencies.md) — the packages behind the build toolchain.
- [Data provider](../systems/data-provider.md) — the snapshot constants in the mock generator.
- [Patterns and conventions](../how-to-contribute/patterns-and-conventions.md) — how the config surface is expected to change.
