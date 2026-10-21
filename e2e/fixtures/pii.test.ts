import { maskReplayAttribute } from '../../src/observability/telemetry/mask-attribute'
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

const NAMES = [
  'A B',
  'Cleo D',
  'Cleo',
  'Sam Staff',
  'Evangeline',
  'Featherstonehaugh',
  'Pii Probe’s phone',
]

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
  ['staff', '/settings/platform/staff', 'Staff'],
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
  ['an email', DELIVERED, 'cleo.d@example.com'],
  ['an email’s preview', `${DELIVERED}?tab=preview`, 'cleo.d@example.com'],
  ['a bounced email', BOUNCED, 'a-very-long-address-for-the-overflow-check@example-corp.co.uk'],
  ['deliverability', '/deliverability', 'Deliverability'],
  ['suppressions, active and lifted', '/suppressions?state=active,lifted', 'Suppressions'],
  ['onboarding', '/onboarding', 'Onboarding'],
  [
    'maintenance, with the banner',
    '/settings/platform/maintenance&maintenance=full',
    'Maintenance',
  ],
  ['the profile', '/settings/account/profile', 'Profile'],
] as const) {
  test(`${name} renders every name and address inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 1, exact: true })).toBeVisible()
    await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0)
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

/**
 * The flags pages, once an evaluation has landed: the evaluated user's name
 * and address, the user picker's matches and a tenant's member buttons.
 */
for (const [name, path] of [
  ['the flags evaluation', `/settings/platform/flags?userId=${CLEO_ID}`],
  ['a tenant’s flags', `${ACME}/flags?userId=${CLEO_ID}`],
] as const) {
  test(`${name} renders every name and address inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('table', { name: 'Evaluation' })).toBeVisible()
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

test('the flags user picker lists its matches inside Pii', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/settings/platform/flags')
  // The page reads its meta, the registry and the unregistered flags apart; the picker is there once the registry has landed.
  await expect(page.getByRole('table', { name: 'Registered flags', exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Find a user' }).fill('c')
  await expect(page.getByRole('list', { name: 'Matching users' })).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

/**
 * The Activity page's sentence: a reason a staff member typed can name a
 * person, and the sentence carries it, so the whole sentence renders inside Pii.
 */
test('the activity sentence keeps a reason’s typed name inside Pii', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/activity')
  const sentence = page.getByText(/Escalated by Cleo D after the overdue invoices/)
  await expect(sentence).toBeVisible()
  await expect(sentence).toHaveClass(/ph-sensitive/)
  await expect(sentence).toHaveClass(/ph-mask/)
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
  await expect(page.getByRole('option', { name: /cleo\.d@example\.com/ })).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

test('the palette’s recent and searched people sit inside Pii', async ({ page }) => {
  // Opening Cleo's page records her, so the empty palette lists her under Recent.
  await page.goto(`/e2e/harness/?path=${CLEO}`)
  await expect(page.getByRole('heading', { name: 'Cleo D', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: /Search…/ }).click()
  const palette = page.getByRole('dialog', { name: 'Command palette', exact: true })
  await expect(
    palette
      .getByRole('group', { name: 'Recent' })
      .getByRole('option', { name: /cleo\.d@example\.com/ })
  ).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])

  await page.getByRole('combobox', { name: 'Search pages, tenants and users' }).fill('c')
  await expect(
    palette
      .getByRole('group', { name: 'Users' })
      .getByRole('option', { name: /cleo\.d@example\.com/ })
  ).toBeVisible()
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
  await page.goto('/e2e/harness/?path=/settings/platform/maintenance&role=owner')
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

/** A token the link and invitation pages take: 43 characters, low-entropy so no scanner reads it as a secret. */
const TOKEN = 't'.repeat(43)

/**
 * The signed-out and switch-account states of the link pages, the step-up
 * wait and the staff sign-in link dialog. Each names an address, which is
 * shown before the scan, so the scan cannot pass on a page that never
 * rendered it.
 */
test('the sign-in page’s Check your inbox keeps the address inside Pii', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/login&session=none')
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill('ada@example.test')
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click()
  await expect(page.getByRole('heading', { name: 'Check your inbox', level: 1 })).toBeVisible()
  await expect(page.getByText('ada@example.test')).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

for (const [name, path, ready, shown] of [
  [
    'a sign-in link for another account',
    `/auth/link&token=${TOKEN}&email=new.staff@example.com`,
    'Switch account?',
    'new.staff@example.com',
  ],
  [
    'a staff invitation for another account',
    `/invitations/accept&token=${TOKEN}`,
    'Join the staff team',
    'new.staff@example.com',
  ],
  [
    'a staff invitation’s Check your inbox',
    `/invitations/accept&session=none&token=${TOKEN}`,
    'Check your inbox',
    'new.staff@example.com',
  ],
  [
    'a confirmation link for another account',
    `/invitations/confirm&token=${TOKEN}&email=new.staff@example.com`,
    'Join your team',
    'new.staff@example.com',
  ],
] as const) {
  test(`${name} keeps both addresses inside Pii`, async ({ page }) => {
    await page.goto(`/e2e/harness/?path=${path}`)
    await expect(page.getByRole('heading', { name: ready, level: 1 })).toBeVisible()
    await expect(page.getByText(shown).first()).toBeVisible()
    expect(await unmaskedPii(page, NAMES)).toEqual([])
  })
}

test('the step-up’s email wait keeps the address it mailed inside Pii', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${ACME}`)
  await expect(page.getByRole('heading', { name: 'Acme Corp', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Suspend' }).click()
  const reason = page.getByRole('alertdialog', { name: 'Suspend Acme Corp?' })
  await reason.getByLabel('Reason').fill('pii check')
  await reason.getByRole('button', { name: 'Suspend', exact: true }).click()
  const stepUp = page.getByRole('dialog', { name: 'Confirm it’s you' })
  await stepUp.getByRole('button', { name: 'Email me a link' }).click()
  await expect(stepUp.getByText('a.b@example.com')).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

test('the Send sign-in link dialog keeps the address it names inside Pii', async ({ page }) => {
  await page.goto(`/e2e/harness/?path=${CLEO}`)
  await page.getByRole('button', { name: 'Actions for cleo.d@example.com' }).click()
  await page.getByRole('menuitem', { name: 'Send sign-in link' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Send a sign-in link?' })
  await expect(dialog.getByText('cleo.d@example.com')).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})

/**
 * The Security page's passkey list and both dialogs: a passkey's name is typed
 * by the user and can name a person, so every place it renders sits inside `Pii`,
 * and the buttons' labels, which carry it, are masked by replay's attribute rule.
 */
test('the passkeys list and both dialogs keep a passkey’s name inside Pii', async ({ page }) => {
  await page.goto('/e2e/harness/?path=/settings/account/security&passkeylist=two&pii=probe')
  const row = page.getByRole('listitem').filter({ hasText: 'Pii Probe’s phone' })
  await expect(row).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])

  for (const action of ['Rename', 'Delete']) {
    const label = await row.getByRole('button', { name: action }).getAttribute('aria-label')
    expect(label).toBe(`${action} Pii Probe’s phone`)
    expect(maskReplayAttribute('aria-label', label!)).toBe('***')
  }

  await row.getByRole('button', { name: 'Rename' }).click()
  await expect(page.getByRole('dialog', { name: 'Rename passkey' })).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog', { name: 'Rename passkey' })).toHaveCount(0)

  await row.getByRole('button', { name: 'Delete' }).click()
  const remove = page.getByRole('alertdialog')
  await expect(remove.getByText('Pii Probe’s phone')).toBeVisible()
  expect(await unmaskedPii(page, NAMES)).toEqual([])
})
