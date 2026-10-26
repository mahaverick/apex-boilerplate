import { createColumnHelper } from '@tanstack/react-table'
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
import { BILLING_EVENT_STATUS_BADGE, providerLabel } from '@/constants/billing-labels'
import { formatDateTime } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import { billingEventsList, billingEventsListOptions } from '@/queries/billing-admin.queries'
import { BILLING_EVENT_STATUSES, type StaffBillingEventItem } from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, StaffBillingEventItem>()

const none = <span className="text-muted-foreground">—</span>

const columns = column.columns([
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
    cell: ({ getValue }) => formatDateTime(getValue()) ?? 'Unknown',
  }),
  column.accessor('processedAt', {
    header: 'Handled',
    cell: ({ getValue }) => {
      const at = getValue()
      return at === null ? 'Not yet' : (formatDateTime(at) ?? 'Unknown')
    },
  }),
  column.accessor('error', {
    header: 'Error',
    meta: { className: 'whitespace-normal' },
    cell: ({ getValue }) => {
      const error = getValue()
      return error === null ? none : <span className="text-destructive">{error}</span>
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
export function BillingEventsCard({ tenantId }: { tenantId: string }) {
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
