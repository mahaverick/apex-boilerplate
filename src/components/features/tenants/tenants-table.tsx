import { Link } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { TenantStateBadge } from '@/components/features/tenants/tenant-state-badge'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ROUTES } from '@/constants/routes'
import type { PlatformTenantRow } from '@/types/api.types'

/** No optional features: the API orders, filters and pages, so the table only lays rows out. */
const features = tableFeatures({})

const column = createColumnHelper<typeof features, PlatformTenantRow>()

const columns = column.columns([
  column.accessor('name', {
    header: 'Name',
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
  column.accessor('memberCount', {
    header: 'Members',
    cell: ({ getValue }) => <span className="tabular-nums">{getValue()}</span>,
  }),
  column.accessor('createdAt', {
    header: 'Created',
    cell: ({ getValue }) =>
      new Date(getValue()).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }),
  }),
])

/**
 * One page of customer tenants. Ordering and paging are the API's (by name,
 * keyset), so the table sorts nothing itself.
 */
export function TenantsTable({ rows }: { rows: PlatformTenantRow[] }) {
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.id })
  return (
    <Table aria-label="Tenants">
      <TableCaption className="sr-only">Customer tenants, by name</TableCaption>
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
