import { expect, test, type Page } from '@playwright/test'
import { mailedLink } from '../capture/mailpit'
import {
  APEX_ORIGIN,
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  assertApiServesApex,
  assertFakeEmailWebhook,
  createUser,
  emailIdFor,
  fireEmailEvent,
  freshEmail,
  logIn,
  staffSession,
} from './helpers'

/**
 * Message tracking against a real express (6.1.0 or newer, as `assertApiServesApex` requires; `APP_ENV=local`)
 * with mailpit: a real email goes out through a staff action, provider events
 * reach it through express's fake webhook adapter (`pnpm email:fire-event`),
 * and the Apex pages follow. Resending an invitation needs a recent sign-in;
 * this flow resends a staff-sent sign-in link, so none applies.
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
  await staffSession(email, 'admin')
  const token = await apiLogin(email)
  await logIn(page, email)
  return token
}

/** The id of the account at `email`, looked up with a staff token. */
async function userIdOf(token: string, email: string): Promise<string> {
  const found = await apiRequest(
    token,
    'GET',
    `/platform/users?search=${encodeURIComponent(email)}`
  )
  const users = (found.body as { data: { items: { id: string; email: string }[] } }).data.items
  return users.find((user) => user.email === email)!.id
}

test('a hard bounce suppresses the address; once lifted, a resend goes out and links back', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const token = await signedInAdmin(page)
  const customer = freshEmail()
  await createUser(customer)
  const customerId = await userIdOf(token, customer)
  // The account's own first sign-in mailed it a sign-in link already; the staff one is told apart from it.
  const own = await emailIdFor(token, customer, 'sign_in_link')

  // The staff action sends a real email: the sign-in link reaches mailpit.
  await page.goto(`/users/${customerId}`)
  const sentAt = Date.now()
  await page.getByRole('button', { name: `Actions for ${customer}` }).click()
  await page.getByRole('menuitem', { name: 'Send sign-in link' }).click()
  const send = page.getByRole('alertdialog', { name: 'Send a sign-in link?' })
  await send.getByRole('button', { name: 'Send link' }).click()
  await expect(page.getByText(`Sign-in link sent to ${customer}.`)).toBeVisible()
  await mailedLink(customer, '/auth/link', sentAt)
  const original = await emailIdFor(token, customer, 'sign_in_link', [own])

  // The user's Emails card lists it, and opens its page.
  await page.reload()
  const card = page.getByRole('region', { name: 'Emails' })
  await card.locator(`a[href="/emails/${original}"]`).click()
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
    page.getByText('Resend requested. Reload the page to see the new email in the timeline.')
  ).toBeVisible()

  // The resend is a new email with a fresh token, filed as resent from the original.
  const resent = await emailIdFor(token, customer, 'sign_in_link', [own, original])
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
