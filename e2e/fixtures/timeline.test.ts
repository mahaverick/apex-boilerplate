import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * The user and tenant timelines in a real browser, through the harness:
 * seeded sessions and requests render, the window and view drive both the
 * URL and the request, each Watch replay link opens its own session, a
 * viewer is refused with no PostHog link anywhere, and nothing scrolls
 * sideways at 390px.
 */

const CLEO_TIMELINE = '/users/20000000-0000-4000-8000-000000000002/timeline'
const ACME_TIMELINE = '/tenants/10000000-0000-4000-8000-000000000001/timeline'
const REPLAY = 'https://us.posthog.com/project/1/replay/'

for (const [name, path, level] of [
  ['a user’s timeline', CLEO_TIMELINE, 1],
  ['a tenant’s timeline', ACME_TIMELINE, 2],
] as const) {
  test(`${name} shows its sessions, the request inside one and the staff action`, async ({
    page,
  }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: 'Timeline', level })).toBeVisible()
    const list = page.getByRole('list', { name: 'Timeline' })
    const sessions = list.getByRole('list', { name: 'Session events' })
    await expect(sessions).toHaveCount(2)
    await expect(sessions.first().getByText('Signed in with Google')).toBeVisible()
    await expect(list.getByText(/Customer app · 4 events/)).toBeVisible()

    const related = sessions.first().getByRole('button', { name: '+1 related' })
    await expect(related).toHaveAttribute('aria-expanded', 'false')
    await related.click()
    await expect(related).toHaveAttribute('aria-expanded', 'true')
    await expect(sessions.first().getByText('Identity check (step-up)')).toBeVisible()

    const replays = page.getByRole('link', { name: /Watch replay/ })
    await expect(replays).toHaveCount(2)
    await expect(replays.first()).toHaveAttribute(
      'href',
      `${REPLAY}0199a000-0000-7000-8000-000000000001`
    )
    await expect(replays.last()).toHaveAttribute(
      'href',
      `${REPLAY}0199a000-0000-7000-8000-000000000002`
    )
  })

  test(`${name} does not scroll sideways at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('list', { name: 'Timeline' })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
  })
}

test('the view and the window change the URL and the request', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${CLEO_TIMELINE}`)
  const list = page.getByRole('list', { name: 'Timeline' })
  await expect(list.getByText("Clicked 'Resend to c@d.com'")).toBeVisible()

  const keyRequest = page.waitForRequest(
    (request) => request.url().includes('/timeline?') && request.url().includes('view=key')
  )
  await page.getByRole('button', { name: 'Key events' }).click()
  expect(new URL((await keyRequest).url()).searchParams.get('range')).toBe('7d')
  await expect(page).toHaveURL(/[?&]view=key/)
  await expect(list.getByText('Signed in with Google')).toBeVisible()
  await expect(list.getByText("Clicked 'Resend to c@d.com'")).toHaveCount(0)

  const rangeRequest = page.waitForRequest((request) => request.url().includes('range=24h'))
  await page.getByRole('combobox', { name: 'Time range' }).click()
  await page.getByRole('option', { name: 'Last 24 hours' }).click()
  expect(new URL((await rangeRequest).url()).searchParams.get('view')).toBe('key')
  await expect(page).toHaveURL(/[?&]range=24h/)
  await expect(list.getByText('Deactivated a user')).toHaveCount(0)
})

test('Load more asks for the page before the cursor', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${CLEO_TIMELINE}`)
  const older = page.waitForRequest((request) => request.url().includes('before=older'))
  await page.getByRole('button', { name: 'Load more events' }).click()
  await older
  await expect(page.getByText('Viewed /users')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Load more events' })).toHaveCount(0)
})

for (const [name, path] of [
  ['a user’s timeline', CLEO_TIMELINE],
  ['a tenant’s timeline', ACME_TIMELINE],
] as const) {
  test(`a viewer is refused ${name}, with no PostHog link`, async ({ page }) => {
    let asked = 0
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.endsWith('/timeline')) asked += 1
    })
    await page.goto(`/e2e/harness/?path=${path}&role=viewer`)
    await expect(page.getByText(/Your role can’t see this any more/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Watch replay|Open in PostHog/ })).toHaveCount(0)
    if (path === ACME_TIMELINE) {
      await expect(
        page
          .getByRole('navigation', { name: 'Tenant sections' })
          .getByRole('link', { name: 'Timeline' })
      ).toHaveCount(0)
    }
    // The role gate renders before any query mounts, so the refusal on screen is the barrier.
    expect(asked).toBe(0)
  })
}
