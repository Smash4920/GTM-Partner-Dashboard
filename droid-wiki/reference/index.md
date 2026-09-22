# Reference

The Reference lens collects the factual, look-it-up pages for the GTM Partner Dashboard: the configuration surface, the canonical data model, and the dependency list. Where the [Overview](../overview/index.md) explains what the project is and the [Systems](../systems/index.md) and [Features](../features/index.md) lenses explain how behavior is built, these pages are the source-of-truth details — file layouts, shapes, and versions — that the other lenses link back to.

## Reference map

| Page | Covers | Primary sources |
| --- | --- | --- |
| [Configuration](configuration.md) | Config files, build and environment variables, npm scripts, fixed data constants, and the absence of runtime secrets | `package.json`, `vite.config.ts`, `tsconfig*.json`, `tailwind.config.js`, `postcss.config.js`, `eslint.config.js`, `.github/workflows/*.yml` |
| [Data models](data-models.md) | The five canonical entity shapes, union types, relationships and lifecycle, and entity source files | `src/data/types.ts`, `src/data/constants.ts` |
| [Dependencies](dependencies.md) | Runtime and development dependencies declared in `package.json`, with purposes and the lockfile note | `package.json`, `package-lock.json` |

## Where these pages fit

- [Configuration](configuration.md) supports the build and deploy story in [Deployment](../deployment.md) and the local setup in [Getting started](../overview/getting-started.md).
- [Data models](data-models.md) is the detail behind the record shapes summarized in the [Glossary](../overview/glossary.md) and the [Data provider](../systems/data-provider.md) contract.
- [Dependencies](dependencies.md) documents the runtime and tooling packages that [Getting started](../overview/getting-started.md) installs.

Nothing here is a tutorial. For how-to guidance, see the [Overview](../overview/index.md) pages instead.

## Related pages

- [Overview](../overview/index.md) — what the project is and who uses each view.
- [Glossary](../overview/glossary.md) — domain terms in plain words.
- [Data provider](../systems/data-provider.md) — the integration seam that consumes these shapes.
- [Deployment](../deployment.md) — Vercel and GitHub Pages hosting.
