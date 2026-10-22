# CI performance

Timing record for the Vite+ migration. Later tasks append their "after" tables here.

## Method

- **CI:** 20 successful `pull_request` runs of `ci.yml` on origin/main 3545e45, median and p90 of wall time.
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

## CI after PR 1

Head eb6d8fd (the Vite+ switch plus the e2e `vp dev` and dompurify override fixes). Run 39842683305: attempt 1 was cancelled, attempts 2-10 succeeded (9 samples). Wall time is the first job start to the last job end.

| Metric           |     Value |
| :--------------- | --------: |
| Median wall time |      594s |
| p90              |     1160s |
| Range            | 564-1176s |

Excluding attempt 2 (the Playwright download stall below), the median is 593s and the range is the same.

Per job (median, range):

| Job      | Median |     Range |
| :------- | -----: | --------: |
| `e2e`    |   594s | 465-1175s |
| `test`   |   563s |  366-577s |
| `lint`   |    67s |    62-70s |
| `docker` |    71s |    60-76s |

`lint` fell from 104-161s to 62-70s. `test` and `docker` did not move; `e2e` median is flat.

Slow or failed attempts, all from the Playwright browser setup, not from the code:

- Attempt 1: cancelled. `playwright install --with-deps chromium` took 15.6 min (the browser download stalled), so the 20-minute job timeout hit during `test:e2e`.
- Attempts 2, 6 and 8: `playwright install` / `install-deps` took 599s, 573s and 668s (apt and download stalls). These are the three runs of 1100-1176s. The other six attempts took 564-628s.
- With those three removed, `test:e2e` ran 253-389s in every attempt.

`pnpm audit --prod` and the `ip-address` advisory (GHSA-rxp7-6hxx-x8q5, 10.7.2) were checked: `ip-address` arrives only through the dev-only `shadcn` package, and the production audit passes, so no override was added.

## Local after PR 1

Load average (1 min) was 2.55 when hyperfine started; `pnpm test` workers then raised it to 13. `hyperfine --warmup 1 --runs 3`, mean of 3:

| Command              | Mean wall time [s] |
| :------------------- | -----------------: |
| `pnpm check`         |      8.408 ± 0.085 |
| `pnpm exec eslint .` |      5.324 ± 0.057 |
| `pnpm test`          |     79.984 ± 1.799 |
| `pnpm build`         |      6.869 ± 0.086 |

`pnpm exec eslint .` fell from 28.7s to 5.3s because it now runs only the 17 rules Oxlint cannot. `pnpm check` (format, type-aware Oxlint, tsc) replaces the old prettier + typecheck pair (13.95s) and takes 8.4s while also doing the lint pass.

`/usr/bin/time -p pnpm gate`: `real 98.78s`, `user 639.79s`, `sys 99.48s`, started at load average about 13. The old pre-push (eslint, prettier, typecheck, unit tests) was `real 158.02s` at load 15.2.
