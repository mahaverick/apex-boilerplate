import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/lib/toast'
import { testHeldCharges, testTaxDetails, testTenantBilling } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED, type PlatformTenantDetail } from '@/types/api.types'
import type { StaffTenantBilling } from '@/types/billing.types'

const BILLING = `/tenants/${TENANT_ID}/billing`
const BASE = `/api/v1/platform/tenants/${TENANT_ID}/billing`
const OPEN = testHeldCharges[0]!
const RESOLVED = testHeldCharges[1]!
const REASON = 'Issued the SEZ invoice by hand'

/** Registration on, two payments held. */
const WITH_HOLDS: StaffTenantBilling = {
  ...testTenantBilling,
  taxDocumentsEnabled: true,
  hasTaxDocuments: true,
  openHeldCharges: 2,
}

/** Acme's platform detail. */
const DETAIL: PlatformTenantDetail = {
  id: TENANT_ID,
  name: 'Acme Corp',
  slug: 'acme',
  description: null,
  website: null,
  logo: null,
  lifecycleState: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  deletedAt: null,
  settings: { timezone: 'UTC', locale: 'en' },
  memberCount: 2,
  owners: [],
  pendingInvitationCount: 0,
  pendingOwnerInvitation: null,
}

/**
 * Serves Acme's detail, billing view, empty tax lists and the held charges.
 * @param billing - The billing view.
 * @param held - The held charge rows.
 */
function serve(billing = WITH_HOLDS, held = testHeldCharges) {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(DETAIL, 'Tenant')),
    http.get(BASE, () => ok(billing, 'Billing retrieved.')),
    http.get(`${BASE}/tax-details`, () => ok(testTaxDetails, 'Tax details retrieved.')),
    http.get(`${BASE}/tax-documents`, () => ok(listPage([]), 'Tax documents retrieved.')),
    http.get(`${BASE}/tax-held-charges`, () => ok(listPage(held), 'Held charges retrieved.'))
  )
}

/** The held charges table, once it has rows. */
async function heldTable() {
  const table = await screen.findByRole('table', { name: 'Held SEZ charges' })
  await within(table).findByText(OPEN.paymentId)
  return table
}

describe('the Held SEZ charges card', () => {
  let success: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
    success = vi.spyOn(toast, 'success').mockImplementation(() => '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists both charges with the status, and masks the resolution note', async () => {
    serve()
    renderAppAt(BILLING)
    const table = await heldTable()
    expect(screen.getByRole('heading', { name: 'Held SEZ charges', level: 2 })).toBeVisible()
    expect(
      screen.getByText(
        'We don’t invoice charges for an SEZ (Special Economic Zone) unit automatically. Issue each tax invoice by hand, then mark the charge resolved.'
      )
    ).toBeVisible()
    const [open, resolved] = within(table).getAllByRole('row').slice(1)
    expect(within(open!).getByText('Held: SEZ')).toBeVisible()
    expect(within(open!).getByText('pay_TestHeld0002').tagName).toBe('CODE')
    expect(within(open!).getByText('—')).toBeVisible()
    expect(within(resolved!).getByText('Resolved')).toBeVisible()
    expect(within(resolved!).getByText('Cleo D')).toHaveClass('ph-mask')
    expect(within(resolved!).getByText(RESOLVED.resolution!)).toHaveClass('ph-mask')
    expect(resolved).toHaveTextContent('21 October 2026 by Cleo D')
  })

  it('shows a dash for a held charge with no subscription', async () => {
    serve(WITH_HOLDS, [{ ...OPEN, subscriptionId: null }])
    renderAppAt(BILLING)
    const table = await heldTable()
    const row = within(table).getByText(OPEN.paymentId).closest('tr')!
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2)
    expect(within(row).queryByText('sub_TestActive0001')).toBeNull()
  })

  it('shows the card root id and the empty state', async () => {
    serve(WITH_HOLDS, [])
    renderAppAt(BILLING)
    expect(await screen.findByText('No held charges.')).toBeVisible()
    const card = screen
      .getByRole('heading', { name: 'Held SEZ charges' })
      .closest('[data-slot="card"]')
    expect(card).toHaveAttribute('id', 'held-charges')
  })

  it('shows the card without the tax documents card when registration is off and no documents exist', async () => {
    serve({ ...testTenantBilling, openHeldCharges: 1 })
    renderAppAt(BILLING)
    expect(await screen.findByRole('heading', { name: 'Held SEZ charges' })).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Tax documents' })).toBeNull()
  })

  it('focuses the heading when the page opens on #held-charges', async () => {
    serve()
    renderAppAt(`${BILLING}#held-charges`)
    const heading = await screen.findByRole('heading', { name: 'Held SEZ charges' })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('shows no held card without open charges or registration', async () => {
    serve(testTenantBilling)
    renderAppAt(BILLING)
    await screen.findByRole('heading', { name: 'Billing', level: 2 })
    expect(screen.queryByRole('heading', { name: 'Held SEZ charges' })).toBeNull()
  })

  it('shows the tax documents card root id', async () => {
    serve()
    renderAppAt(BILLING)
    const card = (await screen.findByRole('heading', { name: 'Tax documents' })).closest(
      '[data-slot="card"]'
    )
    expect(card).toHaveAttribute('id', 'tax-documents')
  })

  it('lets an admin mark the open row resolved after step-up, posting the reason', async () => {
    serve()
    const bodies: unknown[] = []
    server.use(
      http.post(`${BASE}/tax-held-charges/${OPEN.id}/resolve`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
          : ok({ ...OPEN, resolvedAt: '2026-10-28T09:00:00.000Z', resolution: REASON }, 'Done.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const table = await heldTable()
    expect(within(table).getAllByRole('button', { name: /^Mark resolved/ })).toHaveLength(1)
    await user.click(
      within(table).getByRole('button', { name: 'Mark resolved: payment pay_TestHeld0002' })
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Mark payment pay_TestHeld0002 resolved?',
    })
    expect(dialog).toHaveTextContent(
      'Do this after you issue its tax invoice by hand. We record your note and issue nothing.'
    )
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Mark resolved' }))
    await confirmStepUp(user)
    await waitFor(() => expect(success).toHaveBeenCalledWith('Held charge marked resolved.'))
    expect(bodies).toEqual([{ reason: REASON }, { reason: REASON }])
  })

  it('lets an admin resolve a charge while registration is off', async () => {
    serve({ ...testTenantBilling, openHeldCharges: 1 })
    const bodies: unknown[] = []
    server.use(
      http.post(`${BASE}/tax-held-charges/${OPEN.id}/resolve`, async ({ request }) => {
        bodies.push(await request.json())
        return ok({ ...OPEN, resolvedAt: '2026-10-28T09:00:00.000Z', resolution: REASON }, 'Done.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const table = await heldTable()
    await user.click(
      within(table).getByRole('button', { name: 'Mark resolved: payment pay_TestHeld0002' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Mark resolved' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Held charge marked resolved.'))
    expect(bodies).toEqual([{ reason: REASON }])
  })

  it.each(['', '#tax-documents'])('does not focus the heading with hash %j', async (hash) => {
    serve()
    renderAppAt(`${BILLING}${hash}`)
    const heading = await screen.findByRole('heading', { name: 'Held SEZ charges' })
    await heldTable()
    expect(heading).not.toHaveFocus()
  })

  it('gives a manager no Mark resolved button', async () => {
    signIn({ ...testUser, platformRole: 'manager' })
    serve()
    renderAppAt(BILLING)
    const table = await heldTable()
    expect(within(table).queryByRole('button', { name: /^Mark resolved/ })).toBeNull()
  })

  it('shows express’s sentence when the charge was already resolved', async () => {
    serve()
    const sentence = 'This held charge was resolved by another admin. Refresh to see it.'
    server.use(
      http.post(`${BASE}/tax-held-charges/${OPEN.id}/resolve`, () =>
        fail(sentence, 409, 'HELD_CHARGE_RESOLVED')
      )
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const table = await heldTable()
    await user.click(
      within(table).getByRole('button', { name: 'Mark resolved: payment pay_TestHeld0002' })
    )
    const dialog = await screen.findByRole('alertdialog')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Mark resolved' }))
    expect(await within(dialog).findByText(sentence)).toBeVisible()
    expect(success).not.toHaveBeenCalled()
  })

  it('filters by status', async () => {
    const seen: URLSearchParams[] = []
    serve()
    server.use(
      http.get(`${BASE}/tax-held-charges`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage(testHeldCharges), 'ok')
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    await heldTable()
    await user.click(screen.getByRole('button', { name: 'Filter by status, Held SEZ charges' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by status, Held SEZ charges' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Resolved' }))
    await waitFor(() => expect(seen.at(-1)?.get('status')).toBe('resolved'))
  })
})

describe('the summary’s held charges badge', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  it('shows Held: SEZ and a link to the card', async () => {
    serve()
    renderAppAt(BILLING)
    const link = await screen.findByRole('link', { name: '2 charges to invoice by hand' })
    expect(link).toHaveAttribute('href', `${BILLING}#held-charges`)
    const summary = link.closest('[data-slot="card"]') as HTMLElement
    expect(within(summary).getByText('Held: SEZ')).toBeVisible()
  })

  it('words one charge in the singular', async () => {
    serve({ ...WITH_HOLDS, openHeldCharges: 1 })
    renderAppAt(BILLING)
    expect(await screen.findByRole('link', { name: '1 charge to invoice by hand' })).toBeVisible()
  })

  it('shows neither with no open charges', async () => {
    serve({ ...WITH_HOLDS, openHeldCharges: 0 })
    renderAppAt(BILLING)
    await screen.findByRole('heading', { name: 'Billing', level: 2 })
    expect(screen.queryByText(/to invoice by hand$/)).toBeNull()
  })
})
