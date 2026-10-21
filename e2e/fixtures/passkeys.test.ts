/**
 * @file Passkeys through the harness, in Chrome with a virtual authenticator:
 * sign-in, "Confirm it's you", the Security section and required mode. The
 * harness answers the contract's calls (`?passkeys=`, `?passkeylist=`,
 * `?setup=1`, `?passkeyuser=`) and does not check a signature; what the browser
 * builds and signs is real.
 */
import type { Page } from '@playwright/test'
import type { QueryClient } from '@tanstack/react-query'
import { USER_HANDLE } from '../../tests/fixtures/user-handle'
import { addVirtualAuthenticator } from '../helpers/virtual-authenticator'
import { expect, test } from '../hermetic'

/** Acme's tenant page, where the suspend flow starts. */
const ACME_PAGE = '/tenants/10000000-0000-4000-8000-000000000001'

/** The harness URL for `path` with `query` (already `&`-joined). */
function harness(path: string, query = ''): string {
  return `/e2e/harness/?path=${path}${query ? `&${query}` : ''}`
}

/** The page's root element is no wider than the viewport. */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  expect(overflows, 'the page scrolls sideways').toBe(false)
}

/** The JSON bodies the page POSTed to `path`, in order. */
function postsTo(page: Page, path: string): unknown[] {
  const bodies: unknown[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === path) {
      bodies.push(request.postDataJSON())
    }
  })
  return bodies
}

/**
 * The virtual authenticator answers a conditional (autofill) request by itself,
 * so with a credential on it the login page signs in before the click, and the
 * button is gone by then. The page reports no conditional-mediation support.
 */
async function withoutAutofill(page: Page): Promise<void> {
  await page.addInitScript(() => {
    PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false)
  })
}

test('signs in with the passkey button, posts app "apex", and lands on Overview', async ({
  page,
}) => {
  const auth = await addVirtualAuthenticator(page)
  await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  await withoutAutofill(page)
  await page.goto(harness('/login', 'session=none'))

  const verify = page.waitForRequest('**/auth/passkeys/sign-in/verify')
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()

  expect((await verify).postDataJSON()).toMatchObject({
    app: 'apex',
    response: { type: 'public-key' },
  })
  await expect(page).toHaveURL(/\/overview/)
  await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
})

test('refuses a non-staff passkey and the authenticator keeps it', async ({ page }) => {
  const auth = await addVirtualAuthenticator(page)
  await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  await withoutAutofill(page)
  // Counts calls to signalUnknownCredential; a refused-but-known passkey must never send one.
  await page.addInitScript(() => {
    const counted = window as unknown as { __signals: number }
    counted.__signals = 0
    Object.defineProperty(PublicKeyCredential, 'signalUnknownCredential', {
      configurable: true,
      value: () => {
        counted.__signals += 1
        return Promise.resolve()
      },
    })
  })
  await page.goto(harness('/login', 'session=none&passkeyuser=customer'))

  const verify = page.waitForRequest('**/auth/passkeys/sign-in/verify')
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  await verify

  // express #144's apex message; the regex accepts either apostrophe.
  await expect(page.getByText(/This account doesn.t have staff access/)).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  expect(await page.evaluate(() => (window as unknown as { __signals: number }).__signals)).toBe(0)
  expect(await auth.credentials()).toHaveLength(1)
})

test('mode off shows no passkey button on sign-in and no Passkeys section in Security', async ({
  page,
}) => {
  const listed: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/auth/passkeys') listed.push(request.method())
  })
  const config = page.waitForResponse('**/auth/passkeys/config')
  await page.goto(harness('/login', 'session=none&passkeys=off'))
  await config
  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to Apex' })).toBeVisible()
  await expectConfigApplied(page)
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with a passkey' })).toHaveCount(0)

  const securityConfig = page.waitForResponse('**/auth/passkeys/config')
  await page.goto(harness('/settings/account/security', 'passkeys=off'))
  await securityConfig
  await expect(page.getByRole('button', { name: 'Sign out other sessions' })).toBeVisible()
  await expectConfigApplied(page)
  await expect(page.getByRole('heading', { name: 'Passkeys' })).toHaveCount(0)
  expect(listed, 'the list is never read in mode off').toEqual([])
})

/**
 * Waits until the page's passkey-config query has succeeded and one frame has
 * painted from it, so a count of 0 afterwards is the settled answer, not the
 * state before the response landed.
 */
async function expectConfigApplied(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const client = (window as unknown as { __queryClient: QueryClient }).__queryClient
    return client.getQueryState(['passkeys', 'config'])?.status === 'success'
  })
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
  )
}

test('suspending a tenant confirms it’s you with the passkey and the suspend lands', async ({
  page,
}) => {
  const auth = await addVirtualAuthenticator(page)
  await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  const suspends: number[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/suspend')) suspends.push(response.status())
  })
  const confirms = postsTo(page, '/api/v1/auth/passkeys/step-up/verify')
  await page.goto(harness(ACME_PAGE, 'stepup=once&passkeylist=one'))
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Suspend' }).click()
  const reason = page.getByRole('alertdialog', { name: 'Suspend Acme Corp?' })
  await reason.getByLabel('Reason').fill('passkey check')
  await reason.getByRole('button', { name: 'Suspend', exact: true }).click()

  await expect(page.getByText('Suspended', { exact: true }).first()).toBeVisible()
  expect(suspends).toEqual([401, 200])
  expect(confirms).toEqual([
    expect.objectContaining({ challengeId: 'harness-step-up', response: expect.any(Object) }),
  ])
  expect(confirms[0]).not.toHaveProperty('app')
})

test('Confirm it’s you → Use another method shows Email me a link', async ({ page }) => {
  // No credential on the authenticator: the automatic prompt ends without a passkey.
  await addVirtualAuthenticator(page)
  await page.goto(harness('/settings/account/security', 'passkeylist=one'))

  await page.getByRole('button', { name: 'Create a passkey' }).click()
  const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Use another method' }).click()

  await expect(dialog.getByRole('button', { name: 'Email me a link' })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Use your passkey instead' })).toBeVisible()
})

test('creates a passkey after Confirm it’s you, then deletes one; required mode refuses the last', async ({
  page,
}) => {
  const auth = await addVirtualAuthenticator(page)
  const seeded = await auth.addResidentCredential({ rpId: 'localhost', userHandle: USER_HANDLE })
  const confirms = postsTo(page, '/api/v1/auth/passkeys/step-up/verify')
  const registrations = postsTo(page, '/api/v1/auth/passkeys/registration/verify')
  await page.goto(harness('/settings/account/security', 'passkeylist=one'))
  await expect(page.getByRole('listitem').filter({ hasText: 'MacBook Touch ID' })).toBeVisible()

  await page.getByRole('button', { name: 'Create a passkey' }).click()

  await expect(page.getByText('Passkey created.')).toBeVisible()
  expect(confirms).toHaveLength(1)
  expect(registrations).toEqual([
    expect.objectContaining({
      challengeId: 'harness-registration',
      app: 'apex',
      response: expect.objectContaining({ type: 'public-key' }),
    }),
  ])
  await expect(page.getByRole('listitem').filter({ hasText: 'Passkey 3' })).toBeVisible()
  // One user handle holds one resident credential per site, so the new passkey replaced the seeded one.
  const held = await auth.credentials()
  expect(held).toHaveLength(1)
  expect(held[0]!.credentialId).not.toBe(seeded)

  // The confirmation is recent now, so the delete needs no dialog.
  await page.getByRole('button', { name: 'Delete MacBook Touch ID' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Delete “MacBook Touch ID”?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete passkey' }).click()
  await expect(page.getByText('Passkey deleted.')).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: 'MacBook Touch ID' })).toHaveCount(0)

  // Required mode, one passkey: the dialog refuses and offers only Close.
  await page.goto(harness('/settings/account/security', 'passkeys=required&passkeylist=one'))
  await page.getByRole('button', { name: 'Delete MacBook Touch ID' }).click()
  const refusal = page.getByRole('alertdialog', { name: 'Delete “MacBook Touch ID”?' })
  await expect(
    refusal.getByText(
      'Create another passkey before you delete this one. Your account needs at least one.'
    )
  ).toBeVisible()
  await expect(refusal.getByRole('button', { name: 'Delete passkey' })).toHaveCount(0)
  await refusal.getByRole('button', { name: 'Close' }).click()
  await expect(refusal).toHaveCount(0)
})

test('required mode shows Create your passkey on /tenants and, after creating, the Tenants page (setup=1)', async ({
  page,
}) => {
  await addVirtualAuthenticator(page)
  await page.goto(harness('/tenants', 'passkeys=required&setup=1'))

  await expect(page.getByRole('heading', { level: 1, name: 'Create your passkey' })).toBeVisible()
  await expect(
    page.getByText('Create a passkey to continue. Every account here needs one.')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  await page.getByRole('button', { name: 'Create a passkey' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Create your passkey' })).toHaveCount(0)
  await expect(page).toHaveURL(/\/tenants/)
})

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('the setup screen and the passkey dialogs fit 390px wide with no horizontal scroll', async ({
    page,
  }) => {
    await page.goto(harness('/tenants', 'passkeys=required&setup=1'))
    await expect(page.getByRole('heading', { level: 1, name: 'Create your passkey' })).toBeVisible()
    await expectNoOverflow(page)

    await page.goto(harness('/settings/account/security', 'passkeylist=two'))
    await expect(page.getByRole('listitem').filter({ hasText: 'Work security key' })).toBeVisible()
    await expectNoOverflow(page)

    await page.getByRole('button', { name: 'Rename Work security key' }).click()
    const rename = page.getByRole('dialog', { name: 'Rename passkey' })
    await expect(rename).toBeVisible()
    await expectNoOverflow(page)
    expect((await rename.boundingBox())!.width).toBeLessThanOrEqual(390)
    await rename.getByRole('button', { name: 'Cancel' }).click()
    await expect(rename).toHaveCount(0)

    await page.getByRole('button', { name: 'Delete Work security key' }).click()
    const remove = page.getByRole('alertdialog', { name: 'Delete “Work security key”?' })
    await expect(remove).toBeVisible()
    await expectNoOverflow(page)
    expect((await remove.boundingBox())!.width).toBeLessThanOrEqual(390)
  })

  test('the Confirm it’s you dialog fits 390px wide', async ({ page }) => {
    await page.goto(harness('/settings/account/security'))
    await page.getByRole('button', { name: 'Create a passkey' }).click()
    const dialog = page.getByRole('dialog', { name: 'Confirm it’s you' })
    await expect(dialog.getByRole('button', { name: 'Email me a link' })).toBeVisible()
    await expectNoOverflow(page)
    expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(390)
  })
})
