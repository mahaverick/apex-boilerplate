import { IconChevronDown } from '@tabler/icons-react'
import { createColumnHelper } from '@tanstack/react-table'
import { useMemo, useState } from 'react'
import { CreditNoteDialog } from '@/components/features/billing/credit-note-dialog'
import { TaxDocumentDownload } from '@/components/features/billing/tax-document-download'
import { ToneBadge } from '@/components/features/tone-badge'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Note } from '@/components/shared/note'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { billingDate, TAX_DOCUMENT_TYPE_LABELS } from '@/constants/billing-labels'
import { useSaveTaxDocument } from '@/hooks/use-save-tax-document'
import { codeFrom } from '@/lib/api-error'
import { formatInr } from '@/lib/billing-format'
import { staffMessageFrom } from '@/lib/staff-message'
import { IST, remainingCreditMinor, taxSplitText } from '@/lib/tax-format'
import { analyticsKey } from '@/observability/telemetry'
import { taxDocumentsListOptions } from '@/queries/billing-admin.queries'
import { taxDocumentsList } from '@/queries/billing-reads.queries'
import { MIN_CREDIT_MINOR } from '@/schemas/tax.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import {
  TAX_DOCUMENT_TYPES,
  TAX_DOCUMENTS_DISABLED,
  type StaffTaxDocumentItem,
  type StaffTenantBilling,
} from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, StaffTaxDocumentItem>()

/** What a credit note's Linked cell says: the invoice it reduces and, for a staff note, who wrote it and why. */
function CreditNoteLink({ document }: { document: StaffTaxDocumentItem }) {
  return (
    <span>
      {document.invoice !== null && `Reduces ${document.invoice.number}`}
      {document.manual && (
        <>
          {' '}
          by{' '}
          {document.createdBy === null ? 'a deleted account' : <Pii>{document.createdBy.name}</Pii>}
          {document.reason !== null && (
            <>
              : “<Pii>{document.reason}</Pii>”
            </>
          )}
        </>
      )}
    </span>
  )
}

/**
 * An invoice's row actions for an admin: a menu with the PDF and Issue credit
 * note, and the credit note dialog. A credit note, or an invoice with less
 * than ₹1 left to credit, gets the plain PDF button. The dialog stays
 * mounted while open, so a refusal that leaves nothing to credit still reads.
 */
function RowActions({
  tenant,
  provider,
  document,
  canCredit,
}: {
  tenant: PlatformTenantDetail
  provider: StaffTenantBilling['provider']
  document: StaffTaxDocumentItem
  canCredit: boolean
}) {
  const { busy, save } = useSaveTaxDocument(tenant.id, document)
  const [open, setOpen] = useState(false)
  const offered =
    canCredit && document.type === 'invoice' && remainingCreditMinor(document) >= MIN_CREDIT_MINOR
  if (!offered && !open) return <TaxDocumentDownload tenantId={tenant.id} document={document} />
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" aria-label={`Actions for ${document.number}`} />
          }
        >
          Actions
          <IconChevronDown aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem aria-disabled={busy} onClick={() => void save()}>
            {busy ? 'Downloading…' : 'Download PDF'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setOpen(true)}>Issue credit note</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreditNoteDialog
        tenant={tenant}
        invoice={document}
        provider={provider}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  )
}

/** The table's columns. Document dates are in IST, whatever zone the tenant keeps. */
const columnsFor = (
  tenant: PlatformTenantDetail,
  provider: StaffTenantBilling['provider'],
  canCredit: boolean
) =>
  column.columns([
    column.accessor('number', {
      header: 'Number',
      cell: ({ getValue }) => <code>{getValue()}</code>,
    }),
    column.accessor('type', {
      header: 'Type',
      cell: ({ row }) => (
        <span className="flex flex-wrap gap-1">
          <ToneBadge tone={row.original.type === 'invoice' ? 'neutral' : 'outline'}>
            {TAX_DOCUMENT_TYPE_LABELS[row.original.type]}
          </ToneBadge>
          {row.original.manual && <ToneBadge tone="neutral-outline">Manual</ToneBadge>}
          {row.original.noTaxReduction && <ToneBadge tone="warning">No tax reduction</ToneBadge>}
        </span>
      ),
    }),
    column.accessor('issuedAt', {
      header: 'Issued',
      meta: { sorts: ['-issued', 'issued'], sortName: analyticsKey('issued'), sortWords: 'date' },
      cell: ({ getValue }) => billingDate(getValue(), IST),
    }),
    column.display({
      id: 'total',
      header: 'Total',
      meta: { label: 'Total', className: 'tabular-nums' },
      cell: ({ row }) => formatInr(row.original.amounts.totalMinor),
    }),
    column.display({
      id: 'tax',
      header: 'Tax',
      meta: { label: 'Tax' },
      cell: ({ row }) => taxSplitText(row.original.amounts, row.original.supply),
    }),
    column.accessor('buyerGstin', {
      header: 'Buyer GSTIN',
      cell: ({ getValue }) => {
        const gstin = getValue()
        return gstin === null ? 'None (B2C)' : <Pii>{gstin}</Pii>
      },
    }),
    column.display({
      id: 'linked',
      header: 'Linked',
      meta: { label: 'Linked' },
      cell: ({ row }) => {
        const document = row.original
        if (document.type === 'credit_note') return <CreditNoteLink document={document} />
        if (document.creditNotes.length === 0) return 'Not credited'
        return (
          <span>
            {formatInr(document.creditedMinor)} of {formatInr(document.amounts.totalMinor)} credited
            ({document.creditNotes.map((note) => note.number).join(', ')})
          </span>
        )
      },
    }),
    column.display({
      id: 'actions',
      header: 'Actions',
      meta: { label: 'Actions', actions: true },
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <RowActions
            tenant={tenant}
            provider={provider}
            document={row.original}
            canCredit={canCredit}
          />
        </div>
      ),
    }),
  ])

/** The Type facet over the two kinds of tax document. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'type',
    label: 'Type',
    options: TAX_DOCUMENT_TYPES.map((value) => ({
      value,
      label: TAX_DOCUMENT_TYPE_LABELS[value],
    })),
  },
]

/**
 * A tenant's tax invoices and credit notes, newest first, searched by number
 * and filtered by type, all in the URL under the `tax` prefix. Dates are in
 * India Standard Time (IST), as printed on each document, so a document never
 * moves to another day with the tenant's zone. A viewer reads and downloads;
 * writes sit in the Actions column for the roles that hold them. A 404
 * `tax_documents_disabled` (registration turned off between the billing read
 * and this one) shows express's sentence in a note, not `RoleDenied`.
 * @param props.tenant - The tenant's platform detail.
 * @param props.provider - The tenant's payment provider, named in the credit note dialog.
 * @param props.canCredit - Whether the signed-in role may issue a credit note.
 * @param props.timeZone - The tenant's zone. Unused for document dates, which are IST.
 */
export function TaxDocumentsCard({
  tenant,
  provider,
  canCredit,
}: {
  tenant: PlatformTenantDetail
  provider: StaffTenantBilling['provider']
  canCredit: boolean
  timeZone: string
}) {
  const tenantId = tenant.id
  const columns = useMemo(
    () => columnsFor(tenant, provider, canCredit),
    [tenant, provider, canCredit]
  )
  const list = useListSearch(taxDocumentsList)
  const query = useListQuery(list, (request) => taxDocumentsListOptions(tenantId, request))
  const disabled = query.query.isError && codeFrom(query.query.error) === TAX_DOCUMENTS_DISABLED
  return (
    <Card id="tax-documents">
      <CardHeader>
        <CardTitle>
          <h2>Tax documents</h2>
        </CardTitle>
        <CardDescription>
          Tax invoices and credit notes, newest first. Dates are in India Standard Time (IST), as
          printed on each document.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {disabled ? (
          <Note tone="info">{staffMessageFrom(query.query.error)}</Note>
        ) : (
          <DataTable
            columns={columns}
            query={query}
            label="Tax documents"
            getRowId={(row) => row.id}
            search={{ label: 'Search tax documents', placeholder: 'Search by number' }}
            filters={FILTERS}
            errorMessage="We couldn’t load this tenant’s tax documents. Select Try again."
            empty={
              <EmptyState
                size="compact"
                title="No tax documents yet."
                description="We issue a tax invoice for each charge paid on or after the GST start date set on the API."
              />
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
