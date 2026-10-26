import { createRequire } from 'node:module'
import type { Page } from '@playwright/test'
import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * Staff billing writes on a tenant's Billing tab, in a real browser through
 * the harness: a manager extends a trial and adds a No limit grant, an admin
 * cancels at the end of the paid period, and each change shows on the tab.
 * Axe grades the Plans page and the Billing tab over the whole document. The
 * decrease through the affected-tenants confirm and a step-up is in
 * `plans.test.ts`, and the alerts card for admin and viewer in
 * `billing-alerts.test.ts`. Every `?billing=` state dates itself from the page
 * load, so the dates below are read off the page, never computed here.
 */

const AXE_PATH = createRequire(import.meta.url).resolve('axe-core/axe.min.js')

const ACME = '/tenants/10000000-0000-4000-8000-000000000001'

/** The slice of axe's run result this test reads. */
type AxeRun = {
  violations: { id: string; nodes: { target: string[] }[] }[]
  passes: { id: string }[]
}

/**
 * The value cell of one row in a definition list: the `dd` after the `dt`
 * with that exact text.
 * @param page - The page.
 * @param term - The row's name, such as "Trial ends".
 */
function valueOf(page: Page, term: string) {
  return page.locator(`dt:text-is("${term}") + dd`)
}

/**
 * The local date `days` from today as a date input takes it, `YYYY-MM-DD`.
 * The browser and this process share the machine's time zone.
 * @param days - Days ahead.
 */
function inputDate(days: number): string {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  const parts = [date.getMonth() + 1, date.getDate()].map((part) => String(part).padStart(2, '0'))
  return [date.getFullYear(), ...parts].join('-')
}

/**
 * Runs axe over the whole document and returns its violations, one line
 * each, and the ids of the rules that passed.
 * @param page - The loaded page.
 */
async function axeDocument(page: Page) {
  await page.addScriptTag({ path: AXE_PATH })
  return page.evaluate(async () => {
    const axe = (
      window as unknown as { axe: { run: (ctx: Document, opts: unknown) => Promise<AxeRun> } }
    ).axe
    const run = await axe.run(document, { resultTypes: ['violations'] })
    return {
      violations: run.violations.map(
        (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
      ),
      passes: run.passes.map((p) => p.id),
    }
  })
}

test('a manager extends a trial by 7 days, and the summary shows the new end', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME}/billing&billing=trialing&role=manager`)
  const before = await valueOf(page, 'Trial ends').textContent()
  await page.getByRole('button', { name: 'Billing actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Cancel subscription' })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Extend trial' }).click()

  const dialog = page.getByRole('dialog', { name: 'Extend the trial for Acme Corp' })
  await expect(dialog.getByLabel('Days to add')).toHaveValue('7')
  await expect(dialog).toContainText(`Trial now ends on ${before}.`)
  const preview = await dialog.getByText(/After this it ends on /).textContent()
  const newEnd = /After this it ends on (.+)\.$/.exec(preview ?? '')?.[1]
  expect(newEnd).toBeTruthy()
  expect(newEnd).not.toBe(before)
  await dialog.getByLabel('Reason').fill('Waiting on their procurement team')
  await dialog.getByRole('button', { name: 'Extend trial' }).click()

  await expect(page.getByText(`Trial for Acme Corp ends on ${newEnd}.`)).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(valueOf(page, 'Trial ends')).toHaveText(newEnd!)
})

test('a manager grants Members No limit for 30 days, and the usage card shows Grant', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/e2e/harness/?path=${ACME}/billing&billing=free&role=manager`)
  const members = valueOf(page, 'Members')
  await expect(members).toContainText('2 of 3 members')
  await expect(members).toContainText('Plan')

  await page.getByRole('button', { name: 'Billing actions' }).click()
  await page.getByRole('menuitem', { name: 'Add grant' }).click()
  const dialog = page.getByRole('dialog', { name: 'Add a grant for Acme Corp' })
  await dialog.getByRole('combobox', { name: 'Limit or feature' }).click()
  await page.getByRole('option', { name: 'Members' }).click()
  await dialog.getByRole('checkbox', { name: 'No limit' }).click()
  await expect(dialog.getByLabel('New limit')).toBeDisabled()
  const ends = inputDate(30)
  await dialog.getByLabel('Ends on (optional)').fill(ends)
  await dialog.getByLabel('Reason').fill('Onboarding a large team this month')
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
  await dialog.getByRole('button', { name: 'Add grant' }).click()

  await expect(page.getByText('Members grant added for Acme Corp.')).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(members).toContainText('2 members · No limit')
  await expect(members).toContainText('Grant')
  const row = page.getByRole('table', { name: 'Grants' }).getByRole('row').nth(1)
  await expect(row).toContainText('No limit')
  // The grant ends at the end of that day in the tenant's zone, and the table dates in that zone too.
  const endsText = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${ends}T12:00:00Z`))
  await expect(row).toContainText(endsText)
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
})

test('an admin cancels at the end of the paid period, and the summary says when it cancels', async ({
  page,
}) => {
  await page.goto(`/e2e/harness/?path=${ACME}/billing&billing=active`)
  const periodEnd = await valueOf(page, 'Paid until').textContent()
  await page.getByRole('button', { name: 'Billing actions' }).click()
  await page.getByRole('menuitem', { name: 'Cancel subscription' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'Cancel the subscription for Acme Corp?' })
  const atEnd = dialog.getByRole('radio', { name: `At the end of the paid period (${periodEnd})` })
  await expect(atEnd).toBeChecked()
  await expect(dialog).toContainText(`Acme Corp keeps Paid until ${periodEnd}, then moves to Free.`)
  await expect(dialog.getByText('to confirm')).toHaveCount(0)
  await dialog.getByLabel('Reason').fill('The customer asked to stop at renewal')
  await dialog.getByRole('button', { name: 'Cancel subscription' }).click()

  await expect(page.getByText(`Paid for Acme Corp ends on ${periodEnd}.`)).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await expect(valueOf(page, 'Cancels on')).toHaveText(periodEnd!)
  await expect(valueOf(page, 'Paid until')).toHaveCount(0)
})

for (const [name, path, ready] of [
  ['the Plans page, with every edit control', '/plans', 'Trials and grace'],
  ['the Billing tab, with every section', `${ACME}/billing`, 'Invoices'],
  ['the Billing tab of a past-due tenant', `${ACME}/billing&billing=past_due`, 'Invoices'],
] as const) {
  test(`axe finds nothing on ${name}`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 2, exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    const results = await axeDocument(page)
    expect(results.violations).toEqual([])
    // Not vacuous: axe graded the whole document, its page-level rules included.
    expect(results.passes).toEqual(expect.arrayContaining(['document-title', 'landmark-one-main']))
  })
}
