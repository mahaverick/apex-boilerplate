import { Link } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
import { useState, type ReactNode } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import type { ListQueryState } from '@/components/shared/data-table/use-list-query'
import { Pii } from '@/components/shared/pii'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ROUTES } from '@/constants/routes'
import { useStepUp } from '@/hooks/use-step-up'
import { formatDate, fullName } from '@/lib/format'
import { toast } from '@/lib/toast'
import { analyticsKey } from '@/observability/telemetry'
import { useDeleteUser } from '@/queries/user-admin.queries'
import type { DeletionRequestRow } from '@/types/api.types'

const column = createColumnHelper<DataTableFeatures, DeletionRequestRow>()

/** A date, or "Unknown" for a value that is not one. */
function dateOf(iso: string): string {
  return formatDate(iso, 'medium') ?? 'Unknown'
}

/** Whether the due date has passed. */
function isOverdue(row: DeletionRequestRow): boolean {
  const due = new Date(row.dueAt).getTime()
  return !Number.isNaN(due) && due < Date.now()
}

/**
 * The delete button and its dialog. The reason is the request id, the only thing express's
 * audit holds, so the customer's own words never reach it. A refusal (the last owner of a
 * workspace, or a requester who still pays) shows inside the dialog and keeps the row.
 */
function DeleteAccount({ row }: { row: DeletionRequestRow }) {
  const [open, setOpen] = useState(false)
  const stepUp = useStepUp()
  const remove = useDeleteUser()
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Delete account
      </Button>
      <ReasonDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete account"
        description={
          <>
            This deletes <Pii>{row.user.email}</Pii>, ends their sessions and completes their
            request. A platform owner can then delete the account permanently.
          </>
        }
        confirmLabel="Delete account"
        destructive
        confirmText={row.user.email}
        fixedReason={row.id}
        onConfirm={async (reason) => {
          await stepUp.run(() => remove.mutateAsync({ userId: row.user.id, reason }))
          toast.success('Account deleted.')
        }}
      />
    </>
  )
}

const columns = column.columns([
  column.display({
    id: 'person',
    header: 'Person',
    cell: ({ row }) => {
      const { user } = row.original
      const name = fullName(user)
      return (
        <Link
          to={ROUTES.user}
          params={{ userId: user.id }}
          className="grid font-medium underline-offset-4 hover:underline"
        >
          {name !== null && <Pii>{name}</Pii>}
          <Pii>{user.email}</Pii>
        </Link>
      )
    },
  }),
  column.accessor('requestedAt', {
    header: 'Requested',
    cell: ({ getValue }) => <time dateTime={getValue()}>{dateOf(getValue())}</time>,
  }),
  column.accessor('dueAt', {
    header: 'Due',
    meta: { sorts: ['due', '-due'], sortName: analyticsKey('due'), sortWords: 'date' },
    cell: ({ getValue, row }) => (
      <span className="flex items-center gap-2">
        <time dateTime={getValue()}>{dateOf(getValue())}</time>
        {isOverdue(row.original) && <Badge variant="destructive">Overdue</Badge>}
      </span>
    ),
  }),
  column.display({
    id: 'soleOwnerOf',
    header: 'Sole owner of',
    cell: ({ row }) => {
      const names = row.original.soleOwnedWorkspaces.map((workspace) => workspace.name)
      return names.length === 0 ? (
        <span className="text-muted-foreground">None</span>
      ) : (
        names.join(', ')
      )
    },
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <DeleteAccount row={row.original} />,
  }),
])

/** The open deletion requests, soonest due first unless sorted by the Due header, paged by the API's cursor. */
export function DeletionRequestsTable({
  query,
  empty,
}: {
  query: ListQueryState<DeletionRequestRow>
  empty: ReactNode
}) {
  return (
    <DataTable
      columns={columns}
      query={query}
      label="Deletion requests"
      getRowId={(row) => row.id}
      errorMessage="We couldn’t load the deletion requests. Select Try again."
      empty={empty}
    />
  )
}
