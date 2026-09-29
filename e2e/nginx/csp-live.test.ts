import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  createVerifiedUser,
  freshEmail,
  grantPlatformRole,
  logIn,
} from '../live/helpers'
import {
  CONTENT_SECURITY_POLICY,
  flushCspReports,
  requireServedApp,
  watchCspViolations,
} from './csp'

/**
 * The enforced policy over the parts of the app that need a live API: the
 * signed-in shell and the staff activity page, with its log, filters and
 * selects rendered from real data. Needs the container and express on :4040;
 * `pnpm test:e2e:nginx` runs it.
 */

test.skip(process.env.E2E_LIVE !== '1', 'needs a live API — set E2E_LIVE=1 (pnpm test:e2e:nginx)')

test.beforeAll(async () => {
  if (!(await apiIsReady())) throw new Error(`No API at ${API_ORIGIN}`)
  await requireServedApp()
})

test('the signed-in app and the activity page run with no violation', async ({ page }) => {
  test.setTimeout(90_000)
  const email = freshEmail()
  await createVerifiedUser(email)
  await grantPlatformRole(email, 'admin')

  const violations = await watchCspViolations(page)
  await logIn(page, email)
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  const activity = await page.goto('/activity')
  expect(activity?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
  await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible()
  await flushCspReports(page)
  expect(violations).toEqual([])
})
