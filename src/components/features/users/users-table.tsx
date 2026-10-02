import { Link } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { UserStatusBadges } from '@/components/features/users/user-status-badges'
import { Pii } from '@/components/shared/pii'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ROLE_LABELS } from '@/constants/roles'
import { ROUTES } from '@/constants/routes'
import { formatDate, fullName } from '@/lib/format'
import type { PlatformUserRow } from '@/types/api.types'

/** No optional features: the API orders, filters and pages. */
const features = tableFeatures({})

const column = createColumnHelper<typeof features, PlatformUserRow>()

const columns = column.columns([
  column.accessor('email', {
    header: 'Email',
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
    cell: ({ getValue }) => {
      const at = getValue()
      return at === null ? 'Never' : (formatDate(at, 'medium') ?? 'Unknown')
    },
  }),
])

/** One page of users, ordered by email by the API. */
export function UsersTable({ rows }: { rows: PlatformUserRow[] }) {
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.id })
  return (
    <Table aria-label="Users">
      <TableCaption className="sr-only">Every user, by email</TableCaption>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => (
              <TableHead key={header.id} scope="col">
                <table.FlexRender header={header} />
              </TableHead>
            ))}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow key={row.id}>
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id}>
                <table.FlexRender cell={cell} />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
