/**
 * @file The harness's GST tax documents: the `?tax=` state, the billing
 * view's and settings' tax fields, the invoice rows' tax column, and the
 * staff tax routes with the writes they keep for the page load.
 * `harness.tsx` lays the fields over its own fixtures and spreads
 * `createTaxHarness(…).handlers` into its worker.
 */
import { http } from 'msw'
import { billingDate } from '@/constants/billing-labels'
import { formatInr } from '@/lib/billing-format'
import { stateOf } from '@/lib/gst'
import { IST } from '@/lib/tax-format'
import { reasonSchema } from '@/schemas/reason.schemas'
import {
  LEGAL_NAME_REQUIRED_MESSAGE,
  normaliseQuotes,
  STATE_REQUIRED_MESSAGE,
  TAX_DETAILS_UNCHANGED_MESSAGE,
  TAX_TEXT_PATTERN,
  taxDetailsFieldsSchema,
  taxDetailsRuleIssues,
  TEXT_PATTERN_MESSAGE,
  valuesFrom,
  type TaxDetailsValues,
} from '@/schemas/tax-details.schemas'
import type {
  BillingAlert,
  StaffInvoiceItem,
  StaffTaxDetails,
  StaffTaxDocumentItem,
  StaffTenantBilling,
  TaxHeldCharge,
} from '@/types/billing.types'
import {
  testHeldCharges,
  testHeldRefundAlert,
  testHeldSezAlert,
  testInvoices,
  testTaxDetails,
  testTaxDocuments,
} from '../../tests/fixtures/billing'
import { PLATFORM_TENANT_ID, USER_ID } from '../../tests/fixtures/ids'

/** The tenant the tax details success message names. */
const ACME = { name: 'Acme Corp' }

/**
 * `?tax=` sets up GST tax documents for every customer tenant and the platform:
 * - `off` (the default): registration off and no documents anywhere, so no tax
 *   card, column or request shows, and every tax route answers 404
 *   `tax_documents_disabled`;
 * - `on`: registration on; Acme Corp's tax details, its four documents and one
 *   held charge that staff resolved; one invoice row links its documents and
 *   one is waiting for its tax invoice;
 * - `b2c`: as `on`, with no GSTIN and no address (a business-to-consumer buyer);
 * - `sez`: as `on`, for an SEZ unit with one open held charge, an invoice row
 *   held for it, and its hold and refund alerts first in the alerts list;
 * - `docs-off`: registration turned off after documents were issued, so reads
 *   answer and the writes answer 404 `tax_documents_disabled`.
 */
const taxState =
  (['on', 'b2c', 'sez', 'docs-off'] as const).find(
    (state) => state === new URLSearchParams(location.search).get('tax')
  ) ?? ('off' as const)

/** Whether this server issues tax documents now. */
export const taxEnabled = taxState === 'on' || taxState === 'b2c' || taxState === 'sez'

/** Whether any tax document exists, on the platform and on each customer tenant. */
export const taxDocumentsExist = taxState !== 'off'

/**
 * Under `?tax=sez`, Acme Corp's two `tax_held_sez` alerts, newer than every
 * other alert so the list opens on them: the open hold, then the refund of a
 * held charge's payment. Both link to its Held SEZ charges card.
 */
export const SEZ_ALERTS: BillingAlert[] =
  taxState === 'sez'
    ? [
        {
          ...testHeldSezAlert,
          id: '94000000-0000-4000-8000-000000000011',
          at: '2026-10-27T09:00:05.000Z',
        },
        {
          ...testHeldRefundAlert,
          id: '94000000-0000-4000-8000-000000000012',
          at: '2026-10-27T08:00:00.000Z',
        },
      ]
    : []

/**
 * The `?billing=` view with the `?tax=` state's three tax fields laid over it.
 * @param view - The view `?billing=` picked, or null for none.
 */
export function withTaxState(view: StaffTenantBilling | null): StaffTenantBilling | null {
  if (view === null) return null
  return {
    ...view,
    taxDocumentsEnabled: taxEnabled,
    hasTaxDocuments: taxDocumentsExist,
    openHeldCharges: taxState === 'sez' ? 1 : 0,
  }
}

/** A list handler's options, as the harness's `serveList` takes them. */
interface TaxServeOptions<T> {
  /** The row text `search` matches. */
  searchIn?: (row: T) => string[]
  /** One predicate per filter param, given the comma list's values. */
  filters?: Record<string, (row: T, values: string[]) => boolean>
  /** The sort keys the handler orders by. */
  sorts?: Record<string, (a: T, b: T) => number>
}

/** What the tax routes take from the harness: its envelopes, its list pager, the billing view and the step-up check. */
export interface TaxHarnessDeps {
  /** The API's success envelope. */
  ok: <T>(data: T, message?: string, statusCode?: number) => Response
  /** An express error envelope. */
  fail: (
    message: string,
    statusCode: number,
    code?: string,
    headers?: HeadersInit,
    extra?: Record<string, unknown>
  ) => Response
  /** One page of a list, as express answers it. */
  serveList: <T>(rows: T[], params: URLSearchParams, options?: TaxServeOptions<T>) => unknown
  /** Every customer tenant's billing view, which a resolve updates. */
  billing: { view: StaffTenantBilling | null }
  /** Under `?stepup=once`, the step-up refusal for a write; else null. */
  billingStepUpRefusal: (request: Request) => Response | null
}

/**
 * The tax state for one page load, and the routes that read and change it.
 * @param deps - What the routes take from the harness.
 * @returns The handlers to spread into the worker, and the invoice rows' builder.
 */
export function createTaxHarness(deps: TaxHarnessDeps) {
  const { ok, fail, serveList, billing, billingStepUpRefusal } = deps
  /** express's 404 sentences for `tax_documents_disabled`: a read, a write, and the export. */
  const TAX_OFF = {
    read: 'Tax documents are off, and this workspace has none to download.',
    write:
      "Tax documents are off, so tax details and credit notes can't change. Issued documents stay available to download.",
    export: 'Tax documents are off, and no workspace has any, so there is nothing to export.',
  }

  /** The tax details every customer tenant reads under `?tax=`, before a correction. */
  function initialTaxDetails(): StaffTaxDetails {
    switch (taxState) {
      case 'b2c':
        return {
          ...testTaxDetails,
          gstin: null,
          addressLine1: null,
          addressLine2: null,
          city: null,
          pincode: null,
        }
      case 'sez':
        return { ...testTaxDetails, isSez: true }
      default:
        return testTaxDetails
    }
  }

  /**
   * The tax state as staff writes leave it in this page load: the details, the
   * documents (a credit note appends), the held charges (a resolve sets its
   * date), and the manual credit notes already issued, for the repeat check.
   */
  const tax = {
    details: initialTaxDetails() as StaffTaxDetails | null,
    documents: [...testTaxDocuments],
    held: testHeldCharges.filter((charge) => taxState === 'sez' || charge.resolvedAt !== null),
    issued: new Map<string, StaffTaxDocumentItem>(),
  }

  /**
   * The 404 a tax route answers for the platform tenant, or with nothing to
   * read; null when it answers.
   * @param tenantId - The `:tenantId` the route was called with.
   */
  function taxReadRefusal(tenantId: unknown) {
    if (tenantId === PLATFORM_TENANT_ID) {
      return fail('This tenant has no billing.', 404, 'tenant_billing_not_found')
    }
    return taxDocumentsExist ? null : fail(TAX_OFF.read, 404, 'tax_documents_disabled')
  }

  /**
   * The 404 a tax details or credit note write answers while registration is
   * off; null while it is on.
   * @param tenantId - The `:tenantId` the route was called with.
   */
  function taxWriteRefusal(tenantId: unknown) {
    if (tenantId === PLATFORM_TENANT_ID) {
      return fail('This tenant has no billing.', 404, 'tenant_billing_not_found')
    }
    return taxEnabled ? null : fail(TAX_OFF.write, 404, 'tax_documents_disabled')
  }

  /**
   * express's 400 for field errors, in the house validation envelope.
   * @param errors - Each field's messages.
   */
  function validationFailure(errors: Record<string, string[]>) {
    return fail('Validation failed.', 400, 'VALIDATION_ERROR', undefined, { errors })
  }

  /** The tax details fields express takes, and the ones a `null` clears. */
  const TAX_FIELDS = Object.keys(taxDetailsFieldsSchema.shape) as Array<keyof TaxDetailsValues>
  const NULLABLE_TAX_FIELDS = new Set(['gstin', 'addressLine1', 'addressLine2', 'city', 'pincode'])

  /** The row a first save merges onto: nothing set. */
  const EMPTY_TAX_VALUES: TaxDetailsValues = {
    gstin: null,
    legalName: '',
    addressLine1: null,
    addressLine2: null,
    city: null,
    pincode: null,
    stateCode: '',
    isSez: false,
  }

  /**
   * The staff tax details `PATCH` as express runs it: a stale `version` is a
   * 409; each sent field is checked on its own (a `null` clears a nullable
   * one); a first save needs the legal name and state; a body that changes
   * nothing is a 400; the cross-field rules run on the merged row for the
   * fields sent; then the row is stored at the next version.
   * @param body - The request body.
   */
  function saveTaxDetails(body: Record<string, unknown>) {
    const stored = tax.details
    if (body.version !== (stored === null ? null : stored.version)) {
      return fail(
        'Someone changed these tax details since you opened them. Reload to see them, then save again.',
        409,
        'TAX_DETAILS_VERSION_CONFLICT'
      )
    }
    const unknown = Object.keys(body).filter(
      (key) => key !== 'version' && key !== 'reason' && !TAX_FIELDS.includes(key as never)
    )
    if (unknown.length > 0) return validationFailure({ [unknown[0]!]: ['Unrecognized key.'] })
    const errors: Record<string, string[]> = {}
    const reason = reasonSchema.safeParse(body.reason)
    if (!reason.success) errors.reason = [reason.error.issues[0]?.message ?? 'Enter a reason.']
    const sent = TAX_FIELDS.filter((field) => field in body)
    const values: Partial<Record<keyof TaxDetailsValues, unknown>> = {}
    for (const field of sent) {
      const raw = body[field]
      if (raw === null && NULLABLE_TAX_FIELDS.has(field)) {
        values[field] = null
        continue
      }
      const parsed = taxDetailsFieldsSchema.shape[field].safeParse(raw)
      if (parsed.success) values[field] = parsed.data
      else errors[field] = [parsed.error.issues[0]?.message ?? 'Invalid value.']
    }
    if (stored === null) {
      if (!sent.includes('legalName')) errors.legalName ??= [LEGAL_NAME_REQUIRED_MESSAGE]
      if (!sent.includes('stateCode')) errors.stateCode ??= [STATE_REQUIRED_MESSAGE]
    }
    if (Object.keys(errors).length > 0) return validationFailure(errors)
    const base = stored === null ? EMPTY_TAX_VALUES : valuesFrom(stored)
    const merged = { ...base, ...values } as TaxDetailsValues
    if (sent.every((field) => Object.is(merged[field], base[field])) && stored !== null) {
      return validationFailure({ formErrors: [TAX_DETAILS_UNCHANGED_MESSAGE] })
    }
    const issues = taxDetailsRuleIssues(merged, new Set(sent))
    if (issues.length > 0) {
      return validationFailure(
        Object.fromEntries(issues.map(({ path, message }) => [path, [message]]))
      )
    }
    const saved: StaffTaxDetails = {
      gstin: merged.gstin,
      legalName: merged.legalName,
      addressLine1: merged.addressLine1,
      addressLine2: merged.addressLine2,
      city: merged.city,
      pincode: merged.pincode,
      state: { code: merged.stateCode, name: stateOf(merged.stateCode)?.name ?? merged.stateCode },
      isSez: merged.isSez,
      version: stored === null ? 1 : stored.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: { userId: USER_ID, name: 'A B' },
    }
    tax.details = saved
    return ok(
      saved,
      `Tax details for ${ACME.name} saved. They apply to invoices issued from now on.`
    )
  }

  /**
   * express's cumulative credit note split: the figures of a note that takes
   * the invoice's credited total from `before` to `after`, so its notes always
   * add up to the invoice.
   * @param invoice - The invoice.
   * @param before - The total credited before this note, in paise.
   * @param after - The total credited with it, in paise.
   */
  function creditAmounts(invoice: StaffTaxDocumentItem, before: number, after: number) {
    const { totalMinor, taxableMinor, ratePercent } = invoice.amounts
    /** The invoice's taxable value credited by `credited`, rounded half up. */
    const taxable = (credited: number) =>
      Math.floor((2 * taxableMinor * credited + totalMinor) / (2 * totalMinor))
    /** The tax credited by `credited`. */
    const taxOf = (credited: number) => credited - taxable(credited)
    /** The CGST half of the tax credited by `credited`. */
    const cgst = (credited: number) => Math.floor(taxOf(credited) / 2)
    const intra = invoice.supply === 'intra'
    return {
      totalMinor: after - before,
      taxableMinor: taxable(after) - taxable(before),
      cgstMinor: intra ? cgst(after) - cgst(before) : 0,
      sgstMinor: intra ? taxOf(after) - cgst(after) - (taxOf(before) - cgst(before)) : 0,
      igstMinor: intra ? 0 : taxOf(after) - taxOf(before),
      ratePercent,
    }
  }

  /** The IST clock time of an instant, `HH:mm`, as express's repeat refusal prints it. */
  const IST_TIME = new Intl.DateTimeFormat('en-GB', {
    timeZone: IST,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  /**
   * The manual credit note as express runs it: an invoice only, a whole number
   * of paise from ₹1 to ₹1,00,000 and no more than is left to credit, one line
   * of printable Latin text as the reason, and a 409 for the same note repeated.
   * The note is numbered after the last one and raises the invoice's credited total.
   * @param docId - The invoice's id.
   * @param body - The request body.
   */
  function issueCreditNote(docId: unknown, body: { amountMinor?: unknown; reason?: unknown }) {
    const invoice = tax.documents.find((document) => document.id === docId)
    if (invoice === undefined) {
      return fail(
        'This workspace has no tax document with that ID. Reload the page to see its documents.',
        404,
        'tax_document_not_found'
      )
    }
    if (invoice.type !== 'invoice') {
      return fail(
        'Credit notes reduce invoices only. Pick the invoice instead.',
        409,
        'NOT_AN_INVOICE'
      )
    }
    const errors: Record<string, string[]> = {}
    const { amountMinor } = body
    if (
      typeof amountMinor !== 'number' ||
      !Number.isInteger(amountMinor) ||
      amountMinor < 100 ||
      amountMinor > 10_000_000
    ) {
      errors.amountMinor = ['Enter a credit from ₹1 to ₹1,00,000.']
    }
    const reason = normaliseQuotes(typeof body.reason === 'string' ? body.reason.trim() : '')
    const reasonCheck = reasonSchema.safeParse(reason)
    if (!reasonCheck.success) {
      errors.reason = [reasonCheck.error.issues[0]?.message ?? 'Enter a reason.']
    } else if (/[\r\n]/.test(reason)) {
      errors.reason = ['Use one line for the reason.']
    } else if (!TAX_TEXT_PATTERN.test(reason)) {
      errors.reason = [TEXT_PATTERN_MESSAGE]
    }
    if (Object.keys(errors).length > 0 || typeof amountMinor !== 'number') {
      return validationFailure(errors)
    }
    const repeatKey = `${invoice.id}|${amountMinor}|${reason}`
    const repeated = tax.issued.get(repeatKey)
    if (repeated !== undefined) {
      return fail(
        `Credit note ${repeated.number} for this amount and reason was issued at ${IST_TIME.format(new Date(repeated.issuedAt))} IST. Nothing changed.`,
        409,
        'CREDIT_NOTE_REPEATED'
      )
    }
    const remaining = invoice.amounts.totalMinor - invoice.creditedMinor
    if (amountMinor > remaining) {
      return fail(
        `This invoice has ${formatInr(remaining)} left to credit. Enter ${formatInr(remaining)} or less.`,
        409,
        'CREDIT_EXCEEDS_INVOICE',
        undefined,
        { details: { remainingMinor: remaining } }
      )
    }
    const count = tax.documents.filter((document) => document.type === 'credit_note').length
    const note: StaffTaxDocumentItem = {
      ...invoice,
      id: `96000000-0000-4000-8000-${String(tax.documents.length + 1).padStart(12, '0')}`,
      type: 'credit_note',
      number: `CN/26-27/${String(count + 1).padStart(5, '0')}`,
      issuedAt: new Date().toISOString(),
      amounts: creditAmounts(invoice, invoice.creditedMinor, invoice.creditedMinor + amountMinor),
      invoice: { id: invoice.id, number: invoice.number },
      creditNotes: [],
      creditedMinor: 0,
      noTaxReduction: false,
      reason,
      paymentId: null,
      refundId: null,
      manual: true,
      createdBy: { userId: USER_ID, name: 'A B' },
    }
    tax.documents = [
      ...tax.documents.map((document) =>
        document.id === invoice.id
          ? {
              ...document,
              creditNotes: [...document.creditNotes, { id: note.id, number: note.number }],
              creditedMinor: document.creditedMinor + amountMinor,
            }
          : document
      ),
      note,
    ]
    tax.issued.set(repeatKey, note)
    return ok(note, `Credit note ${note.number} issued for ${formatInr(amountMinor)}.`, 201)
  }

  /**
   * Marks a held charge resolved with the staff note, as express does; a
   * second resolve is a 409 naming the day of the first, in IST.
   * @param heldId - The held charge's id.
   * @param body - The request body.
   */
  function resolveHeldCharge(heldId: unknown, body: { reason?: unknown }) {
    const charge = tax.held.find((candidate) => candidate.id === heldId)
    if (charge === undefined) {
      return fail(
        'This workspace has no held charge with that ID. Reload the page to see its held charges.',
        404,
        'tax_held_charge_not_found'
      )
    }
    if (charge.resolvedAt !== null) {
      return fail(
        `This held charge was resolved on ${billingDate(charge.resolvedAt, IST)}. Nothing changed.`,
        409,
        'HELD_CHARGE_RESOLVED'
      )
    }
    const reason = reasonSchema.safeParse(body.reason)
    if (!reason.success) {
      return validationFailure({ reason: [reason.error.issues[0]?.message ?? 'Enter a reason.'] })
    }
    const resolved: TaxHeldCharge = {
      ...charge,
      resolvedAt: new Date().toISOString(),
      resolvedBy: { userId: USER_ID, name: 'A B' },
      resolution: reason.data,
    }
    tax.held = tax.held.map((candidate) => (candidate.id === charge.id ? resolved : candidate))
    if (billing.view !== null) {
      billing.view = {
        ...billing.view,
        openHeldCharges: Math.max(0, billing.view.openHeldCharges - 1),
      }
    }
    return ok(resolved, 'Held charge marked resolved.')
  }

  /**
   * The invoices list's rows under `?tax=`, newest first: with tax off, the one
   * paid invoice as before. Otherwise that invoice links its tax invoice and
   * credit notes, a later paid one waits for its tax invoice (or, with
   * registration off, has none to wait for), and under `sez` one is held.
   */
  function invoiceRows(): StaffInvoiceItem[] {
    const paid = testInvoices[0]!
    if (taxState === 'off') return testInvoices
    const taxInvoice = tax.documents.find((document) => document.number === 'INV/26-27/00001')!
    const later: StaffInvoiceItem = {
      ...paid,
      id: 'inv_TestPaid0002',
      issuedAt: '2026-10-27T09:00:00.000Z',
      paidAt: '2026-10-27T09:00:01.000Z',
      taxStatus: taxEnabled ? 'pending' : 'not_applicable',
    }
    const held: StaffInvoiceItem = {
      ...paid,
      id: 'inv_TestHeld0002',
      issuedAt: '2026-10-24T09:00:00.000Z',
      paidAt: '2026-10-24T09:00:00.000Z',
      taxStatus: 'held',
    }
    const linked: StaffInvoiceItem = {
      ...paid,
      taxDocument: { id: taxInvoice.id, number: taxInvoice.number },
      creditNotes: taxInvoice.creditNotes,
      taxStatus: 'issued',
    }
    return taxState === 'sez' ? [later, held, linked] : [later, linked]
  }

  /**
   * The bytes of a ZIP that holds one empty file, `empty.csv`: the stored
   * entry's local header, the central directory and its end record.
   */
  function emptyZip(): Uint8Array<ArrayBuffer> {
    const name = new TextEncoder().encode('empty.csv')
    const bytes = new Uint8Array(30 + name.length + 46 + name.length + 22)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 10, true)
    view.setUint16(26, name.length, true)
    bytes.set(name, 30)
    const central = 30 + name.length
    view.setUint32(central, 0x02014b50, true)
    view.setUint16(central + 4, 20, true)
    view.setUint16(central + 6, 10, true)
    view.setUint16(central + 28, name.length, true)
    bytes.set(name, central + 46)
    const end = central + 46 + name.length
    view.setUint32(end, 0x06054b50, true)
    view.setUint16(end + 8, 1, true)
    view.setUint16(end + 10, 1, true)
    view.setUint32(end + 12, 46 + name.length, true)
    view.setUint32(end + 16, central, true)
    return bytes
  }

  /**
   * A file download as express answers one: the bytes, their type, and an
   * attachment named `filename`, never cached.
   * @param body - The bytes.
   * @param type - The media type.
   * @param filename - The name the browser saves it under.
   */
  function fileResponse(body: BodyInit, type: string, filename: string) {
    return new Response(body, {
      headers: {
        'Content-Type': type,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  }

  /** The staff tax routes, as `?tax=` sets them up; each write holds for a step-up under `?stepup=once`. */
  const handlers = [
    http.get('/api/v1/platform/tenants/:tenantId/billing/tax-details', ({ params }) => {
      const refusal = taxReadRefusal(params.tenantId)
      if (refusal) return refusal
      return ok(tax.details, 'Tax details retrieved.')
    }),
    http.patch(
      '/api/v1/platform/tenants/:tenantId/billing/tax-details',
      async ({ params, request }) => {
        const refusal = billingStepUpRefusal(request) ?? taxWriteRefusal(params.tenantId)
        if (refusal) return refusal
        return saveTaxDetails((await request.json()) as Record<string, unknown>)
      }
    ),
    // Newest issued first unless `sort` says otherwise, as express defaults; search matches the number.
    http.get('/api/v1/platform/tenants/:tenantId/billing/tax-documents', ({ params, request }) => {
      const refusal = taxReadRefusal(params.tenantId)
      if (refusal) return refusal
      const query = new URLSearchParams(new URL(request.url).searchParams)
      if (!query.has('sort')) query.set('sort', '-issued')
      return ok(
        serveList(tax.documents, query, {
          searchIn: (row) => [row.number],
          filters: { type: (row, values) => values.includes(row.type) },
          sorts: {
            issued: (a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.id.localeCompare(b.id),
          },
        }),
        'Tax documents retrieved.'
      )
    }),
    http.get(
      '/api/v1/platform/tenants/:tenantId/billing/tax-documents/:docId/pdf',
      ({ params }) => {
        const refusal = taxReadRefusal(params.tenantId)
        if (refusal) return refusal
        const document = tax.documents.find((candidate) => candidate.id === params.docId)
        if (document === undefined) {
          return fail(
            'This workspace has no tax document with that ID. Reload the page to see its documents.',
            404,
            'tax_document_not_found'
          )
        }
        return fileResponse(
          `%PDF-1.4\n% ${document.number}\n%%EOF\n`,
          'application/pdf',
          `${document.number.replaceAll('/', '-')}.pdf`
        )
      }
    ),
    http.post(
      '/api/v1/platform/tenants/:tenantId/billing/tax-documents/:docId/credit-notes',
      async ({ params, request }) => {
        const refusal = billingStepUpRefusal(request) ?? taxWriteRefusal(params.tenantId)
        if (refusal) return refusal
        return issueCreditNote(params.docId, (await request.json()) as Record<string, unknown>)
      }
    ),
    // Newest held first; the one sort express takes is its default.
    http.get(
      '/api/v1/platform/tenants/:tenantId/billing/tax-held-charges',
      ({ params, request }) => {
        const refusal = taxReadRefusal(params.tenantId)
        if (refusal) return refusal
        const query = new URLSearchParams(new URL(request.url).searchParams)
        query.set('sort', '-heldAt')
        return ok(
          serveList(tax.held, query, {
            filters: {
              status: (row, values) =>
                values.includes(row.resolvedAt === null ? 'open' : 'resolved'),
            },
            sorts: {
              heldAt: (a, b) => a.heldAt.localeCompare(b.heldAt) || a.id.localeCompare(b.id),
            },
          }),
          'Held charges retrieved.'
        )
      }
    ),
    // A resolve only records staff work, so it stays allowed while registration is off.
    http.post(
      '/api/v1/platform/tenants/:tenantId/billing/tax-held-charges/:heldId/resolve',
      async ({ params, request }) => {
        const refusal = billingStepUpRefusal(request) ?? taxReadRefusal(params.tenantId)
        if (refusal) return refusal
        return resolveHeldCharge(params.heldId, (await request.json()) as Record<string, unknown>)
      }
    ),
    http.get('/api/v1/platform/billing/tax-export', ({ request }) => {
      const refusal = billingStepUpRefusal(request)
      if (refusal) return refusal
      if (!taxDocumentsExist) return fail(TAX_OFF.export, 404, 'tax_documents_disabled')
      const period = new URL(request.url).searchParams.get('period') ?? ''
      if (!/^\d{4}-(?:0[1-9]|1[0-2]|Q[1-4])$/.test(period)) {
        return validationFailure({
          period: ['Use YYYY-MM for a month or YYYY-Q1 to YYYY-Q4 for a quarter.'],
        })
      }
      return fileResponse(emptyZip(), 'application/zip', `gstr1-${period}.zip`)
    }),
  ]

  return { handlers, invoiceRows }
}
