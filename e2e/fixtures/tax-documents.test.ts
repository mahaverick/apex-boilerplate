import type { Page } from '@playwright/test'
import { confirmInSecondTab } from '../helpers/step-up'
import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * GST tax documents on a tenant's Billing tab and the Plans page, in a real
 * browser through the harness's `?tax=` states: a manager corrects the PIN
 * code after a step-up, a viewer saves a PDF, an admin issues a credit note,
 * resolves a held SEZ charge from its alert and saves a GSTR-1 export. With
 * tax off nothing about tax shows, with registration off the documents still
 * download and nothing edits, and the SEZ tab fits a phone.
 */

const ACME = '/tenants/10000000-0000-4000-8000-000000000001'

/**
 * Waits until the Billing tab has painted its data: the summary and every
 * list loaded, with no skeleton left.
 * @param page - The page on the Billing tab.
 */
async function billingLoaded(page: Page) {
  await expect(page.getByRole('heading', { name: 'Usage and access', level: 2 })).toBeVisible()
  // The harness's first invoices page is empty with more to come, as the provider can answer.
  await expect(page.getByRole('button', { name: 'Load more invoices' })).toBeVisible()
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
}

test('a manager corrects the PIN code with a reason and a step-up, and the card shows it', async ({
  page,
}) => {
  const bodies: { status: number; body: unknown }[] = []
  page.on('response', (response) => {
    const request = response.request()
    if (request.method() === 'PATCH' && response.url().endsWith('/billing/tax-details')) {
      bodies.push({ status: response.status(), body: request.postDataJSON() as unknown })
    }
  })
  await page.goto(`/e2e/harness/?path=${ACME}/billing&tax=on&role=manager&stepup=once`)
  const card = page.locator('[data-slot="card"]', {
    has: page.getByRole('heading', { name: 'Tax details', level: 2 }),
  })
  await expect(card).toContainText('12 MG Road, Bengaluru, 560001')
  await card.getByRole('button', { name: 'Correct tax details' }).click()

  const dialog = page.getByRole('dialog', { name: 'Correct tax details for Acme Corp' })
  await dialog.getByLabel('PIN code').fill('560002')
  await dialog.getByLabel('Reason').fill('Customer sent their updated GST certificate')
  await dialog.getByRole('button', { name: 'Save tax details' }).click()

  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await stepUp.getByRole('button', { name: 'Email me a link' }).click()
  await expect(
    stepUp.getByText('We sent the link to a.b@example.com.', { exact: false })
  ).toBeVisible()
  await confirmInSecondTab(page)
  await expect(stepUp).toBeHidden()

  await expect(
    page.getByText('Tax details for Acme Corp saved. They apply to invoices issued from now on.')
  ).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(card).toContainText('12 MG Road, Bengaluru, 560002')
  expect(bodies.map(({ status }) => status)).toEqual([401, 200])
  expect(bodies[1]?.body).toEqual({
    version: 3,
    pincode: '560002',
    reason: 'Customer sent their updated GST certificate',
  })
})

test('a viewer downloads INV/26-27/00001 as a PDF named after its number', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME}/billing&tax=on&role=viewer`)
  const documents = page.locator('#tax-documents')
  await expect(documents.getByRole('table', { name: 'Tax documents' })).toBeVisible()
  await expect(documents.getByRole('button', { name: /^Actions for / })).toHaveCount(0)
  const download = page.waitForEvent('download')
  await documents.getByRole('button', { name: 'Download INV/26-27/00001 as a PDF' }).click()
  expect((await download).suggestedFilename()).toBe('INV-26-27-00001.pdf')

  // The invoice rows link the same documents, and a later charge waits for its tax invoice.
  await page.getByRole('button', { name: 'Load more invoices' }).click()
  const invoices = page.getByRole('table', { name: 'Invoices' })
  await expect(invoices.getByRole('row', { name: /^inv_TestPaid0002/ })).toContainText(
    'Tax invoice on its way'
  )
  await expect(
    invoices.getByRole('button', { name: 'Download CN/26-27/00002 as a PDF' })
  ).toBeVisible()
})

test('an admin issues a ₹100 credit note on INV/26-27/00001, and the list shows CN/26-27/00003', async ({
  page,
}) => {
  await page.goto(`/e2e/harness/?path=${ACME}/billing&tax=on`)
  const documents = page.locator('#tax-documents')
  await documents.getByRole('button', { name: 'Actions for INV/26-27/00001' }).click()
  await page.getByRole('menuitem', { name: 'Issue credit note' }).click()

  const dialog = page.getByRole('dialog', { name: 'Issue a credit note against INV/26-27/00001' })
  await expect(dialog).toContainText('₹399 of ₹999 is left to credit.')
  await dialog.getByLabel('Amount (₹)').fill('100')
  await dialog.getByLabel('Reason').fill('Chargeback lost on 27 Oct 2026')
  await dialog.getByRole('button', { name: 'Issue credit note' }).click()

  await expect(page.getByText('Credit note CN/26-27/00003 issued for ₹100.')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  const row = documents.getByRole('row', { name: /^CN\/26-27\/00003/ })
  await expect(row).toContainText('Reduces INV/26-27/00001')
  await expect(row).toContainText('₹100')
  await expect(documents.getByRole('row', { name: /^INV\/26-27\/00001/ })).toContainText(
    '₹700 of ₹999 credited'
  )
})

test('an admin opens a held SEZ charge’s alert, lands on Held SEZ charges and marks it resolved', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/billing-alerts&tax=sez')
  const table = page.getByRole('table', { name: 'Billing alerts' })
  const first = table.getByRole('row').nth(1)
  await expect(first).toContainText('SEZ charge held')
  await expect(first).toContainText('pay_TestHeld0002')
  await first.getByRole('link', { name: 'Acme Corp' }).click()

  const heading = page.getByRole('heading', { name: 'Held SEZ charges', level: 2 })
  await expect(heading).toBeFocused()
  expect(new URL(page.url()).hash).toBe('#held-charges')
  const held = page.locator('#held-charges')
  await held.getByRole('button', { name: 'Mark resolved: payment pay_TestHeld0002' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'Mark payment pay_TestHeld0002 resolved?' })
  await dialog.getByLabel('Reason').fill('Issued SEZ invoice by hand')
  await dialog.getByRole('button', { name: 'Mark resolved' }).click()

  await expect(page.getByText('Held charge marked resolved.')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(held.getByRole('button', { name: /^Mark resolved/ })).toHaveCount(0)
  await expect(held.getByRole('row', { name: /pay_TestHeld0002/ })).toContainText(
    'Issued SEZ invoice by hand'
  )
})

test('an admin downloads the 2026-Q2 export as gstr1-2026-Q2.zip', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/plans&tax=on')
  const card = page.getByRole('region', { name: 'GST return export' })
  await card.getByRole('radio', { name: 'Quarter (for quarterly filers)' }).click()
  await card.getByRole('combobox', { name: 'Period' }).click()
  await page.getByRole('option', { name: 'Q2 2026-27 (Jul–Sep 2026)' }).click()
  const download = page.waitForEvent('download')
  await card.getByRole('button', { name: 'Download export' }).click()
  expect((await download).suggestedFilename()).toBe('gstr1-2026-Q2.zip')
  await expect(page.getByText('gstr1-2026-Q2.zip downloaded.')).toBeVisible()
})

test('with tax off, the Billing tab says nothing about tax and Plans has no export card', async ({
  page,
}) => {
  const taxRequests: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/') && pathname.includes('/tax')) taxRequests.push(pathname)
  })
  await page.goto(`/e2e/harness/?path=${ACME}/billing&tax=off`)
  await billingLoaded(page)
  await expect(page.getByRole('main').getByText(/\btax\b/i)).toHaveCount(0)

  await page.goto('/e2e/harness/?path=/plans&tax=off')
  await expect(page.getByRole('heading', { name: 'Trials and grace', level: 2 })).toBeVisible()
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'GST return export' })).toHaveCount(0)
  expect(taxRequests).toEqual([])
})

test('with registration off and documents issued, the PDF still downloads and nothing edits', async ({
  page,
}) => {
  await page.goto(`/e2e/harness/?path=${ACME}/billing&tax=docs-off`)
  await billingLoaded(page)
  const documents = page.locator('#tax-documents')
  await expect(documents.getByRole('table', { name: 'Tax documents' })).toBeVisible()
  await expect(
    documents.getByRole('button', { name: 'Download INV/26-27/00001 as a PDF' })
  ).toBeVisible()
  await expect(page.getByText('Acme Corp Private Limited')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Correct tax details' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0)

  await page.goto('/e2e/harness/?path=/plans&tax=docs-off')
  await expect(page.getByRole('region', { name: 'GST return export' })).toBeVisible()
})

test('the Billing tab of an SEZ tenant fits a 390px screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/e2e/harness/?path=${ACME}/billing&tax=sez`)
  await billingLoaded(page)
  await expect(page.getByRole('heading', { name: 'Tax details', level: 2 })).toBeVisible()
  // A phone stacks each list as cards, named as its table is.
  await expect(page.getByRole('list', { name: 'Tax documents' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Held SEZ charges' })).toBeVisible()
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
})
