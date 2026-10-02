import { expect, test } from '@playwright/test'
import {
  APEX_ORIGIN,
  API_ORIGIN,
  apiIsReady,
  apiLogin,
  apiRequest,
  assertApiServesApex,
  createTenant,
  createVerifiedUser,
  emailIdFor,
  freshEmail,
  freshSlug,
  grantPlatformRole,
  logIn,
  mailedLinkStartingWith,
  tenantIdOf,
  WEB_ORIGIN,
} from './helpers'

/**
 * Onboarding against a real express (1.4.0 or newer) with mailpit: a
 * customer creates a tenant, which starts tracked and in progress; a staff
 * admin sends its owner a reminder, a tracked email whose link opens the
 * customer app, then marks a step complete; both land in the tenant's own
 * activity log.
 */

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  // Two mailed registrations, then a staff viewer for the 1.3.0 and 1.4.0 probes.
  test.setTimeout(90_000)
  if (!(await apiIsReady())) {
    throw new Error(`No API at ${API_ORIGIN}. Start express with APEX_URL=${APEX_ORIGIN}.`)
  }
  await assertApiServesApex()
})

/** One step of `GET /platform/tenants/:id/onboarding`, as far as this suite reads it. */
interface StepRow {
  key: string
  title: string
  source: string | null
  reason: string | null
}

test('a staff reminder is a tracked email to the owner, and a staff completion is in the tenant’s log', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const owner = freshEmail()
  await createVerifiedUser(owner)
  const slug = freshSlug()
  const name = `Onboarding ${slug}`
  await createTenant(await apiLogin(owner), { name, slug })

  const admin = freshEmail()
  await createVerifiedUser(admin)
  await grantPlatformRole(admin, 'admin')
  const token = await apiLogin(admin)
  const tenantId = await tenantIdOf(token, slug)
  const onboarding = await apiRequest(token, 'GET', `/platform/tenants/${tenantId}/onboarding`)
  const settings = (onboarding.body as { data: { steps: StepRow[] } }).data.steps.find(
    (step) => step.key === 'configure_settings'
  )!
  await logIn(page, admin)

  // A customer-created tenant is tracked from the start, so it is in progress, newest first.
  await page.goto('/onboarding?state=in_progress')
  await page.getByRole('table', { name: 'Onboarding tenants' }).getByRole('link', { name }).click()
  await expect(page).toHaveURL(new RegExp(`/tenants/${tenantId}/onboarding$`))
  await expect(page.getByText('In progress', { exact: true })).toBeVisible()
  await expect(page.getByText('0 of 2 required steps done')).toBeVisible()

  // The reminder names the owner's domain, never the address.
  await page.getByRole('button', { name: 'Send reminder' }).click()
  const remind = page.getByRole('alertdialog', { name: 'Send an onboarding reminder?' })
  await expect(remind).toContainText('at example.com')
  await expect(remind).not.toContainText(owner)
  await remind.getByLabel('Reason').fill('e2e: nudge after the call')
  await remind.getByRole('button', { name: 'Send reminder' }).click()
  await expect(page.getByText('Reminder sent to 1 owner.')).toBeVisible()
  await expect(page.getByText(/^Reminder sent .+; the next one can go after .+\.$/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send reminder' })).toHaveCount(0)

  // Its link opens the tenant in the customer app (express's WEB_URL), and carries no token.
  const link = await mailedLinkStartingWith(owner, `${WEB_ORIGIN}/tenants/`)
  expect(new URL(link).pathname).toBe(`/tenants/${slug}`)
  expect(new URL(link).search).toBe('')

  // The reminder is an SP3 email, and the history links to it.
  const messageId = await emailIdFor(token, owner, 'onboarding_reminder')
  const history = page.getByRole('list', { name: 'Reminders sent' })
  await expect(history).toContainText('e2e: nudge after the call')
  await history.getByRole('link', { name: 'View the email' }).click()
  await expect(page).toHaveURL(new RegExp(`/emails/${messageId}$`))
  await expect(page.getByRole('heading', { name: owner, level: 1 })).toBeVisible()
  await expect(page.getByText('Onboarding reminder', { exact: true })).toBeVisible()

  // Staff mark the settings step complete; it shows as theirs, with the reason.
  await page.goto(`/tenants/${tenantId}/onboarding`)
  await page.getByRole('button', { name: `Mark ${settings.title} complete` }).click()
  const mark = page.getByRole('alertdialog', { name: `Mark “${settings.title}” complete?` })
  await mark.getByLabel('Reason').fill('e2e: set up on the call')
  await mark.getByRole('button', { name: 'Mark complete' }).click()
  await expect(page.getByText(`Marked “${settings.title}” complete.`)).toBeVisible()
  await expect(page.getByText('1 of 2 required steps done')).toBeVisible()
  await expect(
    page
      .getByRole('list', { name: 'Onboarding steps' })
      .getByText(/· by staff: .+ — e2e: set up on the call$/)
  ).toBeVisible()
  await expect(page.getByRole('button', { name: `Mark ${settings.title} complete` })).toHaveCount(0)

  const after = await apiRequest(token, 'GET', `/platform/tenants/${tenantId}/onboarding`)
  const completed = (after.body as { data: { steps: StepRow[] } }).data.steps.find(
    (step) => step.key === 'configure_settings'
  )!
  expect([completed.source, completed.reason]).toEqual(['staff', 'e2e: set up on the call'])

  // Both are filed in the tenant itself, so its own Activity tab lists them.
  await page.goto(`/tenants/${tenantId}/activity`)
  await expect(
    page.getByText(
      'sent an onboarding reminder to 1 owner at example.com: “e2e: nudge after the call”'
    )
  ).toBeVisible()
  await expect(
    page.getByText(
      'marked the onboarding step “configure_settings” complete: “e2e: set up on the call”'
    )
  ).toBeVisible()
})
