import { expect, test } from '../hermetic'
import { sidewaysOverflow } from '../layout'

/**
 * The flags inspector, a tenant's Flags tab and the status card's Feature
 * flags section in a real browser, through the harness: the registry,
 * unregistered flags and traits render with their badges and PostHog links,
 * an admin's evaluation explains each value (a holdout user included), an
 * unconfigured environment says so, a viewer gets no evaluation, and nothing
 * scrolls sideways at 390px.
 */

const CLEO = '20000000-0000-4000-8000-000000000002'
const ACME = '10000000-0000-4000-8000-000000000001'
const ACME_FLAGS = `/tenants/${ACME}/flags`

test('the flags page lists the registry, PostHog’s unregistered flags and the traits', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/flags')
  await expect(page.getByRole('heading', { name: 'Feature flags', level: 1 })).toBeVisible()
  const registry = page.getByRole('table', { name: 'Registered flags', exact: true })
  await expect(registry.getByRole('row')).toHaveCount(4)
  await expect(registry.getByText('Unsupported', { exact: true })).toBeVisible()
  await expect(registry.getByText('cohort', { exact: true })).toBeVisible()
  await expect(registry.getByText('Experiment', { exact: true })).toBeVisible()
  await expect(registry.getByRole('link', { name: /Open in PostHog/ }).first()).toHaveAttribute(
    'href',
    'https://us.posthog.com/project/1/feature_flags/101'
  )
  await expect(
    page
      .getByRole('table', { name: 'Unregistered flags' })
      .getByText('legacy_marketing_banner', { exact: true })
  ).toBeVisible()
  const traits = page.getByRole('region', { name: 'Traits reference' })
  await expect(traits.getByRole('button', { name: /^Copy / })).toHaveCount(5)
})

test('an admin’s evaluation explains each value, the holdout included', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=/flags?userId=${CLEO}&tenantId=${ACME}`)
  const panel = page.getByRole('region', { name: 'Evaluate' })
  const table = panel.getByRole('table', { name: 'Evaluation' })
  await expect(table.getByRole('row')).toHaveCount(4)
  await expect(table.getByText('Condition matched')).toBeVisible()
  await expect(table.getByText('Sees control, recorded as holdout-3605')).toBeVisible()
  await expect(table.getByText('Fallback: unsupported')).toBeVisible()
  await expect(panel.getByRole('combobox', { name: 'Tenant' })).toContainText('Acme Corp')
  await expect(panel.getByText('tenant_created_days')).toBeVisible()
})

test('the flags page says when flags are not set up, with no PostHog links', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/flags&flags=unconfigured')
  await expect(
    page.getByText(
      'Feature flags are not set up for this environment, so every flag serves its fallback.'
    )
  ).toBeVisible()
  await expect(page.getByRole('link', { name: /Open in PostHog/ })).toHaveCount(0)
  await expect(page.getByText('None. Every PostHog flag is registered.')).toBeVisible()
})

test('a viewer gets the inspector but no evaluation, and never asks for one', async ({ page }) => {
  let asked = 0
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.endsWith('/flags/evaluate')) asked += 1
  })
  await page.goto(`/e2e/harness/?path=/flags?userId=${CLEO}&role=viewer`)
  await expect(page.getByRole('table', { name: 'Registered flags', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Evaluate' })).toHaveCount(0)
  // The section is gated on the role before its query mounts; the loaded registry is the barrier.
  expect(asked).toBe(0)
})

for (const [name, path] of [
  ['the flags page', `/flags?userId=${CLEO}&tenantId=${ACME}`],
  ['a tenant’s Flags tab', `${ACME_FLAGS}?userId=${CLEO}`],
] as const) {
  test(`${name} does not scroll sideways at 390px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('table', { name: 'Evaluation' })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0)
  })
}

test('a tenant’s Flags tab is last, and evaluates a picked member there', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME_FLAGS}`)
  const nav = page.getByRole('navigation', { name: 'Tenant sections' })
  await expect(nav.getByRole('link').last()).toHaveText('Flags')
  await expect(nav.getByRole('link', { name: 'Flags', exact: true })).toHaveAttribute(
    'aria-current',
    'page'
  )
  await page.getByRole('list', { name: 'Members' }).getByRole('button', { name: /Cleo/ }).click()
  const table = page.getByRole('table', { name: 'Evaluation' })
  await expect(table.getByText('Condition matched')).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`userId=${CLEO}`))
})

test('the user page’s Flags link opens the evaluation for that user', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=/users/${CLEO}`)
  await page.getByRole('link', { name: 'Flags', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Feature flags', level: 1 })).toBeVisible()
  await expect(
    page.getByRole('region', { name: 'Evaluate' }).getByRole('table', { name: 'Evaluation' })
  ).toBeVisible()
})

test('the Overview’s status card shows feature flags, warning on an unsupported flag', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/overview')
  const card = page.getByRole('region', { name: 'System status' })
  const heading = card.getByRole('heading', { name: 'Feature flags', level: 3 })
  await expect(heading).toBeVisible()
  await expect(heading.locator('..').getByText('Needs attention')).toBeVisible()
  await expect(
    card.getByText(
      '3 registered: 1 active, 1 inactive, 0 missing, 1 unsupported, 1 unregistered in PostHog'
    )
  ).toBeVisible()
})
