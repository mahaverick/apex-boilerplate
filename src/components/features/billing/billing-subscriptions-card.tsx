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
import { providerLabel, SUBSCRIPTION_STANDING_BADGE } from '@/constants/billing-labels'
import { formatDateTime } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import {
  billingSubscriptionsList,
  billingSubscriptionsListOptions,
} from '@/queries/billing-admin.queries'
import type { StaffBillingSubscriptionItem } from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, StaffBillingSubscriptionItem>()

const columns = column.columns([
  column.accessor('subscriptionId', {
    header: 'Subscription ID',
    cell: ({ getValue }) => <code className="break-all">{getValue()}</code>,
  }),
  column.accessor('standing', {
    header: 'Standing',
    cell: ({ getValue }) => {
      const { label, tone } = SUBSCRIPTION_STANDING_BADGE[getValue()]
      return <ToneBadge tone={tone}>{label}</ToneBadge>
    },
  }),
  column.accessor('provider', {
    header: 'Provider',
    cell: ({ row }) => providerLabel(row.original.provider, row.original.mode),
  }),
  column.accessor('firstSeenAt', {
    header: 'First seen',
    meta: {
      sorts: ['-firstSeen', 'firstSeen'],
      sortName: analyticsKey('first_seen'),
      sortWords: 'date',
    },
    cell: ({ getValue }) => formatDateTime(getValue()) ?? 'Unknown',
  }),
])

/** The Provider and Mode facets. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'provider',
    label: 'Provider',
    options: [
      { value: 'razorpay', label: 'Razorpay' },
      { value: 'fake', label: 'Fake' },
    ],
  },
  {
    name: 'mode',
    label: 'Mode',
    options: [
      { value: 'test', label: 'Test' },
      { value: 'live', label: 'Live' },
    ],
  },
]

/**
 * Every subscription the tenant held as its current one, newest first seen
 * first, searched by id and filtered by provider and mode, in the URL under
 * the `subscriptions` prefix. A pending or next subscription that never
 * became current is only in the Billing card.
 */
export function BillingSubscriptionsCard({ tenantId }: { tenantId: string }) {
  const list = useListSearch(billingSubscriptionsList)
  const query = useListQuery(list, (request) => billingSubscriptionsListOptions(tenantId, request))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Subscriptions</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          query={query}
          label="Subscriptions"
          getRowId={(row) => row.id}
          search={{ label: 'Search subscriptions', placeholder: 'Search by subscription ID' }}
          filters={FILTERS}
          errorMessage="We couldn’t load this tenant’s subscriptions. Select Try again."
          empty={
            <EmptyState
              size="compact"
              title="No subscriptions recorded."
              description="A subscription shows here once it becomes the tenant’s current one."
            />
          }
        />
      </CardContent>
    </Card>
  )
}
