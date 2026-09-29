import { expect, test } from '../hermetic'

/**
 * The Overview in a real browser. jsdom has no layout, so recharts draws no
 * marks there and the unit tests assert on the hidden tables instead; this is
 * where the charts are proved to actually paint.
 */

test('draws both charts and switches the window through the URL', async ({ page }) => {
  await page.goto('/e2e/harness/')

  const signups = page.getByRole('figure', { name: 'Sign-ups per day' })
  const emails = page.getByRole('figure', { name: 'Emails per day' })
  await expect(signups.locator('.recharts-area-area')).toHaveCount(2)
  // Seven days of sent bars, and the one day with a failed attempt.
  await expect(emails.locator('.recharts-bar-rectangle path')).toHaveCount(8)

  await page.getByRole('button', { name: '30 days' }).click()
  await expect(page).toHaveURL(/[?&]range=30d/)
  await expect(page.getByText('Send attempts (30 days)')).toBeVisible()
})

test('does not scroll sideways at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/harness/?path=/overview')
  // The loaded page, charts included: a skeleton is narrower than what replaces it.
  await expect(page.locator('[data-slot="chart"] svg.recharts-surface')).toHaveCount(2)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('collapses the sidebar to icons and keeps each item named', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Toggle sidebar' }).click()

  // Not vacuous: the rail really collapsed, so each link is an icon-sized button whose name is all that is left of its label.
  await expect(page.locator('[data-slot="sidebar"][data-state="collapsed"]')).toHaveCount(1)
  const nav = page.getByRole('navigation', { name: 'Main' })
  for (const label of ['Overview', 'Tenants', 'Activity log']) {
    const link = nav.getByRole('link', { name: label })
    await expect(link).toBeVisible()
    await expect.poll(async () => (await link.boundingBox())?.width).toBeLessThanOrEqual(40)
  }
})

test('⌘K finds a page and Enter opens it', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette.getByRole('option', { name: 'Overview' })).toBeVisible()
  await page.keyboard.type('tenants')
  await expect(palette.getByRole('option', { name: 'Tenants' })).toBeVisible()
  await page.keyboard.press('Enter')

  await expect(page.getByRole('heading', { name: 'Tenants', level: 1 })).toBeVisible()
  await expect(page).toHaveURL(/\/tenants(\?|$)/)
  await expect(palette).toHaveCount(0)
})
