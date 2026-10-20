import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { EmailStatusBadge } from '@/components/features/emails/email-status-badge'
import { TenantLink } from '@/components/features/tenants/tenant-link'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Pii } from '@/components/shared/pii'
import { templateLabel } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import type { EmailMessageSummary } from '@/types/api.types'

const column = createColumnHelper<DataTableFeatures, EmailMessageSummary>()

const none = <span className="text-muted-foreground">—</span>

const columns = column.columns([
  column.accessor('recipient', {
    header: 'Recipient',
    cell: ({ row }) => (
      <Link
        to={ROUTES.email}
        params={{ emailId: row.original.id }}
        className="font-medium break-all underline-offset-4 hover:underline"
      >
        <Pii>{row.original.recipient}</Pii>
      </Link>
    ),
  }),
  column.accessor('templateKey', {
    header: 'Template',
    cell: ({ getValue }) => templateLabel(getValue()),
  }),
  column.accessor('status', {
    header: 'Status',
    cell: ({ getValue }) => <EmailStatusBadge status={getValue()} />,
  }),
  column.accessor('createdAt', {
    header: 'Created',
    meta: { sorts: ['-created', 'created'], sortName: analyticsKey('created'), sortWords: 'date' },
    cell: ({ getValue }) => formatDateTime(getValue()) ?? 'Unknown',
  }),
  column.accessor('user', {
    header: 'User',
    cell: ({ getValue }) => {
      const user = getValue()
      return user === null ? (
        none
      ) : (
        <Link
          to={ROUTES.user}
          params={{ userId: user.id }}
          className="underline-offset-4 hover:underline"
        >
          <Pii>{user.name}</Pii>
        </Link>
      )
    },
  }),
  column.accessor('tenant', {
    header: 'Tenant',
    cell: ({ getValue }) => {
      const tenant = getValue()
      return tenant === null ? (
        none
      ) : (
        <TenantLink tenant={tenant} className="underline-offset-4 hover:underline" />
      )
    },
  }),
])

/** The columns, and without Tenant for a page that is one tenant's. */
const COLUMNS = {
  all: columns,
  tenant: columns.filter((def) => !('accessorKey' in def && def.accessorKey === 'tenant')),
}

/**
 * Tracked email, newest first as the API orders it, through the shared list
 * table. The recipient opens the message; the User and Tenant columns link to
 * their records, and a dash is a mail with none, or one whose record was
 * purged. `label` names the table for a page that shows more than one; `omit`
 * drops a column that would only repeat the page's own record, `tenant` on a
 * tenant's Emails tab.
 */
export function EmailsTable({
  query,
  empty,
  errorMessage,
  label = 'Emails',
  omit,
  toolbar,
  filters,
}: {
  query: ListQueryState<EmailMessageSummary>
  empty: ReactNode
  /** The page's own load-error copy. */
  errorMessage: string
  label?: string
  omit?: 'tenant'
  /** The list's own controls beside the search box, such as the date range. */
  toolbar?: ReactNode
  filters: readonly DataTableFilter[]
}) {
  return (
    <DataTable
      columns={COLUMNS[omit ?? 'all']}
      query={query}
      label={label}
      getRowId={(row) => row.id}
      empty={empty}
      errorMessage={errorMessage}
      search={{ label: 'Search emails', placeholder: 'Search by recipient' }}
      filters={filters}
      toolbar={toolbar}
    />
  )
}
