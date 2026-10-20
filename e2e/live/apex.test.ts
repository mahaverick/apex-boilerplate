import { expect, test } from '@playwright/test'
import { mailedLink } from '../capture/mailpit'
import {
  APEX_ORIGIN,
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  backdateStepUp,
  confirmStepUpByLink,
  createUser,
  freshEmail,
  logIn,
  staffSession,
} from './helpers'

/**
 * Apex against a real express ≥ 6.1.0 on :4040 started with
 * `APEX_URL=http://localhost:5174`, so links it mails point back here.
 * Skipped unless `E2E_LIVE=1`.
 */

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
  await staffSession(email, 'viewer')
  await logIn(page, email)

  await expect(page).toHaveURL(/\/overview(\?|$)/)
  await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: 'Main' })
  await expect(nav.getByRole('link', { name: 'Tenants' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Activity log' })).toHaveCount(0)
})

test('a customer session restored in Apex lands on /no-access, and a reload keeps it there', async ({
  page,
}) => {
  // An Apex link never goes to a customer, so the session is the customer app's, restored here from its cookie.
  const email = freshEmail()
  await createUser(email)
  await logIn(page, email)

  await expect(page).toHaveURL(/\/no-access$/)
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/no-access$/)
  await expect(page.getByText(`Signed in as ${email}.`)).toBeVisible()
})

test('an invited newcomer opens the invitation, confirms by the mailed link and lands on Overview', async ({
  page,
}) => {
  // The owner's session and grant, then two Mailpit polls of up to 15s each, then the UI flow.
  test.setTimeout(90_000)
  const owner = freshEmail()
  await staffSession(owner, 'owner')
  const invitee = freshEmail()
  const invitedAt = Date.now()
  const invited = await fetch(`${API_ORIGIN}/api/v1/tenants/platform/invitations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${await apiLogin(owner)}`,
    },
    body: JSON.stringify({ email: invitee, role: 'viewer' }),
  })
  expect(invited.status).toBe(202)

  // express picks the origin: a platform invitation links to APEX_URL.
  const accept = await mailedLink(invitee, '/invitations/accept', invitedAt)
  expect(accept.origin).toBe(APEX_ORIGIN)

  // Signed out, a staff invitation always confirms by a mailed link: the verify answers 202 and the page says so.
  const verifiedAt = Date.now()
  await page.goto(accept.pathname + accept.search)
  await expect(page.getByRole('heading', { name: 'Check your inbox', level: 1 })).toBeVisible()
  await expect(page.getByText(`We sent a link to ${invitee}.`)).toBeVisible()

  const confirm = await mailedLink(invitee, '/invitations/confirm', verifiedAt)
  expect(confirm.origin).toBe(APEX_ORIGIN)
  await page.goto(confirm.pathname + confirm.search)
  await expect(page).toHaveURL(/\/overview(\?|$)/)
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
})

test('confirms a destructive action by email link in the same browser', async ({ page }) => {
  // Two sessions, the backdate, a Mailpit poll and a second tab.
  test.setTimeout(120_000)
  const admin = freshEmail()
  await staffSession(admin, 'admin')
  const target = freshEmail()
  await createUser(target)
  const token = await apiLogin(admin)
  const targetId = await userIdOf(token, target)
  await logIn(page, admin)

  await backdateStepUp(admin)
  // A full page load refreshes the session, and the new access token carries the backdated auth_time.
  await page.goto(`/users/${targetId}`)
  await expect(page.getByRole('heading', { name: target, level: 1 })).toBeVisible()
  await page.getByRole('button', { name: `Actions for ${target}` }).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete user' })
  await dialog.getByLabel('Reason').fill('e2e: step-up by link')
  await dialog.getByLabel(`Type ${target} to confirm`).fill(target)
  await dialog.getByRole('button', { name: 'Delete user' }).click()

  await confirmStepUpByLink(page, admin)

  await expect(page.getByText(/This account was deleted on/)).toBeVisible()
  const deleted = await apiRequest(token, 'GET', `/platform/users/${targetId}`)
  expect((deleted.body as { data: { deletedAt: string | null } }).data.deletedAt).not.toBeNull()
})

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

test('a viewer sees the flag registry with a note in place of the Evaluate form', async ({
  page,
}) => {
  const email = freshEmail()
  await staffSession(email, 'viewer')
  await logIn(page, email)

  await page.goto('/settings/platform/flags')
  await expect(page.getByRole('heading', { name: 'Feature flags', level: 1 })).toBeVisible()
  const registry = page.getByRole('table', { name: 'Registered flags', exact: true })
  await expect(registry.getByRole('row').nth(1)).toBeVisible()
  await expect(page.getByRole('region', { name: 'Traits reference' })).toBeVisible()
  const evaluate = page.getByRole('region', { name: 'Evaluate' })
  await expect(evaluate.getByText('Admins can evaluate flags for a user.')).toBeVisible()
  await expect(evaluate.getByRole('searchbox')).toHaveCount(0)
})

test('an admin evaluates one user twice and the Activity log records it once', async ({ page }) => {
  // express throttles the audit entry: a second evaluation of the same user inside the window writes none.
  test.setTimeout(90_000)
  const admin = freshEmail()
  await staffSession(admin, 'admin')
  const subject = freshEmail()
  await createUser(subject)
  const token = await apiLogin(admin)
  const subjectId = await userIdOf(token, subject)
  await logIn(page, admin)

  await page.goto(`/settings/platform/flags?userId=${subjectId}&app=react`)
  const panel = page.getByRole('region', { name: 'Evaluate' })
  await expect(panel.getByRole('table', { name: 'Evaluation' })).toBeVisible()

  // The same user again, as a direct API request: the page's own query stays fresh for 30 s.
  const again = await apiRequest(
    token,
    'GET',
    `/platform/flags/evaluate?userId=${subjectId}&app=react`
  )
  expect(again.status).toBe(200)

  // By URL, so the test names its own admin without depending on the Actor facet's search.
  const adminId = await userIdOf(token, admin)
  await page.goto(`/activity?actor=${adminId}`)
  await page.getByRole('button', { name: 'Filter by action, Activity' }).click()
  await page
    .getByRole('dialog', { name: 'Filter by action, Activity' })
    .getByRole('checkbox', { name: 'User flags evaluated', exact: true })
    .click()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: /^Filter by actor, Activity, 1 selected/ })
  ).toBeVisible()
  const log = page.getByRole('table', { name: 'Activity' })
  await expect(log.getByRole('row').filter({ hasText: 'evaluated' })).toHaveCount(1)
  await expect(log.getByText(/evaluated a user’s feature flags for the customer app/)).toBeVisible()
})
