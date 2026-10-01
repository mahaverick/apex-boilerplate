import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  createVerifiedUser,
  emailIdFor,
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
 * signed-in shell, the staff activity page, with its log, filters and
 * selects rendered from real data, and an email's preview tab, whose srcdoc
 * frame inherits the policy. Needs the container and express 1.3.0 or newer
 * on :4040; `pnpm test:e2e:nginx` runs it.
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

/**
 * The preview renders a real email in `<iframe sandbox="" srcdoc>`, which
 * inherits this document's policy. The frame runs no script (the sandbox
 * grants none), so the init-script listener cannot run inside it; a
 * violation there still reaches the page's console, which `watchCspViolations`
 * also collects. The frame's document is asserted through the `srcdoc` it was
 * given, so the test cannot pass on a frame that never rendered.
 */
test('an email’s preview tab renders its sandboxed frame with no violation', async ({ page }) => {
  test.setTimeout(120_000)
  const email = freshEmail()
  await createVerifiedUser(email)
  await grantPlatformRole(email, 'admin')
  // Registering mailed this account its own verification email: the one to preview.
  const id = await emailIdFor(await apiLogin(email), email, 'email_verification')

  const violations = await watchCspViolations(page)
  await logIn(page, email)
  const preview = await page.goto(`/emails/${id}?tab=preview`)
  expect(preview?.headers()['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
  const frame = page.getByTitle('Email preview')
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(frame).toHaveAttribute('srcdoc', /<\w/)
  await flushCspReports(page)
  expect(violations).toEqual([])
})
