/**
 * @file "Confirm it's you" in a real browser, through the harness: the dialog
 * that a refused suspend opens, its emailed link confirmed from a second tab
 * over the real BroadcastChannel and Web Lock, and the confirm page's answers
 * when no tab waits, when the link is dead and when the browser is signed
 * out. The dialog's countdowns are run out on Playwright's clock, which only
 * the compiled build can fail. Each state passes the 390 px overflow check.
 */
import type { Page } from '@playwright/test'
import { confirmInSecondTab, confirmLinkUrl } from '../helpers/step-up'
import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

const MOBILE = { width: 390, height: 844 }

/** Acme's tenant page; `?stepup=once` refuses its first suspend and lets the retry through. */
const ACME_PAGE = '/tenants/10000000-0000-4000-8000-000000000001'

/** A public page's root element is no wider than the viewport. */
async function expectNoOverflow(page: Page): Promise<void> {
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  )
  expect(overflows, 'the page scrolls sideways at 390 px').toBe(false)
}

/** Suspends Acme from its Actions menu, as far as the step-up dialog the refusal opens. */
async function openStepUpOverSuspend(page: Page, query = '') {
  await page.goto(`/e2e/harness/?path=${ACME_PAGE}${query}`)
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Suspend' }).click()
  const reason = page.getByRole('alertdialog', { name: 'Suspend Acme Corp?' })
  await reason.getByLabel('Reason').fill('step-up check')
  await reason.getByRole('button', { name: 'Suspend', exact: true }).click()
  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await expect(stepUp.getByRole('button', { name: 'Email me a link' })).toBeVisible()
  return { reason, stepUp }
}

test.use({ viewport: MOBILE })

test('a link confirmed in a second tab closes the dialog, and the suspend goes through', async ({
  page,
}) => {
  const suspends: number[] = []
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('/suspend')) suspends.push(response.status())
  })
  const { reason, stepUp } = await openStepUpOverSuspend(page, '&stepup=once')

  await stepUp.getByRole('button', { name: 'Email me a link' }).click()
  await expect(
    stepUp.getByText('We sent the link to a.b@example.com.', { exact: false })
  ).toBeVisible()
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
  const box = await stepUp.boundingBox()
  expect(box!.x + box!.width, 'the step-up dialog’s right edge').toBeLessThanOrEqual(390)

  await confirmInSecondTab(page)

  await expect(stepUp).toBeHidden()
  await expect(reason).toBeHidden()
  await expect(page.getByText('Suspended', { exact: true }).first()).toBeVisible()
  expect(suspends).toEqual([401, 200])
})

test('with no tab waiting, the confirm page says to try the action again', async ({ page }) => {
  const verifies: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/auth/step-up/link/verify') {
      verifies.push(request.method())
    }
  })
  await page.goto(confirmLinkUrl('confirm=gone'))

  await expect(page.getByRole('heading', { level: 1, name: 'Confirmed' })).toBeVisible()
  await expect(page.getByText('Go back to Apex and try the action again.')).toBeVisible()
  expect(verifies).toEqual(['POST'])
  // The spent token leaves the address bar.
  await expect(page).not.toHaveURL(/token=/)
  await expectNoOverflow(page)
})

test('a dead link says it did not confirm and how to get a new one', async ({ page }) => {
  await page.goto(confirmLinkUrl('confirm=dead'))

  await expect(
    page.getByRole('heading', { level: 1, name: 'This link didn’t confirm it’s you' })
  ).toBeVisible()
  await expect(page.getByText(/For a new link, try the action again\./)).toBeVisible()
  await expectNoOverflow(page)
})

test('signed out, the confirm page posts nothing and says where the link works', async ({
  page,
}) => {
  const verifies: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/auth/step-up/link/verify') {
      verifies.push(request.method())
    }
  })
  await page.goto(confirmLinkUrl('session=none'))

  await expect(page.getByRole('heading', { level: 1, name: 'Sign in to confirm' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible()
  expect(verifies).toEqual([])
  await expectNoOverflow(page)
})

test('the email wait counts its Resend down and opens it, then says the link expired after 15 minutes', async ({
  page,
}) => {
  // The fake clock runs out the 60-second resend and the 15-minute link without waiting for them.
  await page.clock.install()
  const { stepUp } = await openStepUpOverSuspend(page)

  await stepUp.getByRole('button', { name: 'Email me a link' }).click()
  await expect(stepUp.getByRole('button', { name: /^Resend in \d:\d\d/ })).toBeDisabled()

  await page.clock.fastForward('00:02')
  await expect(stepUp.getByRole('button', { name: /^Resend in 0:5\d/ })).toBeVisible()
  await page.clock.fastForward('01:00')
  await expect(stepUp.getByRole('button', { name: /^Resend link/ })).toBeEnabled()

  await page.clock.fastForward('14:00')
  await expect(stepUp.getByText('That link expired. Send a new link to continue.')).toBeVisible()
  // The action still waits: only Cancel ends it.
  await expect(stepUp).toBeVisible()
})
