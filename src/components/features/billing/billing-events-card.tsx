import { createColumnHelper } from '@tanstack/react-table'
import { useMemo } from 'react'
import { NoValue } from '@/components/features/billing/no-value'
import { ToneBadge } from '@/components/features/tone-badge'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  BILLING_EVENT_STATUS_BADGE,
  billingDateTime,
  providerLabel,
} from '@/constants/billing-labels'
import { analyticsKey } from '@/observability/telemetry'
import { billingEventsListOptions } from '@/queries/billing-admin.queries'
import { billingEventsList } from '@/queries/billing-reads.queries'
import { BILLING_EVENT_STATUSES, type StaffBillingEventItem } from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, StaffBillingEventItem>()

/** An empty Handled or Error cell. */
const none = <NoValue label="None" />

/**
 * The table's columns, with each event's times in the tenant's zone.
 * @param timeZone - The tenant's time zone.
 */
const columnsFor = (timeZone: string) =>
  column.columns([
    column.accessor('type', {
      header: 'Event',
      cell: ({ getValue }) => <code className="break-all">{getValue()}</code>,
    }),
    column.accessor('status', {
      header: 'Status',
      cell: ({ getValue }) => {
        const { label, tone } = BILLING_EVENT_STATUS_BADGE[getValue()]
        return <ToneBadge tone={tone}>{label}</ToneBadge>
      },
    }),
    column.accessor('receivedAt', {
      header: 'Received',
      meta: { sorts: ['-at', 'at'], sortName: analyticsKey('at'), sortWords: 'date' },
      cell: ({ getValue }) => billingDateTime(getValue(), timeZone),
    }),
    column.accessor('processedAt', {
      header: 'Handled',
      // A failed event gave up after every retry and nothing retries it; only a pending one is still to be handled.
      cell: ({ row }) => {
        const { processedAt, status } = row.original
        if (processedAt !== null) return billingDateTime(processedAt, timeZone)
        return status === 'failed' ? 'Gave up' : status === 'pending' ? 'Not yet' : none
      },
    }),
    column.accessor('error', {
      header: 'Error',
      meta: { className: 'whitespace-normal' },
      // A failed event's error is a failure; an unused event's is only why it changed nothing.
      cell: ({ row }) => {
        const { error, status } = row.original
        if (error === null) return none
        return (
          <span className={status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
            {error}
          </span>
        )
      },
    }),
    column.accessor('provider', {
      header: 'Provider',
      cell: ({ row }) => providerLabel(row.original.provider, row.original.mode),
    }),
  ])

/** The Status facet. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'status',
    label: 'Status',
    options: BILLING_EVENT_STATUSES.map((value) => ({
      value,
      label: BILLING_EVENT_STATUS_BADGE[value].label,
    })),
  },
]

/**
 * The payment provider's events tied to this tenant, newest received first,
 * searched by type and error and filtered by status, in the URL under the
 * `events` prefix. An event never shows its provider ids or payload.
 */
export function BillingEventsCard({ tenantId, timeZone }: { tenantId: string; timeZone: string }) {
  const columns = useMemo(() => columnsFor(timeZone), [timeZone])
  const list = useListSearch(billingEventsList)
  const query = useListQuery(list, (request) => billingEventsListOptions(tenantId, request))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Provider events</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          query={query}
          label="Provider events"
          getRowId={(row) => row.id}
          search={{ label: 'Search provider events', placeholder: 'Search by event or error' }}
          filters={FILTERS}
          errorMessage="We couldn’t load this tenant’s provider events. Select Try again."
          empty={<EmptyState size="compact" title="No payment provider events for this tenant." />}
        />
      </CardContent>
    </Card>
  )
}
