import { expect, test, type Page } from '@playwright/test'
import {
  APEX_ORIGIN,
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  assertApiServesApex,
  assertFakeEmailWebhook,
  createVerifiedUser,
  emailIdFor,
  fireEmailEvent,
  freshEmail,
  grantPlatformRole,
  logIn,
  mailedLink,
} from './helpers'

/**
 * Message tracking against a real express (1.4.0 or newer, as `assertApiServesApex` requires; `APP_ENV=local`)
 * with mailpit: a real email goes out through an SP2 action, provider events
 * reach it through express's fake webhook adapter (`pnpm email:fire-event`),
 * and the Apex pages follow. Step-up on a platform-tenant invitation resend is
 * covered by express's and Apex's unit tests; this flow's email is a customer
 * account's, so no step-up applies.
 */

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  test.setTimeout(90_000)
  if (!(await apiIsReady())) {
    throw new Error(`No API at ${API_ORIGIN}. Start express with APEX_URL=${APEX_ORIGIN}.`)
  }
  await assertApiServesApex()
  await assertFakeEmailWebhook()
})

/** A fresh staff admin, signed in through the UI; returns their API token for lookups. */
async function signedInAdmin(page: Page): Promise<string> {
  const email = freshEmail()
  await createVerifiedUser(email)
  await grantPlatformRole(email, 'admin')
  const token = await apiLogin(email)
  await logIn(page, email)
  return token
}

/** The id of the account at `email`, looked up with a staff token. */
async function userIdOf(token: string, email: string): Promise<string> {
  const found = await apiRequest(token, 'GET', `/platform/users?q=${encodeURIComponent(email)}`)
  const users = (found.body as { data: { users: { id: string; email: string }[] } }).data.users
  return users.find((user) => user.email === email)!.id
}

test('a hard bounce suppresses the address; once lifted, a resend goes out and links back', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const token = await signedInAdmin(page)
  const customer = freshEmail()
  await createVerifiedUser(customer)
  const customerId = await userIdOf(token, customer)

  // An SP2 action sends a real email: the reset link reaches mailpit.
  await page.goto(`/users/${customerId}`)
  await page.getByRole('button', { name: `Actions for ${customer}` }).click()
  await page.getByRole('menuitem', { name: 'Send password reset link' }).click()
  await expect(page.getByText('Password reset email sent.')).toBeVisible()
  await mailedLink(customer, 'reset-password')
  const original = await emailIdFor(token, customer, 'password_reset')

  // The user's Emails card lists it, and opens its page.
  await page.reload()
  const card = page.getByRole('region', { name: 'Emails' })
  await card.getByRole('link', { name: /^Password reset · / }).click()
  await expect(page).toHaveURL(new RegExp(`/emails/${original}$`))
  await expect(page.getByRole('heading', { name: customer, level: 1 })).toBeVisible()

  await fireEmailEvent(original, 'delivered')
  await page.reload()
  const timeline = page.getByRole('list', { name: 'Delivery timeline' })
  await expect(timeline).toContainText('Delivered')

  // canResend turns false once the address is suppressed, so the UI meets recipient_suppressed only in a dialog opened before the bounce: no reload in between.
  await page.getByRole('button', { name: 'Resend' }).click()
  const resend = page.getByRole('alertdialog', { name: 'Resend this email?' })
  await resend.getByLabel('Reason').fill('e2e: the customer asked again')
  await fireEmailEvent(original, 'bounced', 'hard')
  await resend.getByRole('button', { name: 'Resend' }).click()
  const refused = await apiRequest(token, 'POST', `/platform/emails/${original}/resend`, {
    reason: 'e2e: confirm the refusal',
  })
  expect(refused.status).toBe(409)
  expect((refused.body as { code?: string }).code).toBe('recipient_suppressed')

  // The refusal refreshes the message, canResend turns false and the button unmounts with its dialog: no Cancel click, no reload.
  await expect(resend).toBeHidden()
  await expect(page.getByRole('button', { name: 'Resend' })).toHaveCount(0)
  await expect(page.getByText(/This address is suppressed/)).toBeVisible()
  await expect(timeline).toContainText('Bounced · hard bounce')
  await page.getByRole('link', { name: 'View suppression' }).click()
  await expect(page).toHaveURL(/\/suppressions\?/)

  await page.getByRole('button', { name: `Lift suppression for ${customer}` }).click()
  const lift = page.getByRole('alertdialog', { name: 'Lift this suppression?' })
  await lift.getByLabel('Reason').fill('e2e: mailbox fixed')
  await lift.getByRole('button', { name: 'Lift suppression' }).click()
  await expect(page.getByText(`Suppression lifted for ${customer}.`)).toBeVisible()

  await page.goto(`/emails/${original}`)
  await page.getByRole('button', { name: 'Resend' }).click()
  const again = page.getByRole('alertdialog', { name: 'Resend this email?' })
  await again.getByLabel('Reason').fill('e2e: after the lift')
  await again.getByRole('button', { name: 'Resend' }).click()
  await expect(
    page.getByText('Resend requested — it appears in the timeline shortly')
  ).toBeVisible()

  // The resend is a new email with a fresh token, filed as resent from the original.
  const resent = await emailIdFor(token, customer, 'password_reset', [original])
  const detail = await apiRequest(token, 'GET', `/platform/emails/${resent}`)
  expect((detail.body as { data: { resentFromId: string | null } }).data.resentFromId).toBe(
    original
  )

  await page.reload()
  await timeline.getByRole('link', { name: 'a new email' }).click()
  await expect(page).toHaveURL(new RegExp(`/emails/${resent}$`))
  await expect(timeline.getByRole('link', { name: 'an earlier email' })).toHaveAttribute(
    'href',
    `/emails/${original}`
  )
})
