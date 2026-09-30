# Quality gates

Budgets and thresholds enforced in CI, generated from the files under `config/`.

## Bundle budgets

| Budget                   | Pattern                          | Limit                  |
| ------------------------ | -------------------------------- | ---------------------- |
| Total JavaScript         | `dist/assets/*.js`               | 240.0 KiB (gzip, sum)  |
| Application chunk        | `dist/assets/index-*.js`         | 76.0 KiB (gzip, each)  |
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
