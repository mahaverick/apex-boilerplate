/**
 * @file The list checks jsdom cannot make, because it has no layout or real
 * history: a sort then a page keeps the sort and moves the cursor, a facet
 * writes a comma list its chip takes one value out of, a search writes
 * `?search=`, and a list stacks as cards on a phone without scrolling the
 * page sideways. They run against the MSW harness in `e2e/harness/`.
 */
import { expect, test } from '../hermetic'

/** A cold Vite transform of a route chunk; the contrast suite allows the same. */
const COLD_TRANSFORM_BUDGET_MS = 20_000

test('sorting the tenants then paging keeps the sort and moves the cursor', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/tenants')
  const table = page.getByRole('table', { name: 'Tenants' })
  await expect(table).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await table.getByRole('button', { name: 'Created' }).click()
  await expect(table.getByRole('columnheader', { name: 'Created' })).toHaveAttribute(
    'aria-sort',
    'ascending'
  )
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page).toHaveURL(/sort=created/)
  await expect(page).toHaveURL(/cursor=/)
  await expect(page.getByRole('button', { name: 'Previous page' })).toBeEnabled()
})

test('a facet on Emails writes a comma list and its chip removes one value', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/emails')
  await expect(page.getByRole('table', { name: 'Emails' })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  await page.getByRole('button', { name: 'Filter by status, Emails' }).click()
  const popup = page.getByRole('dialog', { name: 'Filter by status, Emails' })
  await popup.getByRole('checkbox').nth(0).click()
  await popup.getByRole('checkbox').nth(1).click()
  await expect(page).toHaveURL(/status=[a-z_]+(%2C|,)[a-z_]+/)
  await page.keyboard.press('Escape')
  await page
    .getByRole('button', { name: /^Remove filter: Status: / })
    .first()
    .click()
  await expect(page).toHaveURL(/status=[a-z_]+(&|$)/)
  await expect(page).not.toHaveURL(/%2C|,/)
})

test('a search on Users writes ?search= and leaves the matching rows', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/users')
  const table = page.getByRole('table', { name: 'Users' })
  await expect(table).toBeVisible({ timeout: COLD_TRANSFORM_BUDGET_MS })
  await page.getByRole('searchbox', { name: 'Search users' }).fill('cleo')
  await expect(page).toHaveURL(/search=cleo/)
  await expect(table.getByRole('row')).toHaveCount(2)
  await expect(table.getByText('cleo.d@example.com')).toBeVisible()
})

test.describe('at 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Users stacks as cards with no sideways scroll', async ({ page }) => {
    await page.goto('/e2e/harness/?path=/users')
    await expect(page.getByRole('list', { name: 'Users' })).toBeVisible({
      timeout: COLD_TRANSFORM_BUDGET_MS,
    })
    await expect(page.getByRole('table')).toHaveCount(0)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
    expect(overflow).toBe(0)
  })
})
