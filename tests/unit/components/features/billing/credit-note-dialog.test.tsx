import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { toast } from '@/lib/toast'
import {
  testInvoices,
  testTaxDetails,
  testTaxDocuments,
  testTenantBilling,
} from '@/tests/fixtures/billing'
import { TENANT_ID } from '@/tests/fixtures/ids'
import { listPage } from '@/tests/fixtures/list-page'
import { renderAppAt, signIn } from '@/tests/fixtures/render-app'
import { settle } from '@/tests/fixtures/timing'
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import { confirmStepUp } from '@/tests/mocks/step-up'
import { REAUTH_REQUIRED, type PlatformTenantDetail } from '@/types/api.types'
import type { StaffTaxDocumentItem, StaffTenantBilling } from '@/types/billing.types'

const BILLING = `/tenants/${TENANT_ID}/billing`
const BASE = `/api/v1/platform/tenants/${TENANT_ID}/billing`
const INVOICE = testTaxDocuments[0]!
const CREDIT_NOTE = testTaxDocuments[1]!
const TITLE = 'Issue a credit note against INV/26-27/00001'

/** Registration on, documents issued. */
const REGISTERED: StaffTenantBilling = {
  ...testTenantBilling,
  taxDocumentsEnabled: true,
  hasTaxDocuments: true,
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

/** The invoice with nothing credited yet, so ₹999 is left. */
const UNCREDITED = testTaxDocuments.map((document) =>
  document.id === INVOICE.id ? { ...document, creditedMinor: 0 } : document
)

/**
 * Serves Acme's detail, billing view and lists.
 * @param options.billing - The billing view.
 * @param options.documents - The tax document rows.
 */
function serve({
  billing = REGISTERED,
  documents = testTaxDocuments,
}: { billing?: StaffTenantBilling; documents?: StaffTaxDocumentItem[] } = {}) {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(DETAIL, 'Tenant')),
    http.get(BASE, () => ok(billing, 'Billing retrieved.')),
    http.get(`${BASE}/tax-details`, () => ok(testTaxDetails, 'Tax details retrieved.')),
    http.get(`${BASE}/tax-documents`, () => ok(listPage(documents), 'Tax documents retrieved.')),
    http.get(`${BASE}/tax-held-charges`, () => ok(listPage([]), 'Held charges retrieved.')),
    http.get(`${BASE}/invoices`, () => ok(listPage(testInvoices), 'Invoices retrieved.'))
  )
}

/**
 * One data row of the Tax documents table, found by its number.
 * @param number - The document number.
 */
async function rowOf(number: string): Promise<HTMLElement> {
  const table = await screen.findByRole('table', { name: 'Tax documents' })
  const cell = await within(table).findByText(number, { selector: 'code' })
  return cell.closest('tr')!
}

/**
 * Opens the credit note dialog from INV/26-27/00001's row menu.
 * @param user - The user-event instance.
 */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const row = await rowOf('INV/26-27/00001')
  await user.click(within(row).getByRole('button', { name: 'Actions for INV/26-27/00001' }))
  await user.click(await screen.findByRole('menuitem', { name: 'Issue credit note' }))
  return screen.findByRole('dialog', { name: TITLE })
}

/**
 * Types the amount and a reason, and submits.
 * @param user - The user-event instance.
 * @param dialog - The open dialog.
 * @param amount - The rupees as typed.
 */
async function submit(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  amount: string,
  reason = 'Chargeback lost'
) {
  await user.clear(within(dialog).getByLabelText('Amount (₹)'))
  await user.type(within(dialog).getByLabelText('Amount (₹)'), amount)
  await user.type(within(dialog).getByLabelText('Reason'), reason)
  await user.click(within(dialog).getByRole('button', { name: 'Issue credit note' }))
}

describe('the credit note dialog', () => {
  let success: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'admin' })
    success = vi.spyOn(toast, 'success').mockImplementation(() => '')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens from the row menu, which holds the PDF and Issue credit note', async () => {
    serve()
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const row = await rowOf('INV/26-27/00001')
    await user.click(within(row).getByRole('button', { name: 'Actions for INV/26-27/00001' }))
    expect(await screen.findByRole('menuitem', { name: 'Download PDF' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Issue credit note' })).toBeVisible()
  })

  it('states the dispute rule, the amount left and the range', async () => {
    serve({ billing: { ...REGISTERED, provider: null } })
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    expect(dialog).toHaveTextContent(
      'Use this only for a payment dispute the business lost. A refund made in the payment provider gets its credit note automatically.'
    )
    expect(dialog).toHaveTextContent('₹399 of ₹999 is left to credit.')
    expect(within(dialog).getByText('From ₹1 to ₹399.')).toBeVisible()
    expect(
      within(dialog).getByText(
        'Printed on the customer’s credit note. Use English letters, digits and common punctuation.'
      )
    ).toBeVisible()
    expect(within(dialog).getByLabelText('Amount (₹)')).toBeVisible()
  })

  it('names Razorpay when the tenant pays through it', async () => {
    serve({ billing: { ...REGISTERED, provider: 'razorpay' } })
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    expect(dialog).toHaveTextContent(
      'A refund made in Razorpay gets its credit note automatically.'
    )
  })

  it.each([
    ['0.29', 'Enter ₹1 to ₹399.'],
    ['499.995', 'Enter an amount in rupees, such as 499 or 499.50.'],
    ['399.01', 'Enter ₹1 to ₹399.'],
  ])('refuses %s in the form and sends nothing', async (amount, message) => {
    serve()
    const posts: unknown[] = []
    server.use(
      http.post(`${BASE}/tax-documents/${INVOICE.id}/credit-notes`, async ({ request }) => {
        posts.push(await request.json())
        return ok(CREDIT_NOTE, 'Done.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await submit(user, dialog, amount)
    expect(await within(dialog).findByText(message)).toBeVisible()
    expect(posts).toEqual([])
  })

  it('accepts an amount equal to what is left', async () => {
    serve()
    const posts: unknown[] = []
    server.use(
      http.post(`${BASE}/tax-documents/${INVOICE.id}/credit-notes`, async ({ request }) => {
        posts.push(await request.json())
        return ok(CREDIT_NOTE, 'Done.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    await submit(user, dialog, '399')
    await waitFor(() => expect(posts).toEqual([{ amountMinor: 39_900, reason: 'Chargeback lost' }]))
  })

  it('posts the paise after step-up and toasts the number express answered', async () => {
    serve({ documents: UNCREDITED })
    const bodies: unknown[] = []
    const issued = {
      ...CREDIT_NOTE,
      number: 'CN/26-27/00007',
      amounts: { ...CREDIT_NOTE.amounts, totalMinor: 49_950 },
    }
    server.use(
      http.post(`${BASE}/tax-documents/${INVOICE.id}/credit-notes`, async ({ request }) => {
        bodies.push(await request.json())
        return bodies.length === 1
          ? fail('Recent sign-in required', 401, REAUTH_REQUIRED)
          : ok(issued, 'Done.')
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    expect(dialog).toHaveTextContent('₹999 of ₹999 is left to credit.')
    await submit(user, dialog, '499.50')
    await confirmStepUp(user)
    await waitFor(() =>
      expect(success).toHaveBeenCalledWith('Credit note CN/26-27/00007 issued for ₹499.50.')
    )
    const body = { amountMinor: 49_950, reason: 'Chargeback lost' }
    expect(bodies).toEqual([body, body])
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TITLE })).toBeNull())
  })

  it('shows express’s sentence on a stale amount and reloads the documents', async () => {
    serve()
    let reads = 0
    const sentence = 'Only ₹100 of INV/26-27/00001 is left to credit. Refresh to see it.'
    server.use(
      http.get(`${BASE}/tax-documents`, () => {
        reads += 1
        return ok(listPage(testTaxDocuments), 'Tax documents retrieved.')
      }),
      http.post(`${BASE}/tax-documents/${INVOICE.id}/credit-notes`, () =>
        fail(sentence, 409, 'CREDIT_EXCEEDS_INVOICE')
      )
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    const before = reads
    await submit(user, dialog, '300')
    expect(await within(dialog).findByText(sentence)).toBeVisible()
    await waitFor(() => expect(reads).toBeGreaterThan(before))
    expect(success).not.toHaveBeenCalled()
  })

  it('caps the hint and the amount at ₹1,00,000 on a large invoice', async () => {
    serve({
      documents: testTaxDocuments.map((document) =>
        document.id === INVOICE.id
          ? {
              ...document,
              amounts: { ...document.amounts, totalMinor: 20_000_000 },
              creditedMinor: 0,
            }
          : document
      ),
    })
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    expect(within(dialog).getByText('From ₹1 to ₹1,00,000.')).toBeVisible()
  })

  it('shows express’s sentence on a repeated note and does not reload the documents', async () => {
    serve()
    let reads = 0
    const sentence = 'You issued this credit note a moment ago. Refresh to see it.'
    server.use(
      http.get(`${BASE}/tax-documents`, () => {
        reads += 1
        return ok(listPage(testTaxDocuments), 'Tax documents retrieved.')
      }),
      http.post(`${BASE}/tax-documents/${INVOICE.id}/credit-notes`, () =>
        fail(sentence, 409, 'CREDIT_NOTE_REPEATED')
      )
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const dialog = await openDialog(user)
    const before = reads
    await submit(user, dialog, '300')
    expect(await within(dialog).findByText(sentence)).toBeVisible()
    await settle(300, 'a refetch that must not happen has no event to wait for')
    expect(reads).toBe(before)
  })

  it.each([
    [99, false],
    [100, true],
  ])('with %i paise left, the credit note action shows: %s', async (left, shown) => {
    serve({
      documents: testTaxDocuments.map((document) =>
        document.id === INVOICE.id
          ? { ...document, creditedMinor: document.amounts.totalMinor - left }
          : document
      ),
    })
    renderAppAt(BILLING)
    const row = await rowOf('INV/26-27/00001')
    const menu = within(row).queryByRole('button', { name: 'Actions for INV/26-27/00001' })
    expect(menu !== null).toBe(shown)
  })

  it.each([
    ['a credit note row', 'CN/26-27/00001'],
    ['a fully credited invoice', 'INV/26-27/00002'],
  ])('offers no credit note on %s, only the PDF button', async (_name, number) => {
    serve()
    renderAppAt(BILLING)
    const row = await rowOf(number)
    expect(within(row).getByRole('button', { name: `Download ${number} as a PDF` })).toBeVisible()
    expect(within(row).queryByRole('button', { name: /^Actions for/ })).toBeNull()
  })

  it('offers none to a manager', async () => {
    signIn({ ...testUser, platformRole: 'manager' })
    serve()
    renderAppAt(BILLING)
    const row = await rowOf('INV/26-27/00001')
    expect(
      within(row).getByRole('button', { name: 'Download INV/26-27/00001 as a PDF' })
    ).toBeVisible()
    expect(within(row).queryByRole('button', { name: /^Actions for/ })).toBeNull()
  })

  it('offers none while registration is off, even with documents', async () => {
    serve({ billing: { ...testTenantBilling, hasTaxDocuments: true } })
    renderAppAt(BILLING)
    const row = await rowOf('INV/26-27/00001')
    expect(within(row).queryByRole('button', { name: /^Actions for/ })).toBeNull()
  })
})
