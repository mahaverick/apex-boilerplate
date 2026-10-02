import { Link } from '@tanstack/react-router'
import { createColumnHelper, tableFeatures, useTable } from '@tanstack/react-table'
import { useMemo, type RefCallback } from 'react'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { SUPPRESSION_REASON_LABELS } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { formatDate } from '@/lib/format'
import type { EmailSuppression } from '@/types/api.types'

/** No optional features: the API orders, filters and pages. */
const features = tableFeatures({})

const column = createColumnHelper<typeof features, EmailSuppression>()

/** A lifted row's who, when and why; an active one's badge. */
function SuppressionState({ row }: { row: EmailSuppression }) {
  if (row.liftedAt === null) return <Badge variant="outline">Active</Badge>
  return (
    <div className="grid gap-0.5 whitespace-normal">
      <Pii>
        Lifted {formatDate(row.liftedAt, 'medium') ?? 'on an unknown date'}
        {row.liftedBy === null ? '' : ` by ${row.liftedBy.name}`}
      </Pii>
      {row.liftReason !== null && (
        <Pii className="text-xs wrap-break-word text-muted-foreground">{row.liftReason}</Pii>
      )}
    </div>
  )
}

interface SuppressionsTableProps {
  rows: EmailSuppression[]
  /** Offers Lift on each active row, handing over its button so focus can return there; omitted, the table offers no action (below admin). */
  onLift?: (row: EmailSuppression, opener: HTMLButtonElement) => void
  /** The ref callback that registers a row as a focus landmark (`useFocusAfter`), keyed by suppression id. */
  target?: (id: string) => RefCallback<HTMLElement>
}

/**
 * One page of suppressed addresses, newest first as the API orders them. With
 * `target`, each row can take focus from code: once Lift replaces its button
 * with the lifted state, focus lands on the row.
 */
export function SuppressionsTable({ rows, onLift, target }: SuppressionsTableProps) {
  const columns = useMemo(
    () =>
      column.columns([
        column.accessor('address', {
          header: 'Address',
          cell: ({ getValue }) => <Pii className="font-medium break-all">{getValue()}</Pii>,
        }),
        column.accessor('reason', {
          header: 'Reason',
          cell: ({ getValue }) => SUPPRESSION_REASON_LABELS[getValue()],
        }),
        column.accessor('sourceMessageId', {
          header: 'Source',
          cell: ({ getValue, row }) => {
            const emailId = getValue()
            return emailId === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <Link
                to={ROUTES.email}
                params={{ emailId }}
                aria-label={`View the email that suppressed ${row.original.address}`}
                className="underline-offset-4 hover:underline"
              >
                View email
              </Link>
            )
          },
        }),
        column.accessor('createdAt', {
          header: 'Suppressed',
          cell: ({ getValue }) => formatDate(getValue(), 'medium') ?? 'Unknown',
        }),
        column.display({
          id: 'state',
          header: 'State',
          cell: ({ row }) => <SuppressionState row={row.original} />,
        }),
        ...(onLift === undefined
          ? []
          : [
              column.display({
                id: 'actions',
                header: () => <span className="sr-only">Actions</span>,
                cell: ({ row }) =>
                  row.original.liftedAt === null && (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Lift suppression for ${row.original.address}`}
                      onClick={(event) => onLift(row.original, event.currentTarget)}
                    >
                      Lift
                    </Button>
                  ),
              }),
            ]),
      ]),
    [onLift]
  )
  const table = useTable({ features, columns, data: rows, getRowId: (row) => row.id })
  return (
    <Table aria-label="Suppressions">
      <TableCaption className="sr-only">Suppressed addresses, newest first</TableCaption>
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
          <TableRow
            key={row.id}
            ref={target?.(row.id)}
            tabIndex={target === undefined ? undefined : -1}
            className="outline-none"
          >
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
