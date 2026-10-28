import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/lib/toast'
import { GSTIN_CHECKSUM_MESSAGE } from '@/schemas/tax-details.schemas'
import { testTaxDetails, testTenantBilling } from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED, type PlatformTenantDetail } from '@/types/api.types'
import type { StaffTaxDetails, StaffTenantBilling } from '@/types/billing.types'

const BILLING = `/tenants/${TENANT_ID}/billing`
const BASE = `/api/v1/platform/tenants/${TENANT_ID}/billing`
const REASON = 'Customer sent a corrected certificate'

/** Registration on. */
const ENABLED: StaffTenantBilling = { ...testTenantBilling, taxDocumentsEnabled: true }
/** Registration off, documents issued. */
const OFF_WITH_DOCUMENTS: StaffTenantBilling = { ...testTenantBilling, hasTaxDocuments: true }

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
 * Serves Acme's detail, billing and tax details.
 * @param details - The stored details, or `null` for none.
 * @param billing - The billing view.
 */
function serve(details: StaffTaxDetails | null = testTaxDetails, billing = ENABLED) {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(DETAIL, 'Tenant')),
    http.get(BASE, () => ok(billing, 'Billing retrieved.')),
    http.get(`${BASE}/tax-documents`, () =>
      ok({ items: [], hasNext: false, nextCursor: null }, 'Tax documents retrieved.')
    ),
    http.get(`${BASE}/tax-details`, () => ok(details, 'Tax details retrieved.'))
  )
}

/**
 * Records each PATCH body; the first is refused for a stale sign-in, and the retry answers `answer`.
 * @param answer - What the retry answers; a function may refuse.
 */
function recordPatch(
  answer: () => Response | Promise<Response> = () => ok({ ...testTaxDetails, version: 4 }, 'Saved.')
) {
  const bodies: unknown[] = []
  server.use(
    http.patch(`${BASE}/tax-details`, async ({ request }) => {
      bodies.push(await request.json())
      return bodies.length === 1 ? fail('Recent sign-in required', 401, REAUTH_REQUIRED) : answer()
    })
  )
  return bodies
}

/** Records PATCH bodies and answers every one with `answer`, with no step-up. */
function recordPlainPatch(answer: () => Response | Promise<Response>) {
  const bodies: unknown[] = []
  server.use(
    http.patch(`${BASE}/tax-details`, async ({ request }) => {
      bodies.push(await request.json())
      return answer()
    })
  )
  return bodies
}

/**
 * Opens the dialog from the card's button.
 * @param user - The test's user-event instance.
 * @param name - The button's name.
 */
async function openDialog(user: ReturnType<typeof userEvent.setup>, name = 'Correct tax details') {
  await user.click(await screen.findByRole('button', { name }))
  const verb = name.startsWith('Add') ? 'Add' : 'Correct'
  return screen.findByRole('dialog', { name: new RegExp(`^${verb} tax details for Acme Corp`) })
}

/**
 * Replaces a field's text.
 * @param user - The test's user-event instance.
 * @param dialog - The open dialog.
 * @param label - The field's label.
 * @param text - The new text.
 */
async function replace(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  label: string,
  text: string
) {
  const field = within(dialog).getByLabelText(label)
  await user.clear(field)
  await user.type(field, text)
}

describe('the Tax details card', () => {
  let success: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'manager' })
    success = vi.spyOn(toast, 'success').mockImplementation(() => '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a viewer the rows, with the personal ones masked, and no button', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    serve()
    renderAppAt(BILLING)
    expect(await screen.findByRole('heading', { name: 'Tax details', level: 2 })).toBeVisible()
    expect(
      screen.getByText(
        'What this tenant’s tax invoices name as the buyer. A change applies to invoices issued from then on; issued documents keep the details they were issued with.'
      )
    ).toBeVisible()
    const card = (await screen.findByRole('heading', { name: 'Tax details' })).closest(
      '[data-slot="card"]'
    ) as HTMLElement
    const rows = within(card)
    expect(await rows.findByText('29ABCDE1234F1ZW')).toHaveClass('ph-mask')
    expect(rows.getByText('Acme Corp Private Limited')).toHaveClass('ph-mask')
    expect(rows.getByText(/12 MG Road, Bengaluru, 560001/)).toHaveClass('ph-mask')
    expect(rows.getByText('29 Karnataka')).toBeVisible()
    expect(rows.getByText('No')).toBeVisible()
    expect(card).toHaveTextContent('22 October 2026')
    expect(rows.getByText('Cleo D')).toHaveClass('ph-mask')
    expect(rows.queryByRole('button', { name: 'Correct tax details' })).toBeNull()
  })

  it('words an unregistered buyer, an SEZ unit and a deleted editor', async () => {
    signIn({ ...testUser, platformRole: 'viewer' })
    serve({ ...testTaxDetails, gstin: null, isSez: true, updatedBy: null })
    renderAppAt(BILLING)
    expect(await screen.findByText('None (B2C, business-to-consumer)')).toBeVisible()
    expect(screen.getByText('Yes. We hold its charges for staff to invoice by hand.')).toBeVisible()
    expect(screen.getByText(/by a deleted account/)).toBeVisible()
  })

  it('shows an empty state when no details are saved, with Add tax details for a manager', async () => {
    serve(null)
    renderAppAt(BILLING)
    expect(await screen.findByText('No tax details saved.')).toBeVisible()
    expect(
      screen.getByText(
        'This tenant’s invoices carry no GSTIN (Goods and Services Tax Identification Number), so we issue them as business-to-consumer (B2C) invoices.'
      )
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add tax details' })).toBeVisible()
  })

  it('gives a manager the button, and with registration off and documents present only the read-only note', async () => {
    serve()
    const { unmount } = renderAppAt(BILLING)
    expect(await screen.findByRole('button', { name: 'Correct tax details' })).toBeVisible()
    unmount()
    signIn({ ...testUser, platformRole: 'manager' })
    serve(testTaxDetails, OFF_WITH_DOCUMENTS)
    renderAppAt(BILLING)
    expect(
      await screen.findByText(
        'This server no longer issues tax documents. These details are read-only, and every issued document stays downloadable.'
      )
    ).toBeVisible()
    expect(await screen.findByText('29 Karnataka')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Correct tax details' })).toBeNull()
  })

  it('sends only the PIN code with the version and reason after step-up, and toasts the staff sentence', async () => {
    serve()
    const bodies = recordPatch()
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    expect(
      within(dialog).getByText(
        'Invoices issued from now on use these details. Issued invoices and credit notes don’t change.'
      )
    ).toBeVisible()
    await replace(user, dialog, 'PIN code', '560002')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    await confirmStepUp(user)
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        'Tax details for Acme Corp saved. They apply to invoices issued from now on.'
      )
    )
    expect(bodies).toEqual([
      { version: 3, pincode: '560002', reason: REASON },
      { version: 3, pincode: '560002', reason: REASON },
    ])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('saves a first set of details with version null and every field', async () => {
    serve(null)
    const bodies = recordPatch(() => ok({ ...testTaxDetails, version: 1 }, 'Saved.'))
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user, 'Add tax details')
    await replace(user, dialog, 'Legal name', 'Acme Corp Private Limited')
    await replace(user, dialog, 'Address line 1', '12 MG Road')
    await replace(user, dialog, 'City', 'Bengaluru')
    await replace(user, dialog, 'PIN code', '560001')
    await user.click(within(dialog).getByRole('combobox', { name: 'State' }))
    await user.click(await screen.findByRole('option', { name: '29 Karnataka' }))
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    await confirmStepUp(user)
    await waitFor(() => expect(success).toHaveBeenCalled())
    expect(bodies[1]).toEqual({
      version: null,
      gstin: null,
      legalName: 'Acme Corp Private Limited',
      addressLine1: '12 MG Road',
      addressLine2: null,
      city: 'Bengaluru',
      pincode: '560001',
      stateCode: '29',
      isSez: false,
      reason: REASON,
    })
  })

  it('sends only the city when stored details hold a GSTIN today’s check refuses', async () => {
    serve({ ...testTaxDetails, gstin: '29ABCDE1234F1Z0' })
    const bodies = recordPatch()
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await replace(user, dialog, 'City', 'Mysuru')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    await confirmStepUp(user)
    await waitFor(() => expect(success).toHaveBeenCalled())
    expect(bodies[0]).toEqual({ version: 3, city: 'Mysuru', reason: REASON })
  })

  it('asks for a change and sends nothing when nothing changed', async () => {
    serve()
    const bodies = recordPlainPatch(() => ok(testTaxDetails, 'Saved.'))
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    expect(
      await within(dialog).findByText('Change at least one tax detail before saving.')
    ).toBeVisible()
    expect(bodies).toEqual([])
  })

  it('shows the state mismatch under State without posting', async () => {
    serve()
    const bodies = recordPlainPatch(() => ok(testTaxDetails, 'Saved.'))
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await replace(user, dialog, 'GSTIN (optional)', '27ABCDE1234F1Z0')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    const message = 'This GSTIN is registered in Maharashtra. Choose Maharashtra as the state.'
    expect(await within(dialog).findByText(message)).toBeVisible()
    expect(within(dialog).getByRole('combobox', { name: 'State' })).toHaveAccessibleDescription(
      message
    )
    expect(bodies).toEqual([])
  })

  it('shows the checksum message for 29ABCDE1234F1ZX without posting', async () => {
    serve()
    const bodies = recordPlainPatch(() => ok(testTaxDetails, 'Saved.'))
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await replace(user, dialog, 'GSTIN (optional)', '29ABCDE1234F1ZX')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    expect(await within(dialog).findByText(GSTIN_CHECKSUM_MESSAGE)).toBeVisible()
    expect(bodies).toEqual([])
  })

  it('toasts express’s message when registration was turned off, closes the dialog and leaves the card read-only', async () => {
    serve()
    let refused = false
    let billingReads = 0
    server.use(
      http.get(BASE, () => {
        billingReads += 1
        return ok(refused ? OFF_WITH_DOCUMENTS : ENABLED, 'Billing retrieved.')
      })
    )
    recordPlainPatch(() => {
      refused = true
      return fail('Tax documents are off on this server.', 404, 'tax_documents_disabled')
    })
    const error = vi.spyOn(toast, 'error').mockImplementation(() => '')
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await replace(user, dialog, 'PIN code', '560002')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    const before = billingReads
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    await waitFor(() => expect(error).toHaveBeenCalledWith('Tax documents are off on this server.'))
    await waitFor(() => expect(billingReads).toBeGreaterThan(before))
    expect(
      await screen.findByText(
        'This server no longer issues tax documents. These details are read-only, and every issued document stays downloadable.'
      )
    ).toBeVisible()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Correct tax details' })).toBeNull()
  })

  it('keeps the typed legal name, shows express’s sentence and refetches the details on a 409', async () => {
    let detailReads = 0
    serve()
    server.use(
      http.get(`${BASE}/tax-details`, () => {
        detailReads += 1
        return ok(
          detailReads > 1 ? { ...testTaxDetails, version: 4 } : testTaxDetails,
          'Tax details retrieved.'
        )
      })
    )
    recordPlainPatch(() =>
      fail(
        'Someone else changed these details. Reload and try again.',
        409,
        'TAX_DETAILS_VERSION_CONFLICT'
      )
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await replace(user, dialog, 'Legal name', 'Acme Holdings Private Limited')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    const before = detailReads
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    expect(
      await within(dialog).findByText('Someone else changed these details. Reload and try again.')
    ).toBeVisible()
    expect(within(dialog).getByLabelText('Legal name')).toHaveValue('Acme Holdings Private Limited')
    await waitFor(() => expect(detailReads).toBeGreaterThan(before))
  })

  it('shows an API field error under State, and choosing another state clears it', async () => {
    serve()
    recordPlainPatch(() =>
      HttpResponse.json(
        {
          success: false,
          message: 'Validation failed.',
          statusCode: 400,
          errors: { stateCode: ['Choose a state from the list.'] },
          requestId: 'test-request-id',
        },
        { status: 400 }
      )
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await replace(user, dialog, 'PIN code', '560002')
    await user.type(within(dialog).getByLabelText('Reason'), REASON)
    await user.click(within(dialog).getByRole('button', { name: 'Save tax details' }))
    const state = within(dialog).getByRole('combobox', { name: 'State' })
    await waitFor(() => expect(state).toHaveAccessibleDescription('Choose a state from the list.'))
    await user.click(state)
    await user.click(await screen.findByRole('option', { name: '27 Maharashtra' }))
    await waitFor(() =>
      expect(state).not.toHaveAccessibleDescription('Choose a state from the list.')
    )
  })

  it('shows the Required with a GSTIN hint on the address fields once a GSTIN is typed', async () => {
    serve(null)
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user, 'Add tax details')
    expect(within(dialog).queryByText('Required with a GSTIN.')).toBeNull()
    await user.type(within(dialog).getByLabelText('GSTIN (optional)'), '29ABCDE1234F1ZW')
    expect(within(dialog).getAllByText('Required with a GSTIN.')).toHaveLength(3)
  })

  it('titles the first-save dialog Add, not Correct', async () => {
    serve(null)
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user, 'Add tax details')
    expect(within(dialog).getByText('Add tax details for Acme Corp')).toBeVisible()
  })

  describe('when the details fail to load', () => {
    it('shows RoleDenied for a role-gate 404', async () => {
      serve()
      server.use(http.get(`${BASE}/tax-details`, () => fail('Not found.', 404, 'not_found')))
      renderAppAt(BILLING)
      expect(await screen.findByText('Your role can’t see this any more.')).toBeVisible()
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    })

    it('keeps express’s note for a 404 tax_documents_disabled', async () => {
      serve()
      server.use(
        http.get(`${BASE}/tax-details`, () =>
          fail('Tax documents are off on this server.', 404, 'tax_documents_disabled')
        )
      )
      renderAppAt(BILLING)
      expect(await screen.findByText('Tax documents are off on this server.')).toBeVisible()
      expect(screen.queryByText('Your role can’t see this any more.')).toBeNull()
    })

    it('offers Try again for a 5xx, and reads again on select', async () => {
      serve()
      let healed = false
      server.use(
        http.get(`${BASE}/tax-details`, () =>
          healed
            ? ok(testTaxDetails, 'Tax details retrieved.')
            : fail('Our server hit an error.', 500, 'INTERNAL_ERROR')
        )
      )
      const user = userEvent.setup()
      renderAppAt(BILLING)
      const retry = await screen.findByRole('button', { name: 'Try again' })
      healed = true
      await user.click(retry)
      expect(await screen.findByText('29ABCDE1234F1ZW')).toBeVisible()
    })
  })
})
