import { createColumnHelper } from '@tanstack/react-table'
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
  BILLING_SOURCE_LABELS,
  BILLING_STATE_BADGE,
  historyCauseLabel,
} from '@/constants/billing-labels'
import { formatDateTime } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import { billingHistoryList, billingHistoryListOptions } from '@/queries/billing-admin.queries'
import { BILLING_HISTORY_SOURCES, type StaffBillingHistoryItem } from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, StaffBillingHistoryItem>()

const columns = column.columns([
  column.display({
    id: 'change',
    header: 'Change',
    cell: ({ row }) => {
      const { from, to } = row.original
      return `${from === null ? 'Created' : BILLING_STATE_BADGE[from].label} → ${BILLING_STATE_BADGE[to].label}`
    },
  }),
  column.accessor('cause', {
    header: 'Cause',
    cell: ({ getValue }) => historyCauseLabel(getValue()),
  }),
  column.accessor('source', {
    header: 'Source',
    cell: ({ getValue }) => BILLING_SOURCE_LABELS[getValue()],
  }),
  column.accessor('at', {
    header: 'When',
    meta: { sorts: ['-at', 'at'], sortName: analyticsKey('at'), sortWords: 'date' },
    cell: ({ getValue }) => formatDateTime(getValue()) ?? 'Unknown',
  }),
])

/** The Source facet: who or what moved the tenant. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'source',
    label: 'Source',
    options: BILLING_HISTORY_SOURCES.map((value) => ({
      value,
      label: BILLING_SOURCE_LABELS[value],
    })),
  },
]

/**
 * A tenant's billing state changes, newest first, searched by the stored
 * state and cause names and filtered by source, all in the URL under the
 * `history` prefix.
 */
export function BillingHistoryCard({ tenantId }: { tenantId: string }) {
  const list = useListSearch(billingHistoryList)
  const query = useListQuery(list, (request) => billingHistoryListOptions(tenantId, request))
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>State history</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          query={query}
          label="State history"
          getRowId={(row) => row.id}
          search={{ label: 'Search state history', placeholder: 'Search by state or cause code' }}
          filters={FILTERS}
          errorMessage="We couldn’t load this tenant’s state history. Select Try again."
          empty={<EmptyState size="compact" title="No state changes recorded." />}
        />
      </CardContent>
    </Card>
  )
}
