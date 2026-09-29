import { expect, test } from '@playwright/test'
import {
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  createVerifiedUser,
  freshEmail,
  grantPlatformRole,
  logIn,
  mailedLink,
  PASSWORD,
} from './helpers'

/**
 * Apex against a real express ≥ 1.1.0 on :4040 started with
 * `APEX_URL=http://localhost:5174`, so links it mails point back here.
 * Skipped unless `E2E_LIVE=1`.
 */

/** Where express must send Apex's links: this dev server, not `WEB_URL`. */
const APEX_ORIGIN = 'http://localhost:5174'

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(`No API at ${API_ORIGIN}. Start express with APEX_URL=${APEX_ORIGIN}.`)
  }
})

test('a platform viewer signs in and sees the overview, without the admin-only items', async ({
  page,
}) => {
  const email = freshEmail()
  await createVerifiedUser(email)
  await grantPlatformRole(email, 'viewer')
  await logIn(page, email)

  await expect(page).toHaveURL(/\/overview(\?|$)/)
  await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Tenants' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Activity log' })).toHaveCount(0)
})

test('a verified user who is not staff lands on /no-access, and a reload keeps them there', async ({
  page,
}) => {
  const email = freshEmail()
  await createVerifiedUser(email)
  await logIn(page, email)

  await expect(page).toHaveURL(/\/no-access$/)
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/no-access$/)
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible()
})

test('an invited newcomer registers from the accept page, verifies from an Apex link, and joins the platform', async ({
  page,
}) => {
  // Two accounts set up through the API and a platform grant script, three mailpit polls of up to 15s each, then the UI flow.
  test.setTimeout(90_000)
  const owner = freshEmail()
  await createVerifiedUser(owner)
  await grantPlatformRole(owner, 'owner')
  const invitee = freshEmail()
  const invited = await fetch(`${API_ORIGIN}/api/v1/tenants/platform/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await apiLogin(owner)}`,
    },
    body: JSON.stringify({ email: invitee, role: 'viewer' }),
  })
  expect(invited.status).toBe(202)

  // Express decides this one: a platform invitation always links to APEX_URL.
  const accept = new URL(await mailedLink(invitee, 'invitations/accept'))
  expect(accept.origin).toBe(APEX_ORIGIN)

  // Signed out, the accept page offers a way to register with the invited address.
  await page.goto(accept.pathname + accept.search)
  await page.getByRole('link', { name: 'Create account' }).click()
  await expect(page).toHaveURL(/\/register\?invitation=/)
  const form = page.locator('form')
  const email = form.getByRole('textbox', { name: 'Email', exact: true })
  await expect(email).toHaveValue(invitee)
  await expect(email).toHaveAttribute('readonly', '')
  await form.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await form.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your email', level: 1 })).toBeVisible()

  const verify = new URL(await mailedLink(invitee, 'verify-email'))
  expect(verify.origin).toBe(APEX_ORIGIN)
  await page.goto(verify.pathname + verify.search)
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
  await page.getByRole('button', { name: 'Verify email' }).click()
  await expect(page).toHaveURL(/\/login/)
  await logIn(page, invitee)
  await expect(page).toHaveURL(/\/no-access$/)

  await page.goto(accept.pathname + accept.search)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await expect(page).toHaveURL(/\/overview(\?|$)/)
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
})
