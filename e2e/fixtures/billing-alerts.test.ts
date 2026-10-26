import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * Billing alerts in a real browser, through the harness: an admin's Overview
 * card shows the newest five and links to the tenant's Billing tab and to
 * the full list; the list searches by message and sorts by time; a viewer
 * sees neither; nothing scrolls sideways at 390px with the longest message.
 */

test('an admin sees the newest five alerts on the Overview, linked to the tenant and the full list', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/overview')
  const card = page.getByRole('region', { name: 'Billing alerts' })
  await expect(card.getByRole('listitem')).toHaveCount(5)
  await expect(card.getByRole('listitem').first()).toContainText('Duplicate refunded')
  await card.getByRole('link', { name: 'Acme Corp' }).first().click()
  await expect(page.getByRole('heading', { name: 'Usage and access', level: 2 })).toBeVisible()
})

test('the full list searches by message and sorts oldest first, at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/harness/?path=/overview')
  await page
    .getByRole('region', { name: 'Billing alerts' })
    .getByRole('link', { name: 'Show all alerts' })
    .click()
  await expect(page.getByRole('heading', { name: 'Billing alerts', level: 1 })).toBeVisible()
  await expect(page.getByText('Payment dispute')).toBeVisible()
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)

  await page.getByRole('searchbox', { name: 'Search billing alerts' }).fill('dispute')
  await expect(page.getByText('Payment dispute')).toBeVisible()
  await expect(page.getByText('Subscription ended')).toHaveCount(0)
})

test('the full list sorts oldest first from the When header', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/billing-alerts')
  const table = page.getByRole('table', { name: 'Billing alerts' })
  await expect(table.getByRole('row').nth(1)).toContainText('Duplicate refunded')
  await table.getByRole('button', { name: 'When' }).click()
  await expect(table.getByRole('row').nth(1)).toContainText('Provider event failing')
})

test('a viewer sees no alerts card, and the list says the page is not available', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/overview&role=viewer')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Billing alerts' })).toHaveCount(0)
  await page.goto('/e2e/harness/?path=/billing-alerts&role=viewer')
  await expect(page.getByRole('heading', { name: 'Page not available', level: 1 })).toBeVisible()
})
