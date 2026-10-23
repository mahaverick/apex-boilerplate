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

## CI after PR 2

Head 9bc6110 (the sharded unit tests, the bundled e2e harness, nginx tests in the `docker` job, and the flake fixes). Run 39949291236: attempt 1 plus 10 reruns, all 11 green. The table uses the 10 reruns (attempts 2-11). Wall time is the first job start to the last job end.

| Metric           |    Before | After PR 1 | After PR 2 |
| :--------------- | --------: | ---------: | ---------: |
| Median wall time |      552s |       594s |       216s |
| p90              |      590s |      1160s |       234s |
| Range            | 466-1187s |  564-1176s |   173-237s |

The median fell 61% against before and 64% against PR 1. The p90 fell 80% against PR 1, because the Playwright install stalls are gone: the browser cache is keyed on the Playwright version and a hit skips the install.

Per job (median, range, 10 reruns):

| Job                              |  Median |    Range |
| :------------------------------- | ------: | -------: |
| `unit` (each of 6 shards)        | 88-126s |  65-132s |
| `test` (merge and coverage gate) |     25s |   22-31s |
| `lint`                           |     92s |  71-105s |
| `e2e`                            |    216s | 172-236s |
| `docker`                         |    116s | 100-132s |

Shard medians: 1/6 126s, 2/6 88s, 3/6 121s, 4/6 114s, 5/6 115s, 6/6 90s.

`e2e` is the longest job and sets the wall time. `lint` rose from 62-70s to 71-105s because it now also runs the build, the bundle check and the audits that used to sit in `test`.

Run logs show the worker counts: `e2e` runs 165 tests on 3 workers and `docker` runs 35 tests on 4 workers. The top-level `workers` cap is 4 under CI; the `fixtures` project sets its own 3.

`docker` is warm on reruns (the build step takes 8s). Cold, on the first attempt, it took 167s. On a source change it took 274s (build 146s, nginx tests 55s), about 1 minute longer than `e2e` in that run. The build layer for `vp build` re-runs on every commit because the commit SHA is a build argument. This is the next item to cut.

No attempt failed. The two earlier causes of red runs, the `command-palette` and `passkey-sign-in-cancel` unit flakes, did not appear in 11 attempts.

## Local after PR 2

`pnpm gate`: exit 0, `real 110.4s`, `user 656.97s`, `sys 105.22s`. Load average (1 min) was 4.35 at the start and 23.01 at the end, so treat it as indicative. The merged run is 235 files, 3841 tests passed and 10 skipped. PR 1 measured 98.78s at a start load near 13; the two numbers are not comparable.

## The docker split

On a source change, `docker` took 339s while `e2e` took 181s (run 39992137061, seconds from run start). The build step alone took 207s, the nginx `@no-api` tests 57s, and Playwright setup, `nginx -t`, the render check and `check-image.sh` about 40s. The job was the longest in the run, and it ran those steps one after another.

Three changes took it off the critical path:

- **No layer cache for CI's image.** On a source change the cached build took 207s. A build from scratch takes 43-50s, with `pnpm install` fetching from the registry, and there is no cache to export. deploy.yml keeps its own cache.
- **`image`, `image-checks` and two `nginx-e2e` shards instead of one job.** `image` builds and uploads the image as an artifact named `image` (24 MB, 2s), and nothing else. `image-checks` and the shards each have `needs: image`, download it and `docker load` it (7s). `docker` is now an aggregate that fails unless all of them passed, like `test` over `unit`. The fixed artifact name is what lets "Re-run failed jobs" work: a re-run shard downloads the image the first attempt built. Run 39993638190 went red on a deliberately failing test; `gh run rerun --failed` re-ran only the failed shard and `docker`, and the shard downloaded and loaded the image before it ran.
- **`beforeEach(requireServedApp)` instead of `beforeAll`.** Under `fullyParallel`, Playwright batches a file's tests that share a `beforeAll` into `ceil(n / workers)` chunks, so the slowest analytics tests ran back to back on one worker. With one check per test, each shard's test step takes 26-47s.

Source-change runs, seconds from run start to job end:

| Run                                              | `docker` | `e2e` | `test` | Wall-clock |
| :----------------------------------------------- | -------: | ----: | -----: | ---------: |
| 39992137061 (before)                             |      339 |   181 |    240 |        340 |
| 39993044413                                      |      134 |   226 |    182 |        226 |
| 39993638190 (one failing nginx test, on purpose) |      155 |   217 |    167 |        217 |
| 39994450316                                      |      161 |   276 |    155 |        276 |

`docker` finishes 134-161s after the run starts, and no longer sets the wall-clock. `image` ends at 53-74s, `image-checks` at 75-99s, and the shards at 124-157s. `e2e` is now the longest job and varies from run to run (217-276s here against 181s before), so the wall-clock follows it. This change does not touch `e2e`.

**What to watch.** The shards split the tests by count, in file order, so one shard holds the heavier analytics tests. A long new test there lengthens `docker`. The build depends on the npm registry and releases.posthog.com on every run, not only on a lockfile change.
