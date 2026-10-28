import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { apiClient } from '@/http/client'
import { ROLE_DENIED_ACTION } from '@/lib/staff-message'
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
import { fail, ok, testUser } from '@/tests/mocks/handlers'
import { server } from '@/tests/mocks/server'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { StaffInvoiceItem, StaffTenantBilling } from '@/types/billing.types'

const BILLING = `/tenants/${TENANT_ID}/billing`
const BASE = `/api/v1/platform/tenants/${TENANT_ID}/billing`
const INVOICE = testTaxDocuments[0]!
const MANUAL_NOTE = testTaxDocuments[2]!

/** A registered workspace: registration on, documents issued. */
const REGISTERED: StaffTenantBilling = {
  ...testTenantBilling,
  taxDocumentsEnabled: true,
  hasTaxDocuments: true,
}

/**
 * Acme's platform detail, in the given time zone.
 * @param timezone - The tenant's `settings.timezone`.
 */
function detail(timezone = 'UTC'): PlatformTenantDetail {
  return {
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
    settings: { timezone, locale: 'en' },
    memberCount: 2,
    owners: [],
    pendingInvitationCount: 0,
    pendingOwnerInvitation: null,
  }
}

/**
 * Serves Acme's detail, its billing view, and the tax documents and invoices lists.
 * @param options.billing - The billing view.
 * @param options.documents - The tax document rows.
 * @param options.invoices - The invoice rows.
 * @param options.timezone - The tenant's zone.
 */
function serve({
  billing = REGISTERED,
  documents = testTaxDocuments,
  invoices = testInvoices,
  timezone = 'UTC',
}: {
  billing?: StaffTenantBilling
  documents?: typeof testTaxDocuments
  invoices?: StaffInvoiceItem[]
  timezone?: string
} = {}) {
  server.use(
    http.get(`/api/v1/platform/tenants/${TENANT_ID}`, () => ok(detail(timezone), 'Tenant')),
    http.get(BASE, () => ok(billing, 'Billing retrieved.')),
    http.get(`${BASE}/tax-details`, () => ok(testTaxDetails, 'Tax details retrieved.')),
    http.get(`${BASE}/tax-documents`, () => ok(listPage(documents), 'Tax documents retrieved.')),
    http.get(`${BASE}/invoices`, () => ok(listPage(invoices), 'Invoices retrieved.'))
  )
}

/** The Tax documents card's table. */
const taxTable = () => screen.findByRole('table', { name: 'Tax documents' })

/**
 * One data row of a table, found by its number.
 * @param table - The table.
 * @param number - The document number.
 */
function rowOf(table: HTMLElement, number: string): HTMLElement {
  return within(table).getByText(number, { selector: 'code' }).closest('tr') as HTMLElement
}

describe('the Tax documents card', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows no card, no column and asks for nothing while registration is off and there are no documents', async () => {
    const asked: string[] = []
    serve({ billing: testTenantBilling })
    server.use(
      http.get(`${BASE}/tax-documents`, ({ request }) => {
        asked.push(request.url)
        return fail('unexpected', 500)
      })
    )
    renderAppAt(BILLING)
    const invoices = await screen.findByRole('table', { name: 'Invoices' })
    expect(screen.queryByRole('heading', { name: 'Tax documents' })).toBeNull()
    expect(within(invoices).queryByRole('columnheader', { name: 'Tax documents' })).toBeNull()
    expect(asked).toEqual([])
  })

  it('lists each document with its type, IST date, total, tax split, buyer and link', async () => {
    serve()
    renderAppAt(BILLING)
    expect(await screen.findByRole('heading', { name: 'Tax documents', level: 2 })).toBeVisible()
    expect(
      screen.getByText(
        'Tax invoices and credit notes, newest first. Dates are in India Standard Time (IST), as printed on each document.'
      )
    ).toBeVisible()
    const table = await taxTable()
    const invoice = within(rowOf(table, 'INV/26-27/00001'))
    expect(invoice.getByText('Tax invoice')).toBeVisible()
    expect(invoice.getByText('20 October 2026')).toBeVisible()
    expect(invoice.getByText('₹999')).toBeVisible()
    expect(invoice.getByText('CGST ₹76.19 + SGST ₹76.20')).toBeVisible()
    expect(invoice.getByText('29ABCDE1234F1ZW')).toBeVisible()
    expect(invoice.getByText(/₹600 of ₹999 credited/)).toHaveTextContent(
      'CN/26-27/00001, CN/26-27/00002'
    )
    const interstate = within(rowOf(table, 'INV/26-27/00002'))
    expect(interstate.getByText('IGST ₹152.39')).toBeVisible()
    expect(interstate.getByText('None (B2C)')).toBeVisible()
    const note = within(rowOf(table, 'CN/26-27/00001'))
    expect(note.getByText('Credit note')).toBeVisible()
    expect(note.getByText('Reduces INV/26-27/00001')).toBeVisible()
    expect(note.queryByText('Manual')).toBeNull()
  })

  it('says Not credited for an invoice with no credit notes', async () => {
    serve({ documents: [{ ...INVOICE, creditNotes: [], creditedMinor: 0 }] })
    renderAppAt(BILLING)
    expect(await within(await taxTable()).findByText('Not credited')).toBeVisible()
  })

  it('marks a manual credit note and keeps its author and reason in Pii', async () => {
    serve({
      documents: [
        MANUAL_NOTE,
        { ...MANUAL_NOTE, id: 'x', number: 'CN/26-27/00009', createdBy: null },
      ],
    })
    renderAppAt(BILLING)
    const table = await taxTable()
    const manual = within(rowOf(table, 'CN/26-27/00002'))
    expect(manual.getByText('Manual')).toBeVisible()
    expect(manual.getByText('Cleo D')).toHaveClass('ph-sensitive')
    expect(manual.getByText('Chargeback lost on 20 Oct 2026')).toHaveClass('ph-sensitive')
    expect(manual.getByText(/Reduces INV\/26-27\/00001/)).toHaveTextContent(
      'Reduces INV/26-27/00001 by Cleo D: “Chargeback lost on 20 Oct 2026”'
    )
    expect(within(rowOf(table, 'CN/26-27/00009')).getByText(/by a deleted account/)).toBeVisible()
  })

  it('wraps a buyer GSTIN in Pii', async () => {
    serve()
    renderAppAt(BILLING)
    const table = await taxTable()
    expect(within(rowOf(table, 'INV/26-27/00001')).getByText('29ABCDE1234F1ZW')).toHaveClass(
      'ph-sensitive'
    )
  })

  it('flags a credit note that cuts no tax', async () => {
    serve({
      documents: [{ ...testTaxDocuments[1]!, noTaxReduction: true }],
    })
    renderAppAt(BILLING)
    expect(await within(await taxTable()).findByText('No tax reduction')).toBeVisible()
  })

  it('dates a document in IST for a tenant in Los Angeles', async () => {
    serve({
      timezone: 'America/Los_Angeles',
      documents: [{ ...INVOICE, issuedAt: '2026-10-31T20:00:00.000Z' }],
    })
    renderAppAt(BILLING)
    const table = await taxTable()
    expect(within(table).getByText('1 November 2026')).toBeVisible()
    expect(within(table).queryByText('31 October 2026')).toBeNull()
  })

  it('names the empty list and the next step', async () => {
    serve({ documents: [] })
    renderAppAt(BILLING)
    expect(await screen.findByText('No tax documents yet.')).toBeVisible()
    expect(
      screen.getByText(
        'We issue a tax invoice for each charge paid on or after the GST start date set on the API.'
      )
    ).toBeVisible()
  })

  it('searches by number and filters by type', async () => {
    const seen: URLSearchParams[] = []
    serve()
    server.use(
      http.get(`${BASE}/tax-documents`, ({ request }) => {
        seen.push(new URL(request.url).searchParams)
        return ok(listPage(testTaxDocuments), 'ok')
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    await taxTable()
    await user.type(screen.getByRole('searchbox', { name: 'Search tax documents' }), 'CN/26')
    await waitFor(() => expect(seen.at(-1)?.get('search')).toBe('CN/26'))
    await user.click(screen.getByRole('button', { name: 'Filter by type, Tax documents' }))
    const popup = await screen.findByRole('dialog', { name: 'Filter by type, Tax documents' })
    await user.click(within(popup).getByRole('checkbox', { name: 'Credit note' }))
    await waitFor(() => expect(seen.at(-1)?.get('type')).toBe('credit_note'))
  })

  it('shows express’s sentence in a note, not a refusal, when registration turned off', async () => {
    serve()
    server.use(
      http.get(`${BASE}/tax-documents`, () =>
        fail(
          'Tax documents are off, and this workspace has none to download.',
          404,
          'tax_documents_disabled'
        )
      )
    )
    renderAppAt(BILLING)
    expect(
      await screen.findByText('Tax documents are off, and this workspace has none to download.')
    ).toBeVisible()
    expect(screen.queryByText(/Your role can’t see this any more/)).toBeNull()
    expect(screen.getByRole('heading', { name: 'Tax documents', level: 2 })).toBeVisible()
  })

  it('shows RoleDenied, not the registration note, for a role-gate 404 on the list', async () => {
    serve()
    server.use(http.get(`${BASE}/tax-documents`, () => fail('Route not found', 404, 'not_found')))
    renderAppAt(BILLING)
    expect(await screen.findByText('Your role can’t see this any more.')).toBeVisible()
    expect(screen.queryByText(/Tax documents are off/)).toBeNull()
  })

  it('offers Try again when the list fails to load', async () => {
    serve()
    server.use(http.get(`${BASE}/tax-documents`, () => fail('Boom', 500)))
    renderAppAt(BILLING)
    expect(
      await screen.findByText('We couldn’t load this tenant’s tax documents. Select Try again.')
    ).toBeVisible()
  })
})

describe('a tax document PDF', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
    for (const name of ['createObjectURL', 'revokeObjectURL']) {
      if (!(name in URL)) {
        Object.defineProperty(URL, name, { value: () => '', configurable: true, writable: true })
      }
    }
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:probe')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('downloads by id as a blob when a viewer clicks PDF, and not before', async () => {
    const asked: string[] = []
    serve()
    server.use(
      http.get(`${BASE}/tax-documents/${INVOICE.id}/pdf`, ({ request }) => {
        asked.push(request.url)
        return new HttpResponse('%PDF-1.4', {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'attachment; filename="INV-26-27-00001.pdf"',
          },
        })
      })
    )
    const get = vi.spyOn(apiClient, 'get')
    const user = userEvent.setup()
    renderAppAt(BILLING)
    await taxTable()
    expect(asked).toEqual([])
    await user.click(
      within(rowOf(await taxTable(), 'INV/26-27/00001')).getByRole('button', {
        name: 'Download INV/26-27/00001 as a PDF',
      })
    )
    await waitFor(() => expect(asked).toHaveLength(1))
    expect(get).toHaveBeenCalledWith(
      `/platform/tenants/${TENANT_ID}/billing/tax-documents/${INVOICE.id}/pdf`,
      expect.objectContaining({ responseType: 'blob' })
    )
  })

  it('toasts express’s message for a blob 404 and keeps the card', async () => {
    const error = vi.spyOn(toast, 'error')
    serve()
    server.use(
      http.get(`${BASE}/tax-documents/${INVOICE.id}/pdf`, () =>
        fail('That tax document no longer exists.', 404, 'tax_document_not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const table = await taxTable()
    await user.click(
      within(rowOf(table, 'INV/26-27/00001')).getByRole('button', {
        name: 'Download INV/26-27/00001 as a PDF',
      })
    )
    await waitFor(() => expect(error).toHaveBeenCalledWith('That tax document no longer exists.'))
    expect(screen.getByRole('table', { name: 'Tax documents' })).toBeVisible()
    expect(screen.queryByText(/Your role can’t see this any more/)).toBeNull()
  })

  it('toasts the staff copy for a role-gate 404 on the PDF', async () => {
    const error = vi.spyOn(toast, 'error')
    serve()
    server.use(
      http.get(`${BASE}/tax-documents/${INVOICE.id}/pdf`, () =>
        fail('Route not found', 404, 'not_found')
      )
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const table = await taxTable()
    await user.click(
      within(rowOf(table, 'INV/26-27/00001')).getByRole('button', {
        name: 'Download INV/26-27/00001 as a PDF',
      })
    )
    await waitFor(() => expect(error).toHaveBeenCalledWith(ROLE_DENIED_ACTION))
  })

  it('ignores a second click while the file loads', async () => {
    serve()
    let asked = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>(
      /** Hands the test the way to let the PDF answer. */
      (resolve) => {
        release = resolve
      }
    )
    server.use(
      http.get(`${BASE}/tax-documents/${INVOICE.id}/pdf`, async () => {
        asked += 1
        await gate
        return new HttpResponse('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const table = await taxTable()
    const button = within(rowOf(table, 'INV/26-27/00001')).getByRole('button', {
      name: 'Download INV/26-27/00001 as a PDF',
    })
    await user.click(button)
    await waitFor(() => expect(button).toHaveTextContent('Downloading…'))
    await user.click(button)
    release?.()
    await waitFor(() => expect(button).toHaveTextContent('PDF'))
    expect(asked).toBe(1)
  })

  it('keeps the button focusable and says Downloading… while the file loads', async () => {
    serve()
    let release: (() => void) | undefined
    const gate = new Promise<void>(
      /** Hands the test the way to let the PDF answer. */
      (resolve) => {
        release = resolve
      }
    )
    server.use(
      http.get(`${BASE}/tax-documents/${INVOICE.id}/pdf`, async () => {
        await gate
        return new HttpResponse('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } })
      })
    )
    const user = userEvent.setup()
    renderAppAt(BILLING)
    const table = await taxTable()
    const button = within(rowOf(table, 'INV/26-27/00001')).getByRole('button', {
      name: 'Download INV/26-27/00001 as a PDF',
    })
    await user.click(button)
    await waitFor(() => expect(button).toHaveTextContent('Downloading…'))
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).not.toBeDisabled()
    release?.()
    await waitFor(() => expect(button).toHaveTextContent('PDF'))
  })
})

describe('the invoices card’s Tax documents column', () => {
  beforeEach(() => {
    signIn({ ...testUser, platformRole: 'viewer' })
  })

  /**
   * Serves one invoice row of each kind.
   * @param rows - Per invoice, what its tax fields say.
   */
  function serveRows(rows: Array<Partial<StaffInvoiceItem>>) {
    serve({
      invoices: rows.map((row, index) => ({ ...testInvoices[0]!, id: `inv_${index}`, ...row })),
    })
  }

  it('links the tax invoice and each credit note by number', async () => {
    serveRows([
      {
        taxStatus: 'issued',
        taxDocument: { id: INVOICE.id, number: 'INV/26-27/00001' },
        creditNotes: [{ id: testTaxDocuments[1]!.id, number: 'CN/26-27/00001' }],
      },
    ])
    renderAppAt(BILLING)
    const invoices = await screen.findByRole('table', { name: 'Invoices' })
    expect(
      await within(invoices).findByRole('columnheader', { name: 'Tax documents' })
    ).toBeVisible()
    expect(
      within(invoices).getByRole('button', { name: 'Download INV/26-27/00001 as a PDF' })
    ).toHaveTextContent('INV/26-27/00001')
    expect(
      within(invoices).getByRole('button', { name: 'Download CN/26-27/00001 as a PDF' })
    ).toHaveTextContent('CN/26-27/00001')
  })

  it('says what a row without a document is waiting for', async () => {
    serveRows([{ taxStatus: 'held' }, { taxStatus: 'pending' }, { taxStatus: 'not_applicable' }])
    renderAppAt(BILLING)
    const invoices = await screen.findByRole('table', { name: 'Invoices' })
    const rows = (await within(invoices).findAllByRole('row')).slice(1)
    expect(rows).toHaveLength(3)
    /** The row's last cell. */
    const last = (row: HTMLElement) => within(row).getAllByRole('cell').at(-1)!
    expect(last(rows[0]!)).toHaveTextContent('Held: SEZ')
    expect(last(rows[1]!)).toHaveTextContent('Tax invoice on its way')
    expect(last(rows[2]!)).toHaveTextContent('—')
  })
})
