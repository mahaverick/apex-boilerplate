import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { createContext, useContext, type ReactNode, type RefCallback } from 'react'
import { DataTable } from '@/components/shared/data-table/data-table'
import type {
  DataTableFeatures,
  DataTableFilter,
} from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SUPPRESSION_REASON_LABELS } from '@/constants/email.constants'
import { ROUTES } from '@/constants/routes'
import { formatDate } from '@/lib/format'
import { analyticsKey } from '@/observability/telemetry'
import type { EmailSuppression } from '@/types/api.types'

/** Offers Lift on a row: hands over its button so focus can return there. */
type LiftHandler = (row: EmailSuppression, opener: HTMLButtonElement) => void

/** What the cells read from the page: the Lift action, which changes between renders. */
const LiftScope = createContext<LiftHandler | undefined>(undefined)

/** A lifted row's who, when and why; an active one's badge. */
function SuppressionState({ row }: { row: EmailSuppression }) {
  if (row.liftedAt === null) return <Badge variant="outline">Active</Badge>
  return (
    <div className="grid gap-0.5 whitespace-normal">
      <span>
        Lifted {formatDate(row.liftedAt, 'medium') ?? 'on an unknown date'}
        {row.liftedBy === null ? null : (
          <>
            {' '}
            by <Pii>{row.liftedBy.name}</Pii>
          </>
        )}
      </span>
      {row.liftReason !== null && (
        <Pii className="text-xs wrap-break-word text-muted-foreground">{row.liftReason}</Pii>
      )}
    </div>
  )
}

/** The Lift button of an active row; nothing on a lifted one. */
function LiftCell({ row }: { row: EmailSuppression }) {
  const onLift = useContext(LiftScope)
  if (onLift === undefined || row.liftedAt !== null) return null
  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={`Lift suppression for ${row.address}`}
      onClick={(event) => onLift(row, event.currentTarget)}
    >
      Lift
    </Button>
  )
}

const column = createColumnHelper<DataTableFeatures, EmailSuppression>()

/** The columns every role sees. */
const READ_COLUMNS = [
  column.accessor('address', {
    header: 'Address',
    meta: { sorts: ['address'], sortName: analyticsKey('address') },
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
    meta: { sorts: ['-created', 'created'], sortName: analyticsKey('created'), sortWords: 'date' },
    cell: ({ getValue }) => formatDate(getValue(), 'medium') ?? 'Unknown',
  }),
  column.display({
    id: 'state',
    header: 'State',
    cell: ({ row }) => <SuppressionState row={row.original} />,
  }),
]

/** The read-only columns, for a role that cannot lift. */
const VIEW_COLUMNS = column.columns(READ_COLUMNS)

/** The read columns, then Lift. */
const LIFT_COLUMNS = column.columns([
  ...READ_COLUMNS,
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { label: 'Actions', actions: true },
    cell: ({ row }) => <LiftCell row={row.original} />,
  }),
])

/** Active or lifted; none picked is the API's default, active. */
const FILTERS: readonly DataTableFilter[] = [
  {
    name: 'state',
    label: 'State',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'lifted', label: 'Lifted' },
    ],
  },
]

/**
 * Suppressed addresses, newest first as the API orders them, through the
 * shared list table. With `rowTarget`, each row (or card, on a phone) can
 * take focus from code: once Lift replaces its button with the lifted state,
 * focus lands on it.
 */
export function SuppressionsTable({
  query,
  empty,
  errorMessage,
  onLift,
  rowTarget,
}: {
  query: ListQueryState<EmailSuppression>
  empty: ReactNode
  /** The page's own load-error copy. */
  errorMessage: string
  /** Offers Lift on each active row, handing over its button so focus can return there; omitted, the table offers no action (below admin). */
  onLift?: LiftHandler
  /** The ref callback that registers a row as a focus landmark (`useFocusAfter`), keyed by suppression id. */
  rowTarget?: (id: string) => RefCallback<HTMLElement>
}) {
  return (
    <LiftScope value={onLift}>
      <DataTable
        columns={onLift === undefined ? VIEW_COLUMNS : LIFT_COLUMNS}
        query={query}
        label="Suppressions"
        getRowId={(row) => row.id}
        empty={empty}
        errorMessage={errorMessage}
        search={{ label: 'Search suppressions', placeholder: 'Search by address' }}
        filters={FILTERS}
        rowTarget={rowTarget}
      />
    </LiftScope>
  )
}
