import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * Message tracking's pages in a real browser, through the harness. jsdom has
 * no layout, so what these check is what it cannot: nothing scrolls sideways
 * at 390px (the harness's longest address is on purpose), the Deliverability
 * chart really paints, and the preview frame is sandboxed at its fixed height.
 */

const DELIVERED = '/emails/70000000-0000-4000-8000-000000000001'
const BOUNCED = '/emails/70000000-0000-4000-8000-000000000002'
const LONG_ADDRESS = 'a-very-long-address-for-overflow@example-company-domain.com'
const ACME_EMAILS = '/tenants/10000000-0000-4000-8000-000000000001/emails'

for (const [name, path, ready] of [
  ['the emails list', '/emails', 'Emails'],
  ['a delivered email', DELIVERED, 'c@d.com'],
  ['a suppressed email', BOUNCED, LONG_ADDRESS],
  ['an email’s preview', `${DELIVERED}?tab=preview`, 'c@d.com'],
  ['deliverability', '/deliverability', 'Deliverability'],
  ['deliverability without provider events', '/deliverability?range=30d', 'Deliverability'],
  ['suppressions, active and lifted', '/suppressions?state=all', 'Suppressions'],
  ['a tenant’s emails', ACME_EMAILS, 'Acme Corp'],
] as const) {
  test(`${name} does not scroll sideways at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 1 })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)

    const overflow = await sidewaysOverflow(page)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('deliverability paints its five-group chart and every figure', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/deliverability')
  const figures = page.getByRole('region', { name: 'Deliverability figures' })
  await expect(figures.locator('[data-slot="card"]')).toHaveCount(7)
  // The harness's week: seven sent segments and one undelivered; zero-height segments draw no path.
  const chart = page.getByRole('figure', { name: 'Emails per day' })
  await expect(chart.locator('.recharts-bar-rectangle path')).toHaveCount(8)
  await expect(page.getByRole('note')).toHaveCount(0)
})

test('deliverability without provider events keeps the chart under the banner', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/deliverability?range=30d')
  await expect(page.getByRole('note')).toContainText('No provider events yet')
  await expect(page.getByText('No provider data', { exact: true })).toHaveCount(5)
  const chart = page.getByRole('figure', { name: 'Emails per day' })
  await expect(chart.locator('.recharts-bar-rectangle path')).toHaveCount(8)
})

test('the preview is a sandboxed frame at a fixed height, with its own scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/e2e/harness/?path=${DELIVERED}?tab=preview`)
  const frame = page.getByTitle('Email preview')
  await expect(frame).toBeVisible()
  // `sandbox=""` grants nothing: no script, no same origin, no top navigation.
  await expect(frame).toHaveAttribute('sandbox', '')
  await expect(frame).toHaveAttribute('srcdoc', /Reset your password/)
  await expect.poll(async () => (await frame.boundingBox())?.height).toBe(640)
})

test('the lift dialog fits at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/harness/?path=/suppressions')
  await expect(page.getByRole('heading', { name: 'Suppressions', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: `Lift suppression for ${LONG_ADDRESS}` }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Lift this suppression?' })
  await expect(dialog.getByLabel('Reason')).toBeVisible()

  const overflow = await sidewaysOverflow(page)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the resend dialog fits at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/e2e/harness/?path=${DELIVERED}`)
  await expect(page.getByRole('heading', { name: 'c@d.com', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: 'Resend' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Resend this email?' })
  await expect(dialog.getByLabel('Reason')).toBeVisible()

  const overflow = await sidewaysOverflow(page)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('⌘K lists the three Operations pages', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  for (const name of ['Emails', 'Deliverability', 'Suppressions']) {
    await expect(palette.getByRole('option', { name })).toBeVisible()
  }
  await page.keyboard.type('suppr')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Suppressions', level: 1 })).toBeVisible()
})
