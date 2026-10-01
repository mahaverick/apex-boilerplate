import { expect, test, type Page } from '@playwright/test'
import {
  acceptInvitationAs,
  APEX_ORIGIN,
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  assertApiServesApex,
  backdateStepUp,
  createVerifiedUser,
  freshEmail,
  freshSlug,
  grantPlatformRole,
  logIn,
  mailedLink,
  PASSWORD,
  resetPasswordWith,
  WEB_ORIGIN,
} from './helpers'

/**
 * The staff directory against a real express (1.3.0 or newer, which
 * `assertApiServesApex` requires) with mailpit and its docker services,
 * started with `APEX_URL=http://localhost:5174`.
 * Every account is fresh, so reruns never meet the login limiter. Step-up is
 * by password only.
 */

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  // Two mailed registrations, then a staff viewer for the 1.3.0 probe (a third, plus platform:grant).
  test.setTimeout(90_000)
  if (!(await apiIsReady())) {
    throw new Error(`No API at ${API_ORIGIN}. Start express with APEX_URL=${APEX_ORIGIN}.`)
  }
  await assertApiServesApex()
})

/** A fresh staff member at `role`, signed in through the UI. */
async function signedInStaff(page: Page, role: 'admin' | 'owner'): Promise<string> {
  const email = freshEmail()
  await createVerifiedUser(email)
  await grantPlatformRole(email, role)
  await logIn(page, email)
  return email
}

/** The id of the account at `email`, looked up with a staff token. */
async function userIdOf(token: string, email: string): Promise<string> {
  const found = await apiRequest(token, 'GET', `/platform/users?q=${encodeURIComponent(email)}`)
  const users = (found.body as { data: { users: { id: string; email: string }[] } }).data.users
  return users.find((user) => user.email === email)!.id
}

test('an admin creates a user, who sets a password from the mailed link and signs in', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await signedInStaff(page, 'admin')
  const newcomer = freshEmail()

  await page.goto('/users')
  await page.getByRole('button', { name: 'New user' }).click()
  const dialog = page.getByRole('dialog', { name: 'New user' })
  await dialog.getByLabel('Email').fill(newcomer)
  await dialog.getByLabel('First name').fill('Nia')
  await dialog.getByRole('button', { name: 'Create user' }).click()
  await expect(page.getByRole('heading', { name: 'Nia', level: 1 })).toBeVisible()

  // A customer account: the set-password link goes to WEB_URL, never to Apex.
  const link = await mailedLink(newcomer, 'reset-password')
  expect(new URL(link).origin).toBe(WEB_ORIGIN)
  await resetPasswordWith(link, PASSWORD)
  // Redeeming the link verified the address, so a password login now succeeds.
  await expect(apiLogin(newcomer)).resolves.toEqual(expect.any(String))
})

test('an admin creates a tenant; the invited owner accepts; suspend hides it from them until reactivated', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await signedInStaff(page, 'admin')
  const owner = freshEmail()
  await createVerifiedUser(owner)
  const name = `E2E ${Date.now()}`
  const slug = freshSlug()

  await page.goto('/tenants')
  await page.getByRole('button', { name: 'New tenant' }).click()
  const dialog = page.getByRole('dialog', { name: 'New tenant' })
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Slug').fill(slug)
  await dialog.getByLabel('Owner email').fill(owner)
  await dialog.getByRole('button', { name: 'Create tenant' }).click()
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible()

  // A customer tenant: the invitation opens the customer app.
  const invitation = await mailedLink(owner, 'invitations/accept')
  expect(new URL(invitation).origin).toBe(WEB_ORIGIN)
  await acceptInvitationAs(owner, invitation)
  await page.reload()
  // The owners card lists the accepted owner; nothing else on the page names them by address.
  await expect(page.getByText(owner).first()).toBeVisible()

  // Signed in moments ago, so the step-up is fresh and suspend asks for nothing more.
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Suspend' }).click()
  const suspend = page.getByRole('alertdialog', { name: `Suspend ${name}?` })
  await suspend.getByLabel('Reason').fill('e2e: billing hold')
  await suspend.getByRole('button', { name: 'Suspend', exact: true }).click()
  await expect(suspend).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Confirm it’s you' })).toHaveCount(0)
  await expect(page.getByText('Suspended', { exact: true }).first()).toBeVisible()

  const ownerToken = await apiLogin(owner)
  expect((await apiRequest(ownerToken, 'GET', `/tenants/${slug}`)).status).toBe(404)

  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Reactivate' }).click()
  const reactivate = page.getByRole('alertdialog', { name: /Reactivate/ })
  await reactivate.getByLabel('Reason').fill('e2e: paid')
  await reactivate.getByRole('button', { name: 'Reactivate', exact: true }).click()
  await expect(reactivate).toBeHidden()
  await expect
    .poll(async () => (await apiRequest(ownerToken, 'GET', `/tenants/${slug}`)).status)
    .toBe(200)
})

test('a staff invitation from the Staff page mails a link that opens Apex', async ({ page }) => {
  test.setTimeout(90_000)
  await signedInStaff(page, 'admin')
  const invitee = freshEmail()
  await createVerifiedUser(invitee)

  await page.goto('/staff')
  const form = page
    .locator('form')
    .filter({ has: page.getByRole('button', { name: 'Invite member' }) })
  await form.getByLabel('Email').fill(invitee)
  await form.getByRole('button', { name: 'Invite member' }).click()
  await expect(page.getByText(`Invitation sent to ${invitee}.`)).toBeVisible()

  // The platform tenant's invitations are Apex's, as the Staff page's copy says.
  const link = await mailedLink(invitee, 'invitations/accept')
  expect(new URL(link).origin).toBe(APEX_ORIGIN)
  await acceptInvitationAs(invitee, link)
  await page.reload()
  await expect(page.getByText(invitee).first()).toBeVisible()
})

test('deleting a user with a stale sign-in asks for the password; an owner then deletes it permanently', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)
  const admin = await signedInStaff(page, 'admin')
  const target = freshEmail()
  await createVerifiedUser(target)
  const token = await apiLogin(admin)
  const targetId = await userIdOf(token, target)

  const deletes: number[] = []
  page.on('response', (response) => {
    if (
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname === `/api/v1/platform/users/${targetId}`
    ) {
      deletes.push(response.status())
    }
  })

  await backdateStepUp(admin)
  // A full page load refreshes the session, and the new access token carries the backdated auth_time.
  await page.goto(`/users/${targetId}`)
  await expect(page.getByRole('heading', { name: target, level: 1 })).toBeVisible()

  await page.getByRole('button', { name: `Actions for ${target}` }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete user' })
  await dialog.getByLabel('Reason').fill('e2e: cleanup')
  await dialog.getByLabel(`Type ${target} to confirm`).fill(target)
  await dialog.getByRole('button', { name: 'Delete user' }).click()

  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await stepUp.getByLabel('Password').fill(PASSWORD)
  await stepUp.getByRole('button', { name: 'Confirm' }).click()

  // Still signed in (a stale step-up is never a sign-out verdict), now on the deleted account's read-only page.
  await expect(page.getByText(/This account was deleted on/)).toBeVisible()
  expect(deletes).toEqual([401, 200])
  const softDeleted = await apiRequest(token, 'GET', `/platform/users/${targetId}`)
  expect(softDeleted.status).toBe(200)
  expect((softDeleted.body as { data: { deletedAt: string | null } }).data.deletedAt).not.toBeNull()

  // Only an owner deletes permanently, and nothing else applies to a deleted account, so an admin gets no menu at all.
  await expect(page.getByRole('button', { name: `Actions for ${target}` })).toHaveCount(0)

  const ownerContext = await browser.newContext({ baseURL: APEX_ORIGIN })
  try {
    const ownerPage = await ownerContext.newPage()
    await signedInStaff(ownerPage, 'owner')
    await ownerPage.goto(`/users/${targetId}`)
    await expect(ownerPage.getByText(/This account was deleted on/)).toBeVisible()

    await ownerPage.getByRole('button', { name: `Actions for ${target}` }).click()
    await ownerPage.getByRole('menuitem', { name: 'Delete permanently' }).click()
    const purge = ownerPage.getByRole('alertdialog', { name: 'Permanently delete this account?' })
    await purge.getByLabel('Reason').fill('e2e: erasure')
    await purge.getByLabel(`Type ${target} to confirm`).fill(target)
    await purge.getByRole('button', { name: 'Delete permanently' }).click()

    await expect(ownerPage).toHaveURL(/\/users\?status=deleted/)
    expect((await apiRequest(token, 'GET', `/platform/users/${targetId}`)).status).toBe(404)
  } finally {
    await ownerContext.close()
  }
})
