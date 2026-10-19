import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import type { ReactNode } from 'react'
import { UserStatusBadges } from '@/components/features/users/user-status-badges'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Pii } from '@/components/shared/pii'
import { ROLE_LABELS } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { formatDate, fullName } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import type { PlatformUserRow } from '@/types/api.types'

const column = createColumnHelper<DataTableFeatures, PlatformUserRow>()

const columns = column.columns([
  column.accessor('email', {
    header: 'Email',
    meta: { sorts: ['email'], sortName: analyticsKey('email') },
    cell: ({ row }) => (
      <Link
        to={ROUTES.user}
        params={{ userId: row.original.id }}
        className="font-medium underline-offset-4 hover:underline"
      >
        <Pii>{row.original.email}</Pii>
      </Link>
    ),
  }),
  column.display({
    id: 'name',
    header: 'Name',
    cell: ({ row }) => {
      const name = fullName(row.original)
      return name === null ? <span className="text-muted-foreground">—</span> : <Pii>{name}</Pii>
    },
  }),
  column.display({
    id: 'status',
    header: 'Status',
    cell: ({ row }) => <UserStatusBadges user={row.original} />,
  }),
  column.accessor('platformRole', {
    header: 'Staff role',
    cell: ({ getValue }) => {
      const role = getValue()
      return role ? ROLE_LABELS[role] : <span className="text-muted-foreground">—</span>
    },
  }),
  column.accessor('membershipCount', {
    header: 'Tenants',
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
  column.accessor('lastLoggedInAt', {
    header: 'Last sign-in',
    meta: { sorts: ['-lastSignIn'], sortName: analyticsKey('last_sign_in'), sortWords: 'date' },
    cell: ({ getValue }) => {
      const at = getValue()
      return at === null ? 'Never' : (formatDate(at, 'medium') ?? 'Unknown')
    },
  }),
])

/** The facets: none picked in Status is the API's default, active and inactive live accounts. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'status',
    label: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
      { value: 'deleted', label: 'Deleted' },
    ],
  },
  // The API's `signedIn` filter, on the last sign-in, so it matches the Last sign-in column.
  {
    name: 'signedIn',
    label: 'Signed in',
    single: true,
    options: [
      { value: 'true', label: 'Has signed in' },
      { value: 'false', label: 'Never signed in' },
    ],
  },
  {
    name: 'staff',
    label: 'Staff',
    single: true,
    options: [
      { value: 'true', label: 'Staff' },
      { value: 'false', label: 'Not staff' },
    ],
  },
]

/** User accounts, through the shared list table. */
export function UsersTable({
  query,
  empty,
  errorMessage,
  toolbar,
}: {
  query: ListQueryState<PlatformUserRow>
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
      label="Users"
      getRowId={(row) => row.id}
      empty={empty}
      errorMessage={errorMessage}
      search={{ label: 'Search users', placeholder: 'Search by name or email' }}
      filters={FILTERS}
      toolbar={toolbar}
    />
  )
}
