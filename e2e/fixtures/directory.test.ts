import { expect, test } from '../hermetic'
import { afterAnimations } from '../timing'

/**
 * The directory pages in a real browser: what jsdom cannot measure is layout
 * and where focus really lands, so these assert on overflow at phone width,
 * with harness rows whose names, emails and reasons are long on purpose, and
 * on focus after the stacked step-up dialog closes.
 */

const ACME_PAGE = '/tenants/10000000-0000-4000-8000-000000000001'
const BETA_PAGE = '/tenants/10000000-0000-4000-8000-000000000002'
const DELTA_PAGE = '/tenants/10000000-0000-4000-8000-000000000004'
const CLEO_PAGE = '/users/20000000-0000-4000-8000-000000000002'
const DELETED_PAGE = '/users/20000000-0000-4000-8000-000000000003'

for (const [name, path, ready] of [
  ['users', '/users', 'Users'],
  ['a user', CLEO_PAGE, 'Cleo D'],
  ['a deleted user', DELETED_PAGE, 'Evangeline Featherstonehaugh'],
  ['staff', '/staff', 'Staff'],
  ['tenants filtered to suspended', '/tenants?state=suspended', 'Tenants'],
  ['a tenant', ACME_PAGE, 'Acme Corp'],
  ['a tenant’s members', `${ACME_PAGE}/members`, 'Acme Corp'],
  ['a tenant’s invitations', `${ACME_PAGE}/invitations`, 'Acme Corp'],
  ['a tenant’s activity', `${ACME_PAGE}/activity`, 'Acme Corp'],
  ['a suspended tenant', BETA_PAGE, 'Beta Ltd'],
  ['a suspended tenant’s frozen tab', `${BETA_PAGE}/members`, 'Beta Ltd'],
] as const) {
  test(`${name} does not scroll sideways at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 1, exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('the History cards list their entries at 390px without scrolling sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/e2e/harness/?path=${CLEO_PAGE}`)
  const userHistory = page.getByRole('region', { name: 'Recorded actions on this account' })
  await expect(userHistory.getByText(/Repeated chargebacks/)).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ).toBeLessThanOrEqual(0)

  await page.goto(`/e2e/harness/?path=${ACME_PAGE}`)
  const tenantHistory = page.getByRole('region', { name: 'Staff actions on this tenant' })
  await expect(tenantHistory.getByText(/Billing hold/)).toBeVisible()
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  ).toBeLessThanOrEqual(0)
})

test('the tenant actions menu, the suspend reason dialog and the stacked step-up fit at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/e2e/harness/?path=${ACME_PAGE}`)
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Archive' })).toBeVisible()
  const menuBox = await menu.boundingBox()
  expect(menuBox!.x).toBeGreaterThanOrEqual(0)
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390)

  await menu.getByRole('menuitem', { name: 'Suspend' }).click()
  const reason = page.getByRole('alertdialog', { name: 'Suspend Acme Corp?' })
  await reason.getByLabel('Reason').fill('layout check')
  await reason.getByRole('button', { name: 'Suspend' }).click()
  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await expect(stepUp.getByLabel('Password')).toBeVisible()
  await afterAnimations(stepUp)

  // Both dialogs are fixed-position, so they never widen the page: measure their own boxes. The reason dialog is aria-hidden under the step-up, so a role query no longer finds it.
  for (const [label, dialog] of [
    ['reason dialog', page.locator('[role="alertdialog"]')],
    ['step-up dialog', stepUp],
  ] as const) {
    const box = await dialog.boundingBox()
    expect(box, `${label} has a box`).not.toBeNull()
    expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${label} right edge`).toBeLessThanOrEqual(390)
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

for (const [name, path, trigger, item, role, dialogName, action] of [
  [
    'suspending a tenant',
    ACME_PAGE,
    'Actions',
    'Suspend',
    'alertdialog',
    'Suspend Acme Corp?',
    'Suspend',
  ],
  [
    'deactivating a user',
    CLEO_PAGE,
    'Actions for c@d.com',
    'Deactivate',
    'alertdialog',
    'Deactivate account',
    'Deactivate',
  ],
  [
    'sending an owner invitation',
    DELTA_PAGE,
    'Actions',
    'Resend owner invitation',
    'dialog',
    'Owner invitation',
    'Send invitation',
  ],
] as const) {
  test(`Escape on the stacked step-up, ${name}, leaves focus in the still-open dialog beneath`, async ({
    page,
  }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await page.getByRole('button', { name: trigger, exact: true }).click()
    await page.getByRole('menuitem', { name: item, exact: true }).click()
    const reason = page.getByRole(role, { name: dialogName })
    if (role === 'dialog') await reason.getByLabel('Owner email').fill('new-owner@example.com')
    await reason.getByLabel('Reason').fill('focus check')
    await reason.getByRole('button', { name: action, exact: true }).click()
    const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
    await expect(stepUp.getByLabel('Password')).toBeVisible()
    await expect(stepUp.getByLabel('Password')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(stepUp).toBeHidden()
    await expect(reason.getByText('Confirm it’s you to continue.')).toBeVisible()

    // Not <body>: a keyboard user must be able to Tab on inside the dialog that is still open.
    await expect
      .poll(() =>
        page.evaluate(
          (title) =>
            document.activeElement
              ?.closest('[role="dialog"], [role="alertdialog"]')
              ?.textContent?.includes(title) === true,
          dialogName
        )
      )
      .toBe(true)
    await expect(reason.getByLabel('Reason')).toHaveValue('focus check')
  })
}

test('⌘K finds a user and choosing them opens their page', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await page.keyboard.type('c@d')
  await expect(palette.getByRole('option', { name: /c@d\.com/ })).toBeVisible()
  await palette.getByRole('option', { name: /c@d\.com/ }).click()

  await expect(page.getByRole('heading', { name: 'Cleo D', level: 1 })).toBeVisible()
})
