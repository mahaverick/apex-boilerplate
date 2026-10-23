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

/** Runs `wait`; on failure throws an error naming what did not render. */
async function warm(what: string, expected: string, wait: () => Promise<void>): Promise<void> {
  try {
    await wait()
  } catch (error) {
    throw new Error(`globalSetup: ${what} did not render "${expected}" within 30 s`, {
      cause: error,
    })
  }
}

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
      await warm(path, heading, () =>
        page.getByRole('heading', { name: heading, level: 1 }).waitFor({ timeout: 30_000 })
      )
      // Lazy chunks the first test on a route would otherwise wait for: the command palette, and the passkeys list.
      if (path === '/overview') {
        await page.keyboard.press('ControlOrMeta+k')
        await warm('the command palette', 'Command palette', () =>
          page
            .getByRole('dialog', { name: 'Command palette', exact: true })
            .waitFor({ timeout: 30_000 })
        )
        await page.keyboard.press('Escape')
      }
      if (path === '/settings/account/security') {
        await warm('the passkeys list', 'Passkeys', () =>
          page
            .getByRole('heading', { name: /passkeys/i })
            .first()
            .waitFor({ timeout: 30_000 })
        )
      }
    }
  } finally {
    await browser.close()
  }
}
