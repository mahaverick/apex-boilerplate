import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { AlertTenant } from '@/components/features/billing/billing-alert-tenant'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { BILLING_ALERT_KIND_LABELS, billingDateTime } from '@/constants/billing-labels'
import { analyticsKey } from '@/observability/telemetry'
import type { BillingAlert } from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, BillingAlert>()

const columns = column.columns([
  column.accessor('at', {
    header: 'When',
    meta: { sorts: ['-at', 'at'], sortName: analyticsKey('at'), sortWords: 'date' },
    cell: ({ getValue }) => (
      <time dateTime={getValue()}>{billingDateTime(getValue(), undefined)}</time>
    ),
  }),
  column.accessor('kind', {
    header: 'Kind',
    cell: ({ getValue }) => BILLING_ALERT_KIND_LABELS[getValue()],
  }),
  column.accessor('tenant', {
    header: 'Tenant',
    cell: ({ getValue, row }) => <AlertTenant tenant={getValue()} kind={row.original.kind} />,
  }),
  column.accessor('message', {
    header: 'Message',
    cell: ({ getValue }) => (
      <span className="block min-w-64 wrap-break-word whitespace-normal">{getValue()}</span>
    ),
  }),
])

/**
 * Every billing alert, newest first unless sorted by the When header,
 * searched by message (express matches the message only), paged by the
 * API's cursor, all in the URL.
 */
export function BillingAlertsTable({
  query,
  empty,
}: {
  query: ListQueryState<BillingAlert>
  empty: ReactNode
}) {
  return (
    <DataTable
      columns={columns}
      query={query}
      label="Billing alerts"
      getRowId={(row) => row.id}
      search={{ label: 'Search billing alerts', placeholder: 'Search by message' }}
      errorMessage="We couldn’t load the billing alerts. Select Try again."
      empty={empty}
    />
  )
}
