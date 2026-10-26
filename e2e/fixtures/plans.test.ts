import { confirmInSecondTab } from '../helpers/step-up'
import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * The Plans page in a real browser, through the harness: a viewer reads it
 * with no edit controls, an admin lowers Free's members limit through the
 * affected-tenants confirm and a step-up confirmed by emailed link, and adds
 * a price above the warning threshold, with nothing scrolling sideways at
 * 390px.
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

test('an admin lowers Free’s members from 3 to 2 through the affected-tenants confirm and a step-up, at 390px', async ({
  page,
}) => {
  const saves: number[] = []
  page.on('response', (response) => {
    if (
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.includes('/platform/plans/')
    ) {
      saves.push(response.status())
    }
  })
  await page.setViewportSize({ width: 390, height: 844 })
  // `stepup=once` refuses the save until this session confirms it's the user.
  await page.goto('/e2e/harness/?path=/plans&stepup=once')
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

  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await stepUp.getByRole('button', { name: 'Email me a link' }).click()
  await expect(
    stepUp.getByText('We sent the link to a.b@example.com.', { exact: false })
  ).toBeVisible()
  await confirmInSecondTab(page)
  await expect(stepUp).toBeHidden()

  await expect(page.getByText('Free saved.')).toBeVisible()
  expect(saves).toEqual([401, 200])
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
    'Current subscribers keep the price they signed up at. New subscribers pay ₹18,000.'
  )
  await dialog.getByLabel('Reason').fill('Yearly repricing')
  await dialog.getByRole('button', { name: 'Add price' }).click()

  await expect(page.getByText('New yearly price: ₹18,000.')).toBeVisible()
  const table = page.getByRole('table', { name: 'Prices' })
  await expect(table.getByRole('row', { name: /Yearly ₹18,000 Active/ })).toBeVisible()
  await expect(table.getByRole('row', { name: /Yearly ₹9,990 Retired/ })).toBeVisible()
})

test('a viewer reads the trial and grace rules, with who changed them last', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/plans&role=viewer')
  const settings = page.getByRole('region', { name: 'Trials and grace' })
  await expect(settings).toContainText('Trial length14 days')
  await expect(settings).toContainText('Last changed by Sam Staff')
  await expect(settings.getByRole('switch')).toHaveCount(0)
})

test('an admin saves a longer trial with a reason, and it stays saved', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/plans')
  const settings = page.getByRole('region', { name: 'Trials and grace' })
  await settings.getByRole('textbox', { name: 'Trial length (days)' }).fill('21')
  await settings.getByRole('button', { name: 'Save billing settings' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Save billing settings?' })
  await dialog.getByLabel('Reason').fill('Longer trials for the launch')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Billing settings saved.')).toBeVisible()
  await expect(settings.getByRole('textbox', { name: 'Trial length (days)' })).toHaveValue('21')
})
