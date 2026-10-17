import { createColumnHelper } from '@tanstack/react-table'
import { PosthogLink } from '@/components/features/flags/posthog-link'
import { ToneBadge } from '@/components/features/tone-badge'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { EmptyState } from '@/components/shared/empty-state'
import { FLAGS_LIST_ERROR } from '@/constants/flags.constants'
import { analyticsKey } from '@/observability/telemetry'
import type { UnregisteredRow } from '@/types/api.types'

const column = createColumnHelper<DataTableFeatures, UnregisteredRow>()

/** The key, whether PostHog has it on, and its link. */
const UNREGISTERED_COLUMNS = column.columns([
  column.accessor('key', {
    header: 'Flag',
    meta: { sorts: ['key'], sortName: analyticsKey('key') },
    cell: ({ getValue }) => <code className="text-sm break-all">{getValue()}</code>,
  }),
  column.accessor('active', {
    header: 'In PostHog',
    cell: ({ getValue }) =>
      getValue() ? (
        <ToneBadge tone="success">Active</ToneBadge>
      ) : (
        <ToneBadge tone="muted">Inactive</ToneBadge>
      ),
  }),
  column.display({
    id: 'posthog',
    header: () => <span className="sr-only">PostHog</span>,
    meta: { label: 'PostHog', actions: true },
    cell: ({ row }) => <PosthogLink href={row.original.posthogUrl} flagKey={row.original.key} />,
  }),
])

/**
 * Flags this environment's PostHog holds that no code declares, through the
 * shared list table. Listed for information: express never evaluates them, so
 * no app reads them. The page's section is already the list's region.
 */
export function UnregisteredFlagsTable({ query }: { query: ListQueryState<UnregisteredRow> }) {
  return (
    <DataTable
      columns={UNREGISTERED_COLUMNS}
      query={query}
      label="Unregistered flags"
      landmark={false}
      errorMessage={FLAGS_LIST_ERROR}
      getRowId={(row) => row.key}
      search={{ label: 'Search unregistered flags', placeholder: 'Search by key' }}
      empty={
        <EmptyState size="compact" title="None." description="Every PostHog flag is registered." />
      }
    />
  )
}
