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
const CLEO_ID = '20000000-0000-4000-8000-000000000002'
const CLEO = `/users/${CLEO_ID}`
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
  ['maintenance, with the banner', '/maintenance&maintenance=full', 'Maintenance'],
  ['the profile', '/profile', 'Profile'],
] as const) {
  test(`${name} renders every name and address inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 1, exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

/**
 * The timelines, once their rows have landed and a request is expanded: the
 * actors' names and addresses (tenant), the clicked text naming a person or
 * an address, and the paths. Each waits on a probe row first, so the guard
 * never passes over a page still loading.
 */
for (const [name, path, probe] of [
  ['a user’s timeline', `${CLEO}/timeline`, "Clicked 'Resend to c@d.com'"],
  ['a tenant’s timeline', `${ACME}/timeline`, "Clicked 'Remove Evangeline Featherstonehaugh'"],
] as const) {
  test(`${name} renders every name, address and clicked text inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByText(probe)).toBeVisible()
    await page.getByRole('button', { name: '+1 related' }).click()
    await expect(page.getByText('Identity check (step-up)')).toBeVisible()
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

/**
 * The Errors tabs, once their issues have landed: an exception message is
 * untrusted text that can name a person (express scrubs addresses, not
 * names), so it renders inside Pii.
 */
for (const [name, path] of [
  ['a user’s errors', `${CLEO}/errors`],
  ['a tenant’s errors', `${ACME}/errors`],
] as const) {
  test(`${name} renders every name and message inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByText('Member Evangeline Featherstonehaugh has no role')).toBeVisible()
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

/**
 * The flags pages, once an evaluation has landed: the evaluated user's name
 * and address, the user picker's matches and a tenant's member buttons.
 */
for (const [name, path] of [
  ['the flags evaluation', `/flags?userId=${CLEO_ID}`],
  ['a tenant’s flags', `${ACME}/flags?userId=${CLEO_ID}`],
] as const) {
  test(`${name} renders every name and address inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('table', { name: 'Evaluation' })).toBeVisible()
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

test('the flags user picker lists its matches inside Pii', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/flags')
  await page.getByRole('searchbox', { name: 'Find a user' }).fill('c')
  await expect(page.getByRole('list', { name: 'Matching users' })).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

test('a tenant’s timeline names its actors, each inside Pii', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME}/timeline`)
  const list = page.getByRole('list', { name: 'Timeline' })
  await expect(list.getByRole('link', { name: 'Cleo D' }).first()).toBeVisible()
  await expect(
    list.getByRole('link', { name: 'a-very-long-address-for-overflow@example-company-domain.com' })
  ).toBeVisible()
  await expect(list.getByText('Deleted user')).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

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

/**
 * The owner's switch-on dialog, open over the harness's off state: what an
 * owner types as the customer message can name a person, and the preview
 * echoes it, so the preview's text must render inside Pii. Nothing else on
 * the page names anyone, so the typed names are the only ones to find.
 */
test('the owner’s switch-on dialog and its preview keep a typed name inside Pii', async ({
  page,
}) => {
  await page.goto('/e2e/harness/?path=/maintenance&role=owner')
  await page.getByRole('button', { name: 'Turn on maintenance…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Turn on maintenance' })
  await dialog.getByLabel('Message for customers').fill('Ask Sam Staff or Cleo D for access.')
  const preview = dialog.getByRole('region', { name: 'Customer preview' })
  const echoed = preview.getByText('Ask Sam Staff or Cleo D for access.')
  await expect(echoed).toBeVisible()
  await expect(echoed).toHaveClass(/ph-sensitive/)
  await expect(echoed).toHaveClass(/ph-mask/)
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

test('the email preview’s frame is blocked from replay', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${DELIVERED}?tab=preview`)
  await expect(page.getByTitle('Email preview')).toHaveClass(/ph-no-capture/)
})
