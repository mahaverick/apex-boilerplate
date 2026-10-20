/**
 * @file Signing in by an emailed link and joining staff by an invitation,
 * through the harness on a phone-sized viewport. `?session=none` starts
 * signed out; `?link=`, `?invite=` and `?inviteconfirm=` pick what the verify,
 * accept and confirm endpoints answer. Each state also passes the 390 px
 * overflow check, which jsdom cannot make, and each countdown is run out on
 * Playwright's clock, which only the compiled build can fail.
 */
import type { Page } from '@playwright/test'
import { expect, test } from '../hermetic'

const MOBILE = { width: 390, height: 844 }

/** A token every page's schema takes: 43 base64url characters, low-entropy so no scanner reads it as a secret. */
const TOKEN = 't'.repeat(43)

/** The harness user's address, which the link and confirm answers sign in. */
const HARNESS_EMAIL = 'a.b@example.com'

/** The address the harness's staff invitation is for. */
const INVITEE_EMAIL = 'new.staff@example.com'

/** The harness URL mounting `path` with `query` (already `&`-joined, values encoded). */
function harness(path: string, query: string): string {
  return `/e2e/harness/?path=${path}&${query}`
}

/** The page's root element is no wider than the viewport: nothing pushes the layout sideways. */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  expect(overflows, 'the page scrolls sideways at 390 px').toBe(false)
}

/** The `POST` bodies the page sent to `path`, as their parsed JSON, in order. */
function postsTo(page: Page, path: string): unknown[] {
  const bodies: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path) {
      bodies.push(request.postDataJSON())
    }
  })
  return bodies
}

test.use({ viewport: MOBILE })

test.describe('sign-in link', () => {
  test('sends an Apex link, then shows Check your inbox with a Resend that counts down and opens', async ({
    page,
  }) => {
    const requests = postsTo(page, '/api/v1/auth/link/request')
    // The fake clock runs out the 60-second resend countdown without waiting for it.
    await page.clock.install()
    await page.goto(harness('/login', 'session=none'))
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Apex' })).toBeVisible()

    await page.getByRole('textbox', { name: 'Email', exact: true }).fill('ada@example.test')
    await page.getByRole('button', { name: 'Email me a sign-in link' }).click()

    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    await expect(page.getByText('We sent a sign-in link to ada@example.test.')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Resend in \d:\d\d/ })).toBeDisabled()
    expect(requests).toEqual([expect.objectContaining({ email: 'ada@example.test', app: 'apex' })])
    await expectNoOverflow(page)

    // The countdown moves in the compiled build, and Resend opens once it runs out.
    await page.clock.fastForward('00:02')
    await expect(page.getByRole('button', { name: /^Resend in 0:5\d/ })).toBeVisible()
    await page.clock.fastForward('01:00')
    await expect(page.getByRole('button', { name: /^Resend link/ })).toBeEnabled()
  })

  test('a good link lands on Overview and posts its token once', async ({ page }) => {
    const verifies = postsTo(page, '/api/v1/auth/link/verify')
    await page.goto(
      harness('/auth/link', `session=none&link=ok&token=${TOKEN}&email=${HARNESS_EMAIL}`)
    )

    await expect(page).toHaveURL(/\/overview(\?|$)/)
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    expect(verifies).toEqual([{ token: TOKEN, email: HARNESS_EMAIL }])
    await expectNoOverflow(page)
  })

  test('a dead link prefills the address, and one click shows Check your inbox', async ({
    page,
  }) => {
    await page.goto(
      harness('/auth/link', `session=none&link=dead&token=${TOKEN}&email=${HARNESS_EMAIL}`)
    )

    await expect(
      page.getByRole('heading', { level: 1, name: 'This link expired or was already used' })
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
      HARNESS_EMAIL
    )
    await expectNoOverflow(page)

    await page.getByRole('button', { name: 'Email me a new link' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    await expectNoOverflow(page)
  })

  test('a read-only answer offers Try again, not the dead link', async ({ page }) => {
    await page.goto(
      harness('/auth/link', `session=none&link=readonly&token=${TOKEN}&email=${HARNESS_EMAIL}`)
    )

    await expect(
      page.getByRole('heading', { level: 1, name: "We couldn't sign you in" })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveCount(0)
    await expectNoOverflow(page)
  })

  test('signed in as someone else, a link asks before switching and spends nothing', async ({
    page,
  }) => {
    const verifies = postsTo(page, '/api/v1/auth/link/verify')
    await page.goto(harness('/auth/link', `token=${TOKEN}&email=${INVITEE_EMAIL}`))

    await expect(page.getByRole('heading', { level: 1, name: 'Switch account?' })).toBeVisible()
    await expect(page.getByRole('button', { name: `Continue as ${INVITEE_EMAIL}` })).toBeVisible()
    await expect(
      page.getByRole('button', { name: `Stay signed in as ${HARNESS_EMAIL}` })
    ).toBeVisible()
    expect(verifies).toEqual([])
    await expectNoOverflow(page)
  })
})

test.describe('staff invitation', () => {
  test('signed in as the invitee, the accept page joins on load and lands on Overview', async ({
    page,
  }) => {
    const accepts = postsTo(page, '/api/v1/invitations/accept')
    await page.goto(harness('/invitations/accept', `invite=ok&token=${TOKEN}`))

    await expect(page.getByText(`You joined Platform as ${HARNESS_EMAIL}.`)).toBeVisible()
    await expect(page).toHaveURL(/\/overview(\?|$)/)
    expect(accepts).toEqual([{ token: TOKEN }])
    await expectNoOverflow(page)
  })

  test('signed in as the invitee, a used link says you have already joined', async ({ page }) => {
    const accepts = postsTo(page, '/api/v1/invitations/accept')
    await page.goto(harness('/invitations/accept', `invite=joined&token=${TOKEN}`))

    await expect(
      page.getByText(`You've already joined Platform as ${HARNESS_EMAIL}.`)
    ).toBeVisible()
    await expect(page).toHaveURL(/\/overview(\?|$)/)
    expect(accepts).toEqual([{ token: TOKEN }])
    await expectNoOverflow(page)
  })

  test('signed out, Check your inbox names the invited address, and Resend posts the same token again', async ({
    page,
  }) => {
    const verifies = postsTo(page, '/api/v1/invitations/verify')
    // The fake clock runs out the 60-second resend countdown without waiting for it.
    await page.clock.install()
    await page.goto(harness('/invitations/accept', `session=none&token=${TOKEN}`))

    await expect(page.getByRole('heading', { level: 1, name: 'Check your inbox' })).toBeVisible()
    await expect(page.getByText(`We sent a link to ${INVITEE_EMAIL}.`)).toBeVisible()
    await expect(page.getByText('Open it to join Platform.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Resend in \d:\d\d/ })).toBeDisabled()
    await expectNoOverflow(page)

    await page.clock.fastForward('00:02')
    await expect(page.getByRole('button', { name: /^Resend in 0:5\d/ })).toBeVisible()
    await page.clock.fastForward('01:00')
    const resend = page.getByRole('button', { name: /^Resend link/ })
    await expect(resend).toBeEnabled()
    await resend.click()

    await expect(page.getByRole('button', { name: /^Resend in \d:\d\d/ })).toBeDisabled()
    expect(verifies).toEqual([{ token: TOKEN }, { token: TOKEN }])
    await expectNoOverflow(page)
  })

  test('signed out, a dead invitation says so and offers a sign-in link', async ({ page }) => {
    await page.goto(harness('/invitations/accept', `session=none&invite=dead&token=${TOKEN}`))

    await expect(
      page.getByRole('heading', { level: 1, name: 'This invitation can’t be used' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Email me a sign-in link' })).toBeVisible()
    await expectNoOverflow(page)
  })

  test('a confirmation link lands on Overview, posting its token and address once', async ({
    page,
  }) => {
    const confirms = postsTo(page, '/api/v1/invitations/confirm')
    await page.goto(
      harness(
        '/invitations/confirm',
        `session=none&inviteconfirm=ok&token=${TOKEN}&email=${INVITEE_EMAIL}`
      )
    )

    await expect(page.getByText(`You joined Platform as ${HARNESS_EMAIL}.`)).toBeVisible()
    await expect(page).toHaveURL(/\/overview(\?|$)/)
    expect(confirms).toEqual([{ token: TOKEN, email: INVITEE_EMAIL }])
    await expectNoOverflow(page)
  })

  test('a dead confirmation link says so, prefills a sign-in link and drops the token', async ({
    page,
  }) => {
    await page.goto(
      harness(
        '/invitations/confirm',
        `session=none&inviteconfirm=dead&token=${TOKEN}&email=${INVITEE_EMAIL}`
      )
    )

    await expect(
      page.getByRole('heading', { level: 1, name: "This link can't be used" })
    ).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(
      INVITEE_EMAIL
    )
    // The refused token leaves the address bar; the address stays for the form.
    await expect(page).not.toHaveURL(/token=/)
    await expectNoOverflow(page)
  })

  test('a read-only answer on a confirmation link offers Try again', async ({ page }) => {
    await page.goto(
      harness(
        '/invitations/confirm',
        `session=none&inviteconfirm=readonly&token=${TOKEN}&email=${INVITEE_EMAIL}`
      )
    )

    await expect(
      page.getByRole('heading', { level: 1, name: 'We couldn’t add you to your team' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expectNoOverflow(page)
  })

  test('signed in as someone else, a confirmation link asks before switching', async ({ page }) => {
    const confirms = postsTo(page, '/api/v1/invitations/confirm')
    await page.goto(harness('/invitations/confirm', `token=${TOKEN}&email=${INVITEE_EMAIL}`))

    await expect(page.getByRole('heading', { level: 1, name: 'Join your team' })).toBeVisible()
    await expect(page.getByRole('button', { name: `Continue as ${INVITEE_EMAIL}` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    expect(confirms).toEqual([])
    await expectNoOverflow(page)
  })
})
