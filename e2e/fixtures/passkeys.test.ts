/**
 * @file Passkey sign-in through the harness, in Chrome with a virtual
 * authenticator. The harness answers `?passkeys=` and `?passkeyRefuse=` and does
 * not check a signature; what the browser builds and signs is real.
 */
import { USER_HANDLE } from '../../tests/fixtures/user-handle'
import { addVirtualAuthenticator } from '../helpers/virtual-authenticator'
import { expect, test } from '../hermetic'

/**
 * The virtual authenticator answers a conditional (autofill) request by itself,
 * so with a credential on it the login page signs in before the click, and the
 * button is gone by then. These tests report no conditional-mediation support.
 */
async function withoutAutofill(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
  })
}

test('signs in with the passkey button, posts app "apex" and lands on Overview', async ({
  page,
}) => {
  const auth = await addVirtualAuthenticator(page)
  await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  await withoutAutofill(page)
  await page.goto('/e2e/harness/?session=none&path=/login')

  const verify = page.waitForRequest('**/auth/passkeys/sign-in/verify')
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()

  expect((await verify).postDataJSON()).toMatchObject({
    app: 'apex',
    response: { type: 'public-key' },
  })
  await expect(page).toHaveURL(/\/overview/)
})

test('a non-staff passkey is refused with the staff-access message and stays on sign-in', async ({
  page,
}) => {
  const auth = await addVirtualAuthenticator(page)
  await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  await withoutAutofill(page)
  await page.goto('/e2e/harness/?session=none&passkeyRefuse=no-access&path=/login')

  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()

  await expect(
    page.getByText("This account doesn't have staff access. Ask a staff owner to invite you.")
  ).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  // The passkey stays on the authenticator.
  expect(await auth.credentials()).toHaveLength(1)
})

test('mode off shows no passkey button on sign-in', async ({ page }) => {
  const config = page.waitForResponse('**/auth/passkeys/config')
  await page.goto('/e2e/harness/?session=none&passkeys=off&path=/login')
  await config
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Apex' })).toBeVisible()
  // The email field is rendered with its final autocomplete once the config response is applied.
  await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'email')
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0)
})
