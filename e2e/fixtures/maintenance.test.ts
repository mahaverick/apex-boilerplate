import type { Page, Route } from '@playwright/test'
import { expect, FALLBACK_HEADER, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * Maintenance mode in a real browser, through the harness: the red banner on
 * every staff page and the page's facts in full maintenance, nothing sideways
 * at 390px, and an owner switching customers to full through the typed
 * confirmation and the step-up, with the platform state, the change and the
 * password check answered by the test's own context routes (`?maintenance=route`
 * lets the harness's GET through to them; a request the service worker passes
 * through is seen by `context.route`, never `page.route`).
 */

const MAINTENANCE = '**/api/v1/platform/maintenance-mode'

/**
 * The first page a fresh `vite --force` server serves transforms the whole
 * app on demand, which can outlast the default 5 s expect timeout when this
 * file runs first; later navigations are warm.
 */
const COLD_TRANSFORM_BUDGET_MS = 20_000

/** The platform state off, as the routed GET first answers it. */
const OFF = {
  mode: 'off',
  message: null,
  reason: null,
  since: '2026-10-05T09:00:00.000Z',
  changedBy: { id: '20000000-0000-4000-8000-000000000100', name: 'Sam Staff' },
  version: 4,
  queues: [
    { name: 'email', paused: false, active: 0 },
    { name: 'notification', paused: false, active: 0 },
    { name: 'maintenance', paused: false, active: 0 },
    { name: 'analytics', paused: false, active: 1 },
  ],
  environment: 'staging',
}

/** Answers `route` with express's success envelope around `data`, stamped for the hermetic teardown. */
function fulfillOk(route: Route, data: unknown, message: string) {
  return route.fulfill({
    status: 200,
    headers: { [FALLBACK_HEADER]: '1' },
    json: { success: true, message, statusCode: 200, data },
  })
}

/**
 * Routes the platform state and its change: the GET answers the current
 * state; the first PUT is refused for a stale sign-in, the second applies.
 * @returns Every PUT body, in order.
 */
async function routeMaintenance(page: Page): Promise<unknown[]> {
  let state: Record<string, unknown> = OFF
  const bodies: unknown[] = []
  await page.context().route(MAINTENANCE, async (route) => {
    const request = route.request()
    if (request.method() === 'GET') return fulfillOk(route, state, 'Maintenance mode retrieved.')
    const body = request.postDataJSON() as Record<string, unknown>
    bodies.push(body)
    if (bodies.length === 1) {
      return route.fulfill({
        status: 401,
        headers: { [FALLBACK_HEADER]: '1' },
        json: {
          success: false,
          message: 'Recent sign-in required',
          statusCode: 401,
          code: 'REAUTH_REQUIRED',
          requestId: 'e2e',
        },
      })
    }
    state = {
      ...OFF,
      mode: body.mode,
      message: body.message,
      reason: body.reason,
      since: '2026-10-06T10:42:00.000Z',
      changedBy: { id: '20000000-0000-4000-8000-000000000001', name: 'A B' },
      version: 5,
      queues: OFF.queues.map((queue) => ({ ...queue, paused: true })),
    }
    return fulfillOk(route, state, 'Maintenance mode updated.')
  })
  await page
    .context()
    .route('**/api/v1/auth/reauthenticate', (route) =>
      fulfillOk(route, { accessToken: 'stepped-up-token' }, 'Reauthenticated.')
    )
  return bodies
}

test('full maintenance puts a red banner on every staff page, linking to the page', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/tenants&maintenance=full')
  await expect(page.getByRole('heading', { name: 'Tenants', level: 1 })).toBeVisible({
    timeout: COLD_TRANSFORM_BUDGET_MS,
  })
  const banner = page.getByRole('status').filter({ hasText: 'Customers are in FULL maintenance' })
  await expect(banner).toContainText('set by Sam Staff.')
  await banner.getByRole('link', { name: 'Manage' }).click()
  await expect(page.getByRole('heading', { name: 'Maintenance', level: 1 })).toBeVisible()
  await expect(page.getByText('analytics: paused, 1 running')).toBeVisible()
  await expect(page.getByText('Postgres 18 upgrade, ticket OPS-1234')).toBeVisible()
})

test('the maintenance page and its dialog do not scroll sideways at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e/harness/?path=/maintenance&maintenance=full&role=owner')
  await expect(page.getByRole('list', { name: 'Queues' })).toBeVisible()
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
  await page.getByRole('button', { name: 'Switch to read-only…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Switch to read-only maintenance' })
  await expect(dialog.getByRole('region', { name: 'Customer preview' })).toBeVisible()
  expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
})

test('an owner switches customers to full through the typed confirmation and the step-up', async ({
  page,
}) => {
  const bodies = await routeMaintenance(page)
  await page.goto('/e2e/harness/?path=/maintenance&maintenance=route&role=owner')
  await page.getByRole('button', { name: 'Turn on maintenance…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Turn on maintenance' })
  await dialog.getByRole('radio', { name: /^Full/ }).check()
  await dialog.getByLabel('Message for customers').fill('Back by 11:00 UTC.')
  await expect(
    dialog.getByRole('region', { name: 'Customer preview' }).getByText('Back by 11:00 UTC.')
  ).toBeVisible()
  await dialog.getByLabel('Reason').fill('Postgres upgrade')
  await dialog.getByLabel('Type staging to confirm').fill('staging')
  await dialog.getByRole('button', { name: 'Switch to full' }).click()

  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await stepUp.getByLabel('Password').fill('current-password')
  await stepUp.getByRole('button', { name: 'Confirm' }).click()

  await expect(
    page.getByRole('status').filter({ hasText: 'Customers are in FULL maintenance' })
  ).toBeVisible()
  await expect(page.getByText('email: paused, 0 running')).toBeVisible()
  const sent = {
    mode: 'full',
    message: 'Back by 11:00 UTC.',
    expectedVersion: 4,
    reason: 'Postgres upgrade',
    confirm: 'staging',
  }
  expect(bodies).toEqual([sent, sent])
})

test('a viewer reads the state but gets no controls', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/maintenance&maintenance=full&role=viewer')
  await expect(page.getByText('Only a platform owner can change maintenance mode.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Turn off|Switch to|Edit message/ })).toHaveCount(0)
})
