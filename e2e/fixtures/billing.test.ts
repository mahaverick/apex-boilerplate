import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * A tenant's Billing tab in a real browser, through the harness: every
 * section renders from the fixtures without scrolling the page sideways at
 * 390px, its lists keep their state in the URL, the invoices page forward
 * past an empty page, and the platform tenant has no Billing tab.
 */

const ACME = '/tenants/10000000-0000-4000-8000-000000000001'
const PLATFORM = '/tenants/10000000-0000-4000-8000-000000000100'

test('every section renders and nothing scrolls sideways at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/e2e/harness/?path=${ACME}/billing`)
  for (const name of [
    'Billing',
    'Usage and access',
    'Grants',
    'State history',
    'Provider events',
    'Subscriptions',
    'Invoices',
  ]) {
    await expect(page.getByRole('heading', { name, level: 2, exact: true })).toBeVisible()
  }
  await expect(page.getByText('Trial → Paid').first()).toBeVisible()
  await expect(page.getByText('Provider timed out on every retry').first()).toBeVisible()
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
})

test('the history search and source filter live in the URL', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME}/billing?historySource=staff`)
  const table = page.getByRole('table', { name: 'State history' })
  await expect(table.getByText('Created → Trial')).toBeVisible()
  await expect(table.getByText('Trial → Paid')).toHaveCount(0)
  await page.getByRole('searchbox', { name: 'Search state history' }).fill('no_such_cause')
  await expect(page.getByText('Nothing matches these filters.')).toBeVisible()
  await expect
    .poll(() => new URL(page.url()).searchParams.get('historySearch'))
    .toBe('no_such_cause')
  expect(new URL(page.url()).searchParams.get('historySource')).toBe('staff')
})

test('the invoices page past an empty first page', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME}/billing`)
  await expect(page.getByText(/^This page had no invoices\./)).toBeVisible()
  await expect(page.getByText('No invoices for this tenant.')).toHaveCount(0)
  await page.getByRole('button', { name: 'Load more invoices' }).click()
  await expect(
    page.getByRole('table', { name: 'Invoices' }).getByText('inv_TestPaid0001')
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load more invoices' })).toHaveCount(0)
})

test('the platform tenant has no Billing tab, and its typed URL says it has no billing', async ({
  page,
}) => {
  await page.goto(`/e2e/harness/?path=${PLATFORM}/members`)
  const nav = page.getByRole('navigation', { name: 'Tenant sections' })
  await expect(nav.getByRole('link', { name: 'Onboarding' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Billing' })).toHaveCount(0)

  await page.goto(`/e2e/harness/?path=${PLATFORM}/billing`)
  await expect(page.getByRole('heading', { name: 'This tenant has no billing.' })).toBeVisible()
  await expect(page.getByText('Your role can’t see this any more.')).toHaveCount(0)
})
