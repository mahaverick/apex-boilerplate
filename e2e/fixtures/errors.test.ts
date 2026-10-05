import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * The user and tenant Errors tabs and the Overview's system status card in a
 * real browser, through the harness: the issues render with their badges
 * and PostHog links, an unconfigured environment says so with no table, a
 * viewer is refused with no request and no PostHog link, and nothing
 * scrolls sideways at 390px.
 */

const CLEO_ERRORS = '/users/20000000-0000-4000-8000-000000000002/errors'
const ACME_ERRORS = '/tenants/10000000-0000-4000-8000-000000000001/errors'
const ISSUE = 'https://us.posthog.com/project/1/error_tracking/'

for (const [name, path, level] of [
  ['a user’s errors', CLEO_ERRORS, 1],
  ['a tenant’s errors', ACME_ERRORS, 2],
] as const) {
  test(`${name} lists each issue with its badges and PostHog link`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: 'Errors', level })).toBeVisible()
    const table = page.getByRole('table', { name: 'Errors' })
    await expect(table.getByRole('row')).toHaveCount(4)
    await expect(table.getByText('Member Evangeline Featherstonehaugh has no role')).toBeVisible()
    await expect(table.getByText('Unverified')).toHaveCount(1)
    await expect(table.getByText('1,284')).toBeVisible()
    const links = table.getByRole('link', { name: /Open in PostHog/ })
    await expect(links).toHaveCount(3)
    await expect(links.first()).toHaveAttribute(
      'href',
      `${ISSUE}01a107cd-0000-7000-8000-000000000001`
    )
    await expect(links.first()).toHaveAttribute('target', '_blank')
  })

  test(`${name} says when error tracking is not set up`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}&errors=unconfigured`)
    await expect(
      page.getByText('PostHog error tracking is not set up for this environment.')
    ).toBeVisible()
    await expect(page.getByRole('table')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Open in PostHog/ })).toHaveCount(0)
  })

  test(`${name} does not scroll sideways at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('table', { name: 'Errors' })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
  })

  test(`a viewer is refused ${name}, with no PostHog link`, async ({ page }) => {
    let asked = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/errors')) asked += 1
    })
    await page.goto(`/e2e/harness/?path=${path}&role=viewer`)
    await expect(page.getByText(/Your role can’t see this any more/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Open in PostHog/ })).toHaveCount(0)
    if (path === ACME_ERRORS) {
      await expect(
        page
          .getByRole('navigation', { name: 'Tenant sections' })
          .getByRole('link', { name: 'Errors' })
      ).toHaveCount(0)
    }
    // The role gate renders before any query mounts, so the refusal on screen is the barrier.
    expect(asked).toBe(0)
  })
}

test('the tenant’s Errors tab follows Timeline in its nav', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME_ERRORS}`)
  const nav = page.getByRole('navigation', { name: 'Tenant sections' })
  await expect(nav.getByRole('link', { name: 'Errors' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link')).toHaveText([
    'Overview',
    'Members',
    'Invitations',
    'Activity',
    'Timeline',
    'Errors',
    'Emails',
    'Onboarding',
  ])
})

test('the Overview shows an admin the system status, warning on dropped events', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/overview')
  const card = page.getByRole('region', { name: 'System status' })
  await expect(card.getByText('0a1b2c3d4e5f60718293a4b5c6d7e8f901234567')).toBeVisible()
  await expect(card.getByText('Needs attention')).toBeVisible()
  await expect(card.getByText('(Throttled 2)')).toBeVisible()
})

test('the Overview shows a viewer no system status, and never asks for it', async ({ page }) => {
  let asked = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/system/status')) asked += 1
  })
  await page.goto('/e2e/harness/?path=/overview&role=viewer')
  await expect(page.getByRole('region', { name: 'Key figures' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'System status' })).toHaveCount(0)
  // The card is gated on the role before its query mounts; the loaded figures are the barrier.
  expect(asked).toBe(0)
})
