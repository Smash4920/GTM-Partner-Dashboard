# Quality gates

Effective limits from checked-in configuration and policy scripts. Never weaken
a ratchet to make a failing check pass. `npm run quality:check` checks gate parity
and preserves these floors and ceilings; it also runs inside `docs:check`.

## Complete ordered gate

```bash
npm run agents:check
npm run check:file-limits
npm run format:check
npm run test:debt
npm run test:build-metrics
npm run test:sentry-sync
npm run debt:check
npm run lint
npm run dead-code
npm run lint:duplicates
npm run docs:check
npm run client-boundary:check
npm run test:coverage:ci
npm run test:performance
npm run bundle:check
npm run workflows:check
npm run test:e2e
```

## Coverage and static ratchets

- Statements: 95%
- Branches: 90%
- Functions: 96%
- Lines: 96%
- File bytes: 1048576 (1 MiB); text lines: 1200
- Only documented generated lockfiles are exempt from the text-line limit.
- Complexity: 20
- Duplication: 1.5%
- Formatting, module boundaries, strict TypeScript, Knip, and linked debt stay blocking.

## Build and size-limit ceilings

- Build: 60,000 ms (TypeScript plus Vite)
- Total JavaScript: 235 kB (size-limit)
- Application chunk: 65 kB (size-limit)
- Recharts chunk: 150 kB (size-limit)
- Chart dependencies chunk: 24 kB (size-limit)

## Bundle budgets

| Budget                   | Pattern                          | Limit                  |
| ------------------------ | -------------------------------- | ---------------------- |
| Total JavaScript         | `dist/assets/*.js`               | 240.0 KiB (gzip, sum)  |
| Application chunk        | `dist/assets/index-*.js`         | 68.0 KiB (gzip, each)  |
| Recharts chunk           | `dist/assets/recharts-*.js`      | 155.0 KiB (gzip, each) |
| Chart dependencies chunk | `dist/assets/charts-vendor-*.js` | 28.0 KiB (gzip, each)  |
| Stylesheet               | `dist/assets/*.css`              | 30.0 KiB (gzip, each)  |

## Dependency install budgets

| Dependency               | Limit       |
| ------------------------ | ----------- |
| `recharts`               | 12288.0 KiB |
| `react-dom`              | 6144.0 KiB  |
| `@fontsource/geist-mono` | 4096.0 KiB  |
| `@fontsource/geist-sans` | 1536.0 KiB  |
| `react`                  | 1024.0 KiB  |

Total production dependency budget: 32768.0 KiB.

## Test performance budgets

- Suite total: 90.00s
- Slowest single test: 8.00s
