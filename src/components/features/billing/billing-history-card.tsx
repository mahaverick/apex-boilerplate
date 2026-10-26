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
  billingDateTime,
  historyCauseLabel,
  historySearchCode,
} from '@/constants/billing-labels'
import { analyticsKey } from '@/observability/telemetry'
import { billingHistoryListOptions } from '@/queries/billing-admin.queries'
import { billingHistoryList } from '@/queries/billing-reads.queries'
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
    cell: ({ getValue }) => billingDateTime(getValue()),
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
 * A tenant's billing state changes, newest first, searched by state or
 * cause (a whole label is sent as its stored code) and filtered by source, all in the URL under the
 * `history` prefix.
 */
export function BillingHistoryCard({ tenantId }: { tenantId: string }) {
  const list = useListSearch(billingHistoryList)
  // The URL keeps what was typed; the request sends a label's stored code, which is what express matches.
  const query = useListQuery(list, (request) =>
    billingHistoryListOptions(
      tenantId,
      request.search === undefined
        ? request
        : { ...request, search: historySearchCode(request.search) }
    )
  )
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
          search={{
            label: 'Search state history',
            placeholder: 'Search a state, cause or code, such as past_due',
          }}
          filters={FILTERS}
          errorMessage="We couldn’t load this tenant’s state history. Select Try again."
          empty={<EmptyState size="compact" title="No state changes recorded." />}
        />
      </CardContent>
    </Card>
  )
}
