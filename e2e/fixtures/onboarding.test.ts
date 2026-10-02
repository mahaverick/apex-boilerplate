import { expect, test } from '../hermetic'

/**
 * Onboarding in a real browser, through the harness. jsdom has no layout, so
 * what these check is what it cannot: the funnel's bars really have width,
 * nothing scrolls sideways at 390px (the harness's long names and reasons are
 * on purpose), and the state tabs and the member disclosure work by pointer.
 */

const ACME = '/tenants/10000000-0000-4000-8000-000000000001/onboarding'
const BETA = '/tenants/10000000-0000-4000-8000-000000000002/onboarding'
const DELTA = '/tenants/10000000-0000-4000-8000-000000000004/onboarding'

for (const [name, path, ready] of [
  ['onboarding, stuck tab', '/onboarding', 'Tenants'],
  ['onboarding, in progress tab', '/onboarding?state=in_progress', 'Tenants'],
  ['onboarding, awaiting owner tab', '/onboarding?state=awaiting_owner', 'Tenants'],
  ['onboarding, complete tab', '/onboarding?state=complete', 'Tenants'],
  ['a stuck tenant’s onboarding', ACME, 'Reminders'],
  ['a suspended tenant’s onboarding', BETA, 'Reminders'],
  ['an onboarding awaiting its owner', DELTA, 'Reminders'],
] as const) {
  test(`${name} does not scroll sideways at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 2 })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)

    // The layout's content area is its own scroll container, so a page too wide for it scrolls there and leaves the document's width alone.
    const overflow = await page.evaluate(() => {
      const content = document.querySelector('main > .overflow-auto')!
      return Math.max(
        document.documentElement.scrollWidth - window.innerWidth,
        content.scrollWidth - content.clientWidth
      )
    })
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('every state tab can be reached at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/harness/?path=/onboarding')
  const tabs = page.getByRole('tablist', { name: 'Onboarding states' }).getByRole('tab')
  await expect(tabs).toHaveCount(5)
  for (const tab of await tabs.all()) {
    await tab.scrollIntoViewIfNeeded()
    // Inside the viewport after scrolling: a centred row that overflows clips its first tab where no scroll reaches.
    const box = (await tab.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
})

test('the funnel draws a bar per step, with the staff share beside it', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/onboarding')
  const funnel = page.getByRole('figure', { name: 'Onboarding funnel' })
  await expect(funnel.getByText('30 of 40 tenants (75.00%) · 4 by staff')).toBeVisible()
  const bars = funnel.locator('li .rounded-full')
  await expect(bars).toHaveCount(4)
  // The first step: 26 of 40 completed without staff and 4 with, on a track the full row wide.
  const [track, completed, staff] = await Promise.all([
    bars.first().boundingBox(),
    bars.first().locator('div').nth(0).boundingBox(),
    bars.first().locator('div').nth(1).boundingBox(),
  ])
  expect(completed!.width / track!.width).toBeCloseTo(0.65, 2)
  expect(staff!.width / track!.width).toBeCloseTo(0.1, 2)
  expect(staff!.x).toBeCloseTo(completed!.x + completed!.width, 0)
})

test('the state tabs live in the URL', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/onboarding')
  const table = page.getByRole('table', { name: 'Onboarding tenants' })
  await expect(table.getByRole('link', { name: 'Acme Corp' })).toBeVisible()

  await page.getByRole('tab', { name: 'Awaiting owner' }).click()

  await expect(page).toHaveURL(/[?&]state=awaiting_owner/)
  await expect(table.getByRole('link', { name: 'Delta LLC' })).toBeVisible()
  await expect(table.getByRole('columnheader', { name: 'Days stuck' })).toHaveCount(0)
})

test('a member step’s disclosure opens onto each member’s status', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME}`)
  const steps = page.getByRole('list', { name: 'Onboarding steps' })
  await expect(steps.getByText('Evangeline Featherstonehaugh')).toBeHidden()
  await steps.getByText('1 of 2 members').click()
  await expect(steps.getByText('Evangeline Featherstonehaugh')).toBeVisible()
})

test('the Overview’s stuck tile opens the stuck tab', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview')
  await page.getByRole('link', { name: 'View stuck tenants' }).click()
  await expect(page.getByRole('heading', { name: 'Onboarding', level: 1 })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Stuck' })).toHaveAttribute('aria-selected', 'true')
})
