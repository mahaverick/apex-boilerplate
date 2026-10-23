import { defineConfig, devices } from '@playwright/test'

/**
 * @file The e2e projects.
 *
 * `fixtures` runs against the MSW harness in `e2e/harness/` and needs only the
 * dev server. It holds the checks that need a real browser rather than jsdom.
 *
 * `live` runs against a real express-boilerplate on :4040 (or `E2E_API_ORIGIN`) through the Vite
 * proxy, and is skipped unless `E2E_LIVE=1`. It covers what needs a real
 * server, cookie jar and reload: a reload keeps you signed in, and the refresh
 * cookie carries the flags the SPA assumes, its `Secure` flag following
 * express's `COOKIE_SECURE` (default from `APP_ENV`) and not any
 * `X-Forwarded-Proto` header.
 *
 * Tests are `*.test.ts`, not Playwright's default `*.spec.ts`, which
 * `check-file/filename-blocklist` rejects.
 */
/** The origin the dev server answers on; `E2E_BASE_URL` points the run at another one. */
const port = process.env.APEX_E2E_PORT ?? '5174'
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  globalSetup: './e2e/global-setup.ts',
  // live and nginx share one backend or container, so they run serially.
  fullyParallel: false,
  workers: process.env.CI ? 4 : '50%',
  forbidOnly: !!process.env.CI,
  // A CI runner renders the Overview through the unbundled dev server in over 5 s in some runs.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  /** Under CI, ci.yml uploads the html report from playwright-report/ when e2e fails. */
  reporter: process.env.CI ? [['github'], ['dot'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  /**
   * Reuses a running dev server or starts one. Skipped for the `nginx` project,
   * which serves the production bundle from a container; `webServer` has no
   * per-project form, so the switch is an env var.
   *
   * `--force` makes a server this config starts re-scan every import before
   * serving. Vite trusts a dependency cache whose lockfile and config hashes
   * still match, so a source change that imports a package the cache predates
   * is found mid-run instead: Vite re-optimises and reloads the page, which
   * drops the memory-only access token and lands the test on /login. A server
   * that is reused is not restarted, so it keeps whatever cache it has.
   * `E2E_CAPTURE` turns it off as well: the capture runs against a dev stack
   * that is already up.
   */
  webServer:
    process.env.E2E_NGINX || process.env.E2E_CAPTURE
      ? undefined
      : {
          command: `pnpm exec vp dev --force --port ${port} --strictPort`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          // Under CI the dev server's log (re-optimising, reloads) goes to the job log.
          stdout: process.env.CI ? 'pipe' : 'ignore',
          timeout: 60_000,
        },
  projects: [
    {
      name: 'fixtures',
      testMatch: 'fixtures/**/*.test.ts',
      // The MSW harness has no shared backend, so each test gets its own page and worker.
      fullyParallel: true,
      workers: process.env.CI ? 4 : '50%',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live',
      fullyParallel: false,
      workers: 1,
      testMatch: 'live/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * Colour contrast, which jsdom cannot compute (it has no layout), so the
     * unit a11y gate disables every colour rule. Opt-in and not run in CI: run
     * `pnpm test:contrast` before merging UI work, since component composition
     * can break contrast as well as a palette change.
     */
    {
      name: 'contrast',
      fullyParallel: false,
      workers: 1,
      testMatch: 'contrast/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * The page inventory's screenshots (docs/pages/). Opt-in, never in CI: it
     * runs against an already-running dev stack and starts nothing, so
     * `E2E_CAPTURE` also turns `webServer` off. Run `pnpm capture:pages`.
     */
    {
      name: 'capture',
      fullyParallel: false,
      workers: 1,
      testMatch: 'capture/**/*.test.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      timeout: 30 * 60_000,
    },
    /**
     * Against the production image. The headers and the CSP are only real
     * here; the tests that need no API are tagged `@no-api`, and CI runs them
     * with `--grep @no-api`.
     */
    {
      name: 'nginx',
      fullyParallel: false,
      workers: 1,
      testMatch: 'nginx/**/*.test.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088',
      },
    },
  ],
})
