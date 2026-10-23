/**
 * @file Passkeys against a real express: a staff member signs in by link,
 * creates a passkey in Settings › Security, signs out, then signs in with the
 * passkey button. Chrome's virtual authenticator holds the passkey. It needs an
 * express 8.0.1 or later with passkeys `optional` or `required` and its relying
 * party id `localhost`, so it is skipped unless `E2E_LIVE=1`; run it with
 * `pnpm test:e2e:live`. It calls no helper that starts or stops a process.
 */
import { expect, test } from '@playwright/test'
import { addVirtualAuthenticator } from '../helpers/virtual-authenticator'
import {
  API_ORIGIN,
  apiIsReady,
  assertApiServesApex,
  freshEmail,
  logIn,
  staffSession,
} from './helpers'

/** Playwright's message for a call on a page, context or browser that is already closed. */
const TARGET_CLOSED = 'Target page, context or browser has been closed'

test.skip(process.env.E2E_LIVE !== '1', 'live backend required — run pnpm test:e2e:live')

test.beforeAll(async () => {
  if (!(await apiIsReady())) {
    throw new Error(
      `No API at ${API_ORIGIN}. Start express 8.0.1 or later first: pnpm db:migrate && pnpm dev`
    )
  }
  await assertApiServesApex()
})

test('a staff member creates a passkey, signs out and signs back in with it', async ({ page }) => {
  const email = freshEmail()
  await staffSession(email, 'viewer')
  const auth = await addVirtualAuthenticator(page)
  // The virtual authenticator answers autofill by itself, so /login would sign in before the click; hide autofill so the button is the way in.
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
  })

  try {
    await logIn(page, email)
    await page.goto('/settings/account/security')
    await expect(page.getByRole('heading', { name: 'Passkeys' })).toBeVisible()

    // The link sign-in is recent, so creating needs no confirmation dialog.
    await page.getByRole('button', { name: 'Create a passkey' }).click()
    await expect(page.getByText('Passkey created.')).toBeVisible()
    // A toast is a Base UI dialog too, so only the Confirm it's you dialog counts.
    await expect(page.getByRole('dialog', { name: /Confirm it/ })).toHaveCount(0)
    expect(await auth.credentials()).toHaveLength(1)

    await page.getByRole('button', { name: /Account menu for/ }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/login/)

    const verify = page.waitForRequest('**/auth/passkeys/sign-in/verify')
    await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
    await verify
    await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible({
      timeout: 15_000,
    })
  } finally {
    // After a test timeout Playwright has closed the page, and the authenticator with it; that throw would replace the real failure.
    await auth.remove().catch((error: unknown) => {
      if (!(error instanceof Error && error.message.includes(TARGET_CLOSED))) throw error
    })
  }
})
