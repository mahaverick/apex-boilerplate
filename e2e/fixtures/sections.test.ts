import { expect, test } from '../hermetic'

/**
 * One section's slow or failing request changes only that section: the
 * harness holds (`?hold=`) or fails (`?fail=`) one endpoint and the rest of
 * the page renders and stays usable.
 */

test('a held system status leaves the Overview’s figures and charts', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview&hold=/api/v1/platform/system/status')
  await expect(page.getByText('Undelivered rate (7 days)')).toBeVisible()
  await expect(page.getByRole('figure', { name: 'Sign-ups per day' })).toBeVisible()
  // The read is pending, not failed: the card holds its place and nothing alerts.
  await expect(
    page.locator('section[aria-labelledby="system-status"] [data-slot="skeleton"]').first()
  ).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('failed figures show one error, and the system status still renders', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/overview&fail=/api/v1/platform/stats')
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('alert')).toContainText('We could not load the platform figures.')
  await expect(page.getByRole('heading', { level: 2, name: 'System status' })).toBeVisible()
})

test('a held funnel leaves the tenants by state usable', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/onboarding&hold=/api/v1/platform/onboarding/funnel')
  await expect(page.getByRole('tablist', { name: 'Onboarding states' })).toBeVisible()
  await expect(page.locator('[data-slot="query-state"][aria-busy="true"]')).toHaveCount(1)
  // The list rendered beside the pending funnel.
  await expect(page.getByRole('link', { name: 'Acme Corp' })).toBeVisible()
})

test('a failed tenants list leaves the funnel’s figures', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/onboarding&fail=/api/v1/platform/onboarding/tenants')
  await expect(page.getByRole('heading', { level: 1, name: 'Onboarding' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(1)
  await expect(page.getByRole('figure', { name: 'Onboarding funnel' })).toBeVisible()
})
