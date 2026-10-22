# CI performance

Timing record for the Vite+ migration. Later tasks append their "after" tables here.

## Method

- **CI:** successful `pull_request` runs of `ci.yml` on origin/main 3545e45, median and p90 of wall time.
- **Local:** `hyperfine --warmup 1 --runs 3`; the table shows the mean of 3 runs (hyperfine's markdown export), not the median.
- **Machine:** Apple silicon laptop, 10 cores. Load average (1 min) was 3.35 at the start of the benchmark and 14.3 at its end. Vitest and Playwright spawn their own workers, so the later commands ran under their own load plus other processes on the machine. Treat the local numbers as indicative.
- **Exit codes:** hyperfine ran without `--ignore-failure`, so it would have aborted on a non-zero exit. All five commands exited 0, including `pnpm test`, and `pnpm build` produced `dist/` (13 MB).
- **Build time:** `pnpm build` is `tsc -b && vp build`. `tsc -b` reuses its incremental cache after the first run, so the 6s mean is warm. A cold build takes longer.
- **Comparison:** take later "after" tables at a comparable load, or the ratios mean little.

## CI before

| Metric           |     Value |
| :--------------- | --------: |
| Median wall time |      552s |
| p90              |      590s |
| Range            | 466-1187s |

Per job:

| Job      |                                                     Time |
| :------- | -------------------------------------------------------: |
| `e2e`    | 507-600s (`test:e2e` 297-380s, nginx `@no-api` 113-119s) |
| `test`   |                      447-591s (`test:coverage` 390-523s) |
| `lint`   |                                                 104-161s |
| `docker` |                                                   61-76s |

The Playwright cache missed in 2 of 3 runs.

## Local before

| Command                                                                        | Mean wall time [s] |
| :----------------------------------------------------------------------------- | -----------------: |
| `pnpm exec eslint . --max-warnings 0`                                          |     28.716 ± 0.415 |
| `pnpm exec prettier --check "**/*.{ts,tsx,js,jsx,mjs,css,json,jsonc,md,html}"` |      6.453 ± 0.030 |
| `pnpm typecheck`                                                               |      7.500 ± 0.124 |
| `pnpm test`                                                                    |     94.022 ± 1.442 |
| `pnpm build`                                                                   |      6.103 ± 0.023 |

`bash .husky/pre-push` (eslint, prettier, typecheck, unit tests; run once, load average 15.2 at start): `real 158.02s`, `user 739.99s`, `sys 107.76s`.
