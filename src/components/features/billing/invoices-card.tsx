import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { LoadError } from '@/components/features/load-error'
import { RoleDenied } from '@/components/features/role-denied'
import { ToneBadge } from '@/components/features/tone-badge'
import { DataTableFacetedFilter } from '@/components/shared/data-table/data-table-faceted-filter'
import type { DataTableFilter } from '@/components/shared/data-table/data-table-model'
import { EmptyState } from '@/components/shared/empty-state'
import { Note } from '@/components/shared/note'
import { TableRowsSkeleton } from '@/components/shared/section-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { INVOICE_STATUS_BADGE } from '@/constants/billing-labels'
import { codeFrom } from '@/lib/api-error'
import { formatDate } from '@/lib/format'
import { formatInr } from '@/lib/money'
import { isRoleDenied } from '@/lib/role-denied'
import { staffMessageFrom } from '@/lib/staff-message'
import { staffInvoicesQueryOptions } from '@/queries/billing-admin.queries'
import { billingAdminKeys } from '@/queries/billing-reads.queries'
import { sortFilterValues } from '@/schemas/list.schemas'
import { CURSOR_INVALID, INVOICE_STATUSES, type StaffInvoiceItem } from '@/types/billing.types'

/** What staff read when payments are off: the provider can't be asked, which is not "no invoices". */
const INVOICES_PAYMENTS_OFF =
  'Payments are off on this server, so invoices can’t be read from the payment provider.'

/** The Status facet over the invoice statuses. */
const STATUS_FILTER: DataTableFilter = {
  name: 'status',
  label: 'Status',
  options: INVOICE_STATUSES.map((value) => ({ value, label: INVOICE_STATUS_BADGE[value].label })),
}

/**
 * A date in the reader's locale, or a fallback.
 * @param iso - An ISO timestamp.
 */
function day(iso: string): string {
  return formatDate(iso, 'medium') ?? 'Unknown'
}

/** The loaded invoices as a table. */
function InvoicesTable({ items }: { items: readonly StaffInvoiceItem[] }) {
  return (
    <Table aria-label="Invoices">
      <TableCaption className="sr-only">Invoices</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Invoice ID</TableHead>
          <TableHead scope="col">Subscription ID</TableHead>
          <TableHead scope="col">Amount</TableHead>
          <TableHead scope="col">Status</TableHead>
          <TableHead scope="col">Issued</TableHead>
          <TableHead scope="col">Paid</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((invoice) => {
          const status = INVOICE_STATUS_BADGE[invoice.status]
          return (
            <TableRow key={invoice.id}>
              <TableCell>
                <code>{invoice.id}</code>
              </TableCell>
              <TableCell>
                <code>{invoice.subscriptionId}</code>
              </TableCell>
              <TableCell className="tabular-nums">{formatInr(invoice.amountMinor)}</TableCell>
              <TableCell>
                <ToneBadge tone={status.tone}>{status.label}</ToneBadge>
              </TableCell>
              <TableCell>{day(invoice.issuedAt)}</TableCell>
              <TableCell>{invoice.paidAt === null ? 'Not paid' : day(invoice.paidAt)}</TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

/**
 * The tenant's invoices, read from the payment provider: newest subscription
 * first and newest invoice first within each, forward only, with a status
 * filter and no search or sort, since the provider offers neither. A page may
 * come back short or empty while more remain, so "Load more invoices" stays
 * while the last page says there is more, and "No invoices" shows only once
 * the provider says there are none left. A refused cursor (the tenant's
 * subscriptions changed, or payments were turned off) starts again from the
 * newest. With payments off it asks nothing and says why. A failure shows
 * the API's sentence (`staffMessageFrom`) with Try again; a failed Load more
 * keeps the pages already read. The Status filter stays in the card for
 * simplicity: the list is forward only and the filter is one click.
 */
export function InvoicesCard({
  tenantId,
  paymentsEnabled,
}: {
  tenantId: string
  paymentsEnabled: boolean
}) {
  const [status, setStatus] = useState<readonly string[]>([])
  const options = staffInvoicesQueryOptions(
    tenantId,
    status.length === 0 ? undefined : sortFilterValues(status).join(',')
  )
  const queryClient = useQueryClient()
  const query = useInfiniteQuery({ ...options, enabled: paymentsEnabled })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  /**
   * Drops every loaded page and reads the first again, with no cursor. The
   * billing view is read again too: a cursor refused because payments were
   * turned off must show the payments-off note, not "No invoices".
   */
  const restart = () => {
    void queryClient.invalidateQueries({ queryKey: billingAdminKeys.tenant(tenantId), exact: true })
    void queryClient.resetQueries({ queryKey: options.queryKey, exact: true })
  }

  /** The body for the state the read is in. */
  const body = () => {
    if (!paymentsEnabled) return <Note tone="passive">{INVOICES_PAYMENTS_OFF}</Note>
    if (query.isError && isRoleDenied(query.error)) return <RoleDenied />
    if (query.isError && query.data === undefined) {
      return (
        <LoadError message={staffMessageFrom(query.error)} onRetry={() => void query.refetch()} />
      )
    }
    if (query.data === undefined) {
      return (
        <div role="status" aria-label="Loading">
          <TableRowsSkeleton rows={3} columns={6} />
        </div>
      )
    }
    const refused = query.isFetchNextPageError && codeFrom(query.error) === CURSOR_INVALID
    return (
      <div className="grid gap-3">
        {items.length > 0 ? (
          <InvoicesTable items={items} />
        ) : query.hasNextPage ? (
          <p className="text-sm text-muted-foreground">
            This page had no invoices, and more remain. Select Load more invoices to read the next
            page.
          </p>
        ) : (
          <EmptyState
            size="compact"
            title={status.length === 0 ? 'No invoices for this tenant.' : 'No invoices match.'}
            description={
              status.length === 0 ? undefined : 'Clear the Status filter to see every invoice.'
            }
          />
        )}
        {refused ? (
          <Note tone="info">
            These invoices are out of date. The tenant’s subscriptions changed, or payments were
            turned off on this server.{' '}
            <Button variant="link" size="sm" className="h-auto p-0" onClick={restart}>
              Start again from the newest
            </Button>
          </Note>
        ) : query.isFetchNextPageError ? (
          <LoadError
            message={staffMessageFrom(query.error)}
            onRetry={() => void query.fetchNextPage()}
          />
        ) : (
          query.hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? 'Loading invoices…' : 'Load more invoices'}
            </Button>
          )
        )}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Invoices</h2>
        </CardTitle>
        <CardDescription>
          The payment provider pages invoices newest first, so search and sort aren’t available.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {paymentsEnabled && (
          <div className="flex flex-wrap gap-2">
            <DataTableFacetedFilter
              list="Invoices"
              filter={STATUS_FILTER}
              selected={status}
              onChange={setStatus}
            />
          </div>
        )}
        {body()}
      </CardContent>
    </Card>
  )
}
