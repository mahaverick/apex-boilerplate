import { chromium, type FullConfig } from '@playwright/test'

/** Harness routes, each with the h1 it must render; a route that lands elsewhere or errors fails the run. */
const WARM_ROUTES: readonly (readonly [path: string, heading: string])[] = [
  ['/overview', 'Overview'],
  ['/tenants', 'Tenants'],
  ['/users', 'Users'],
  ['/deliverability', 'Deliverability'],
  ['/emails', 'Emails'],
  ['/suppressions', 'Suppressions'],
  ['/activity', 'Activity'],
  ['/onboarding', 'Onboarding'],
  ['/settings/account/profile', 'Profile'],
  ['/settings/account/security', 'Security'],
  ['/settings/platform/flags', 'Feature flags'],
  ['/settings/platform/maintenance', 'Maintenance'],
  ['/settings/platform/staff', 'Staff'],
]

/**
 * Loads the harness once before any test, so Vite has bundled its dependencies
 * and transformed the entry and the first route chunks.
 *
 * `webServer` is ready as soon as `/` answers, which is before the dev
 * server's first optimizer pass and module transforms have finished. With
 * three workers on a cold server, the first tests would wait on that work
 * inside their 5 s assertion budget.
 *
 * It also runs under `E2E_LIVE` (the nightly's `live` step), where the
 * harness's unmocked status calls go through the dev proxy to the live API:
 * they are read-only and count against its rate limit.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (process.env.E2E_NGINX || process.env.E2E_CAPTURE) return
  const baseURL = config.projects.find((project) => project.name === 'fixtures')?.use.baseURL
  if (!baseURL)
    throw new Error("globalSetup: no 'fixtures' project with a baseURL in playwright.config.ts")
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ baseURL })
    for (const [path, heading] of WARM_ROUTES) {
      await page.goto(`/e2e/harness/?path=${path}`)
      try {
        await page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 30_000 })
      } catch (error) {
        throw new Error(
          `globalSetup: ${path} did not render the "${heading}" heading within 30 s (at ${page.url()})`,
          { cause: error }
        )
      }
    }
  } finally {
    await browser.close()
  }
}
