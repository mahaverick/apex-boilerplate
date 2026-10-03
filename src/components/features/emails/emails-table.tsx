import { Link } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useMemo } from 'react'
import { EmailStatusBadge } from '@/components/features/emails/email-status-badge'
import { EmailTenantLink } from '@/components/features/emails/email-tenant-link'
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
import { templateLabel } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { formatDateTime } from '@/lib/format'
import type { EmailMessageSummary } from '@/types/api.types'

/** No optional features: the API orders, filters and pages. */
const features = tableFeatures({})

const column = createColumnHelper<typeof features, EmailMessageSummary>()

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
        <EmailTenantLink tenant={tenant} className="underline-offset-4 hover:underline" />
      )
    },
  }),
])

/**
 * One page of tracked email, newest first as the API orders it. The
 * recipient opens the message; the User and Tenant columns link to their
 * records, and a dash is a mail with none, or one whose record was purged.
 * @param label - The table's accessible name, for a page that shows more than one.
 * @param omit - A column that would only repeat the page's own record: `tenant` on a tenant's Emails tab.
 */
export function EmailsTable({
  rows,
  label = 'Emails',
  omit,
}: {
  rows: EmailMessageSummary[]
  label?: string
  omit?: 'user' | 'tenant'
}) {
  const shown = useMemo(
    () =>
      omit === undefined
        ? columns
        : columns.filter((def) => !('accessorKey' in def && def.accessorKey === omit)),
    [omit]
  )
  const table = useTable({ features, columns: shown, data: rows, getRowId: (row) => row.id })
  return (
    <Table aria-label={label}>
      <TableCaption className="sr-only">Tracked email, newest first</TableCaption>
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
