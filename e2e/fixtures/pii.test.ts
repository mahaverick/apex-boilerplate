import { unmaskedPii } from '../helpers/pii-guard'
import { expect, test } from '../hermetic'

/**
 * The DOM half of the PII guard: on every staff page the harness can show,
 * each person's name and every email address renders inside `Pii`
 * (`.ph-sensitive.ph-mask`), so autocapture leaves it out of `$el_text` and
 * replay masks it. The names are the harness's people; any address at all
 * counts. The network half, over what really reaches PostHog, is the live
 * suite's (e2e/nginx/analytics.test.ts).
 */

const NAMES = ['A B', 'Cleo D', 'Cleo', 'Sam Staff', 'Evangeline', 'Featherstonehaugh']

const ACME = '/tenants/10000000-0000-4000-8000-000000000001'
const DELTA = '/tenants/10000000-0000-4000-8000-000000000004'
const CLEO = '/users/20000000-0000-4000-8000-000000000002'
const DELETED = '/users/20000000-0000-4000-8000-000000000003'
const DELIVERED = '/emails/70000000-0000-4000-8000-000000000001'
const BOUNCED = '/emails/70000000-0000-4000-8000-000000000002'

for (const [name, path, ready] of [
  ['the overview', '/overview', 'Overview'],
  ['users', '/users', 'Users'],
  ['a user', CLEO, 'Cleo D'],
  ['a deleted user', DELETED, 'Evangeline Featherstonehaugh'],
  ['staff', '/staff', 'Staff'],
  ['activity', '/activity', 'Activity'],
  ['tenants', '/tenants', 'Tenants'],
  ['a tenant', ACME, 'Acme Corp'],
  ['a tenant without an owner', DELTA, 'Delta LLC'],
  ['a tenant’s members', `${ACME}/members`, 'Acme Corp'],
  ['a tenant’s invitations', `${ACME}/invitations`, 'Acme Corp'],
  ['a tenant’s activity', `${ACME}/activity`, 'Acme Corp'],
  ['a tenant’s emails', `${ACME}/emails`, 'Acme Corp'],
  ['a tenant’s onboarding', `${ACME}/onboarding`, 'Acme Corp'],
  ['the emails list', '/emails', 'Emails'],
  ['an email', DELIVERED, 'c@d.com'],
  ['an email’s preview', `${DELIVERED}?tab=preview`, 'c@d.com'],
  ['a bounced email', BOUNCED, 'a-very-long-address-for-overflow@example-company-domain.com'],
  ['deliverability', '/deliverability', 'Deliverability'],
  ['suppressions, active and lifted', '/suppressions?state=all', 'Suppressions'],
  ['onboarding', '/onboarding', 'Onboarding'],
  ['the profile', '/profile', 'Profile'],
] as const) {
  test(`${name} renders every name and address inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 1, exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

test('the user menu’s initials and name, and the open palette’s people, sit inside Pii', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/overview')
  await expect(page.getByRole('heading', { name: 'Overview', level: 1 })).toBeVisible()
  const fallback = page.locator('[data-slot="avatar-fallback"]')
  await expect(fallback).not.toHaveCount(0)
  for (const initials of await fallback.all()) {
    await expect(initials.locator('.ph-sensitive.ph-mask')).toHaveCount(1)
  }

  await page.getByRole('button', { name: /Search/ }).click()
  await page.getByRole('combobox', { name: 'Search pages, tenants and users' }).fill('c')
  await expect(page.getByRole('option', { name: /c@d\.com/ })).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

test('the email preview’s frame is blocked from replay', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${DELIVERED}?tab=preview`)
  await expect(page.getByTitle('Email preview')).toHaveClass(/ph-no-capture/)
})
