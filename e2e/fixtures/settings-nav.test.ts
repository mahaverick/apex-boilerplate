import { expect, test } from '../hermetic'

/**
 * The sidebar's swap to the settings nav, in a real browser through the
 * harness: what jsdom cannot judge is the collapsed rail's tooltip, which needs
 * a hover, and the phone drawer, which exists only below the `md` breakpoint.
 */

test('swaps the sidebar to the settings nav on a settings page, keeping the brand and the account menu', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/settings/platform/staff')
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible()

  const nav = page.getByRole('navigation', { name: 'Settings' })
  await expect(nav.getByRole('link').first()).toHaveText('Back to console')
  await expect(nav.getByRole('link', { name: 'Staff' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Secondary' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Apex Staff console' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Account menu for/ })).toBeVisible()
})

test('Back to console returns to the main nav, whose Settings item opens the settings', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/settings/platform/staff')
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible()

  await page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Back to console' })
    .click()
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/overview(\?|$)/)
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Settings' })).toHaveCount(0)

  await page
    .getByRole('navigation', { name: 'Secondary' })
    .getByRole('link', { name: 'Settings' })
    .click()
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/settings(\?|$)/)
})

test('a settings item names itself in a tooltip when the sidebar is collapsed to icons', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/settings/account/profile')
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1)
  const maintenance = page
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Maintenance' })
  // Not vacuous: the item really is icon-sized, so the tooltip is all that shows its label.
  await expect.poll(async () => (await maintenance.boundingBox())?.width).toBeLessThanOrEqual(40)

  await maintenance.hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Maintenance')
})

test('a settings link closes the phone drawer at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/harness/?path=/settings/account/profile')
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  const drawer = page.getByRole('dialog')
  await drawer
    .getByRole('navigation', { name: 'Settings' })
    .getByRole('link', { name: 'Staff' })
    .click()

  await expect(drawer).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Staff', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/settings\/platform\/staff(\?|$)/)
})
