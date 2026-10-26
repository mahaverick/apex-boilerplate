import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { BillingStateBadge } from '@/components/features/billing/billing-state-badge'
import { TenantStateBadge } from '@/components/features/tenants/tenant-state-badge'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { BILLING_STATE_BADGE } from '@/constants/billing-labels'
import { ROUTES } from '@/constants/routes'
import { analyticsKey } from '@/observability/telemetry'
import { TENANT_LIFECYCLE_STATES, type PlatformTenantRow } from '@/types/api.types'
import { BILLING_STATES } from '@/types/billing.types'

const column = createColumnHelper<DataTableFeatures, PlatformTenantRow>()

const columns = column.columns([
  column.accessor('name', {
    header: 'Name',
    meta: { sorts: ['name'], sortName: analyticsKey('name') },
    cell: ({ getValue, row }) => (
      <Link
        to={ROUTES.tenant}
        params={{ tenantId: row.original.id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        {getValue()}
      </Link>
    ),
  }),
  column.accessor('slug', {
    header: 'Slug',
    cell: ({ getValue }) => <code className="text-xs">{getValue()}</code>,
  }),
  column.accessor('lifecycleState', {
    header: 'Status',
    cell: ({ getValue }) => <TenantStateBadge state={getValue()} />,
  }),
  column.accessor('billingState', {
    header: 'Billing',
    cell: ({ getValue }) => <BillingStateBadge state={getValue()} />,
  }),
  column.accessor('memberCount', {
    header: 'Members',
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
  column.accessor('createdAt', {
    header: 'Created',
    meta: { sorts: ['created', '-created'], sortName: analyticsKey('created'), sortWords: 'date' },
    cell: ({ getValue }) =>
      new Date(getValue()).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
  }),
])

/** The lifecycle states a tenant holds, as the Status facet's options. None picked is the API's default, active and suspended. */
const STATE_LABELS = { active: 'Active', suspended: 'Suspended', archived: 'Archived' } as const

const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'state',
    label: 'Status',
    options: TENANT_LIFECYCLE_STATES.map((state) => ({ value: state, label: STATE_LABELS[state] })),
  },
  {
    name: 'billingState',
    label: 'Billing',
    options: BILLING_STATES.map((state) => ({
      value: state,
      label: BILLING_STATE_BADGE[state].label,
    })),
  },
]

/** Customer tenants, through the shared list table. */
export function TenantsTable({
  query,
  empty,
  errorMessage,
  toolbar,
}: {
  query: ListQueryState<PlatformTenantRow>
  empty: ReactNode
  /** The page's own load-error copy. */
  errorMessage: string
  /** The list's primary action, beside the search box. */
  toolbar?: ReactNode
}) {
  return (
    <DataTable
      columns={columns}
      query={query}
      label="Tenants"
      getRowId={(row) => row.id}
      empty={empty}
      errorMessage={errorMessage}
      search={{ label: 'Search tenants', placeholder: 'Search by name or slug' }}
      filters={FILTERS}
      toolbar={toolbar}
    />
  )
}
