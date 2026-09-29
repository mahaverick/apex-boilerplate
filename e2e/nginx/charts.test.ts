import { expect, test } from '@playwright/test'
import {
  apiIsReady,
  createVerifiedUser,
  freshEmail,
  grantPlatformRole,
  logIn,
} from '../live/helpers'
import { flushCspReports, requireServedApp, watchCspViolations } from './csp'

/**
 * The Overview's charts under nginx's real Content-Security-Policy. recharts
 * sets inline styles and shadcn's `ChartStyle` writes a `<style>` element, both
 * of which rest on `style-src 'unsafe-inline'`; this proves they still paint
 * with no violation. Needs a live API, since the Overview only renders for
 * signed-in staff; `pnpm test:e2e:nginx` runs it.
 */

test.skip(process.env.E2E_LIVE !== '1', 'needs a live API — set E2E_LIVE=1 (pnpm test:e2e:nginx)')

test.beforeAll(async () => {
  if (!(await apiIsReady())) throw new Error('No live API on :4040')
  await requireServedApp()
})

test('the overview charts draw under the production CSP', async ({ page }) => {
  // Registering and verifying through mailpit (a poll of up to 15s), the grant script, then a cold production bundle.
  test.setTimeout(90_000)
  const email = freshEmail()
  await createVerifiedUser(email)
  await grantPlatformRole(email, 'viewer')

  const violations = await watchCspViolations(page)
  await logIn(page, email)

  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.locator('[data-slot="chart"] svg.recharts-surface')).toHaveCount(2)
  await flushCspReports(page)
  expect(violations).toEqual([])
})
