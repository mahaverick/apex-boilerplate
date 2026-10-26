import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * The Plans page in a real browser, through the harness: a viewer reads it
 * with no edit controls, an admin lowers Free's members limit through the
 * affected-tenants confirm, and adds a price above the warning threshold,
 * with nothing scrolling sideways at 390px.
 */

test('a viewer reads both plans and the prices, with no edit controls', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/plans&role=viewer')
  await expect(page.getByRole('heading', { name: 'Plans', level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Free' })).toContainText('4 on Free')
  await expect(page.getByRole('table', { name: 'Prices' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Save/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'New price' })).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
})

test('an admin lowers Free’s members from 3 to 2 through the affected-tenants confirm, at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/harness/?path=/plans')
  const free = page.getByRole('region', { name: 'Free' })
  await free.getByRole('textbox', { name: 'Members' }).fill('2')
  await free.getByRole('button', { name: 'Save Free' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'Lower limits on Free?' })
  await expect(dialog).toContainText('Members: 3 → 2')
  await expect(dialog).toContainText('4 tenants are on Free.')
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
  await dialog.getByLabel('Reason').fill('Tighter Free plan')
  await dialog.getByRole('button', { name: 'Lower limits' }).click()
  await expect(dialog.getByText('Confirm you checked the tenants this affects.')).toBeVisible()
  await dialog.getByRole('checkbox', { name: 'I checked the tenants this affects' }).click()
  await dialog.getByRole('button', { name: 'Lower limits' }).click()

  await expect(page.getByText('Free saved.')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(free.getByRole('textbox', { name: 'Members' })).toHaveValue('2')
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
})

test('an admin adds a yearly price above the warning threshold, and it replaces the active one', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/plans')
  await page.getByRole('button', { name: 'New price' }).click()
  const dialog = page.getByRole('dialog', { name: 'New price for Paid' })
  await dialog.getByRole('combobox', { name: 'Interval' }).click()
  await page.getByRole('option', { name: 'Yearly' }).click()
  await dialog.getByRole('textbox', { name: 'Amount in rupees' }).fill('18000')
  await expect(dialog.getByText(/need the customer to approve each payment/)).toBeVisible()
  await expect(dialog).toContainText(
    'Existing subscribers keep ₹9,990. New subscribers pay ₹18,000.'
  )
  await dialog.getByLabel('Reason').fill('Yearly repricing')
  await dialog.getByRole('button', { name: 'Add price' }).click()

  await expect(page.getByText('New yearly price: ₹18,000.')).toBeVisible()
  const table = page.getByRole('table', { name: 'Prices' })
  await expect(table.getByRole('row', { name: /Yearly ₹18,000 Active/ })).toBeVisible()
  await expect(table.getByRole('row', { name: /Yearly ₹9,990 Retired/ })).toBeVisible()
})
