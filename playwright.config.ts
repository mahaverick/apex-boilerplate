import { defineConfig, devices } from '@playwright/test'

/**
 * The e2e projects.
 *
 * `fixtures` runs against the MSW harness in `e2e/harness/` and needs only the
 * dev server. It holds the checks that need a real browser rather than jsdom.
 *
 * `live` runs against a real express-boilerplate on :4040 through the Vite
 * proxy, and is skipped unless `E2E_LIVE=1`. It covers what needs a real
 * server, cookie jar and reload: a reload keeps you signed in, and the refresh
 * cookie carries the flags
 * the SPA assumes, its `Secure` flag set by express's `COOKIE_SECURE` (default
 * from `APP_ENV`), which no `X-Forwarded-Proto` header changes.
 *
 * Tests are `*.test.ts`, not Playwright's default `*.spec.ts`, which
 * `check-file/filename-blocklist` rejects.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.test.ts',
  // Tests share one dev server and backend, so one test's sign-out would break another.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  /** Under CI, ci.yml uploads the html report from playwright-report/ when e2e fails. */
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
  },
  /**
   * Reuses a running dev server or starts one. Skipped for the `nginx` project,
   * which serves the production bundle from a container; `webServer` has no
   * per-project form, so the switch is an env var.
   */
  webServer: process.env.E2E_NGINX
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:5174',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
  projects: [
    {
      name: 'fixtures',
      testMatch: 'fixtures/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live',
      testMatch: 'live/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * Colour contrast, which jsdom cannot compute (no layout, no cascade), so the
     * unit a11y gate disables every colour rule. Opt-in and not run in CI: run
     * `pnpm test:contrast` before merging UI work, since component composition
     * can break contrast as well as a palette change.
     */
    {
      name: 'contrast',
      testMatch: 'contrast/**/*.test.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    /**
     * Against the production image. The headers and the CSP are only real
     * here; the tests that need no API are tagged `@no-api`, and CI runs them
     * with `--grep @no-api`.
     */
    {
      name: 'nginx',
      testMatch: 'nginx/**/*.test.ts',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_NGINX_ORIGIN ?? 'http://localhost:8088',
      },
    },
  ],
})
