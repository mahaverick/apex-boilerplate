import { createColumnHelper } from '@tanstack/react-table'
import { createContext, useContext, useState } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { ROLE_FILTER } from '@/components/features/tenant/role-filter'
import { DataTable } from '@/components/shared/data-table/data-table'
import type { DataTableFeatures } from '@/components/shared/data-table/data-table-model'
import { useListQuery } from '@/components/shared/data-table/use-list-query'
import { useListSearch } from '@/components/shared/data-table/use-list-search'
import { EmptyState } from '@/components/shared/empty-state'
import { Pii } from '@/components/shared/pii'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from '@/components/ui/item'
import { canActorGrantRole, ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { formatDate } from '@/lib/format'
import { toast } from '@/lib/toast'
import { analyticsKey } from '@/observability/telemetry'
import { inviterName } from '@/queries/invitation.queries'
import { useResendInvitation, useRevokeInvitation } from '@/queries/tenant-writes.queries'
import { invitationsList, invitationsListOptions } from '@/queries/tenant.queries'
import { INVITATION_NOT_FOUND, type TenantInvitation } from '@/types/api.types'

/** Said of the request, not of the tenant: a failed load is not "none pending". */
const INVITATIONS_ERROR =
  'We could not load the pending invitations, so none are listed here. This is not a sign that there are none.'

/**
 * Why Resend and Revoke are off: both re-check `canActorGrantRole` against
 * the invitation's role, so an admin's resend or revoke of an owner or admin
 * invite is refused.
 */
const GRANT_REASON = 'Only an owner can resend or revoke an invitation for this role.'

/** Resend or revoke found the row accepted, revoked or expired meanwhile. */
const NO_LONGER_PENDING = 'That invitation is no longer pending.'

/**
 * What a failed resend or revoke tells the reader. Anything but the 404 is
 * the server's own message, a 403 for a role the actor can't grant included.
 * The list refetches either way (the hooks' `onSettled`).
 */
function actionFailure(error: unknown): string {
  return codeFrom(error) === INVITATION_NOT_FOUND ? NO_LONGER_PENDING : messageFrom(error)
}

/**
 * Waits for a staff resend or revoke. A 404, the invitation not pending
 * or the tenant out of reach, is said in the member buttons' words; every
 * other refusal rejects, for the reason dialog to show.
 * @param write - The write in flight.
 * @returns True when the write landed, false after a 404.
 */
async function landed(write: Promise<unknown>): Promise<boolean> {
  try {
    await write
    return true
  } catch (error) {
    if (statusFrom(error) !== 404) throw error
    toast.error(actionFailure(error))
    return false
  }
}

/** The expiry date, in the reader's own locale. */
function expiresOn(expiresAt: string): string {
  return formatDate(expiresAt, 'medium') ?? 'an unknown date'
}

/**
 * Resend and Revoke for a row whose role the actor may not grant, both
 * disabled and described by the row's one reason, shown as visible text: a
 * disabled button has `pointer-events: none`, so a tooltip on it would never
 * open.
 */
function LockedInvitationActions({ invitation }: { invitation: TenantInvitation }) {
  const reasonId = `invitation-reason-${invitation.id}`
  return (
    <div className="grid gap-1">
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-label={`Resend invitation to ${invitation.email}`}
          aria-describedby={reasonId}
        >
          Resend
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-label={`Revoke invitation to ${invitation.email}`}
          aria-describedby={reasonId}
        >
          Revoke
        </Button>
      </div>
      <p id={reasonId} className="text-xs text-muted-foreground">
        {GRANT_REASON}
      </p>
    </div>
  )
}

/**
 * Resend for one row, named after the invitee since there is one per row. It
 * uses `mutateAsync`, because the list refetch can unmount this row first and
 * `mutate`'s callbacks skip an unmounted observer.
 */
function ResendInvitationButton({
  slug,
  invitation,
  tenantId,
}: {
  slug: string
  invitation: TenantInvitation
  tenantId?: string
}) {
  const resend = useResendInvitation(slug, tenantId)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()

  return (
    <Button
      variant="outline"
      size="sm"
      // The refused resend is not pending while its step-up waits, so a second press would start another.
      disabled={resend.isPending || waiting}
      aria-label={`Resend invitation to ${invitation.email}`}
      onClick={() => {
        stepUp
          .run(() => resend.mutateAsync({ invitationId: invitation.id }))
          .then(
            () =>
              toast.success(
                <>
                  Invitation resent to <Pii>{invitation.email}</Pii>.
                </>
              ),
            (error: unknown) => toast.error(actionFailure(error))
          )
      }}
    >
      Resend
    </Button>
  )
}

/**
 * Revoke for one row, behind a confirmation; `mutateAsync` for the same reason
 * as resend. The row goes with a success, so `onRevoked` lets the list move
 * focus to its heading: this button is unmounted by then.
 */
function RevokeInvitationButton({
  slug,
  invitation,
  tenantId,
  onRevoked,
}: {
  slug: string
  invitation: TenantInvitation
  tenantId?: string
  onRevoked: () => void
}) {
  const revoke = useRevokeInvitation(slug, tenantId)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const [isOpen, setIsOpen] = useState(false)

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            disabled={revoke.isPending}
            aria-label={`Revoke invitation to ${invitation.email}`}
          >
            Revoke
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Revoke the invitation to <Pii>{invitation.email}</Pii>?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The link in their email stops working immediately. You can invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={revoke.isPending || waiting}
            onClick={() => {
              stepUp
                .run(() => revoke.mutateAsync({ invitationId: invitation.id }))
                .then(
                  () => {
                    setIsOpen(false)
                    onRevoked()
                    toast.success(
                      <>
                        Invitation to <Pii>{invitation.email}</Pii> revoked.
                      </>
                    )
                  },
                  (error: unknown) => {
                    setIsOpen(false)
                    toast.error(actionFailure(error))
                  }
                )
            }}
          >
            Revoke
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * Resend and Revoke for staff acting on a customer tenant through platform
 * access: each asks for the audited reason the API requires, in the reason
 * dialog every other staff write uses (step-up included), and shows a
 * refusal there. The words and toasts are the member buttons'. A 404 is the
 * exception: the hooks' `onSettled` refetch has dropped this row (an
 * invitation that is not pending) or the whole list (a tenant out of reach),
 * and the dialog with it, before the refusal arrives, so it is a toast and
 * the dialog closes.
 */
function StaffInvitationActions({
  slug,
  invitation,
  tenantId,
  onRevoked,
}: {
  slug: string
  invitation: TenantInvitation
  tenantId?: string
  onRevoked: () => void
}) {
  const resend = useResendInvitation(slug, tenantId)
  const revoke = useRevokeInvitation(slug, tenantId)
  const stepUp = useStepUp()
  const [open, setOpen] = useState<'resend' | 'revoke' | null>(null)
  /** The open state for one of the two dialogs. */
  const dialogProps = (which: 'resend' | 'revoke') => ({
    open: open === which,
    onOpenChange: (next: boolean) => setOpen(next ? which : null),
  })

  return (
    <div className="flex gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={resend.isPending}
        aria-label={`Resend invitation to ${invitation.email}`}
        onClick={() => setOpen('resend')}
      >
        Resend
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={revoke.isPending}
        aria-label={`Revoke invitation to ${invitation.email}`}
        onClick={() => setOpen('revoke')}
      >
        Revoke
      </Button>
      <ReasonDialog
        {...dialogProps('resend')}
        title="Resend this invitation?"
        description={
          <>
            A new link goes to <Pii>{invitation.email}</Pii>; the old one stops working.
          </>
        }
        confirmLabel="Resend"
        onConfirm={async (reason) => {
          const write = stepUp.run(() =>
            resend.mutateAsync({ invitationId: invitation.id, reason })
          )
          if (!(await landed(write))) return
          toast.success(
            <>
              Invitation resent to <Pii>{invitation.email}</Pii>.
            </>
          )
        }}
      />
      <ReasonDialog
        {...dialogProps('revoke')}
        title="Revoke this invitation?"
        description={
          <>
            The link sent to <Pii>{invitation.email}</Pii> stops working immediately. You can invite
            them again later.
          </>
        }
        confirmLabel="Revoke"
        destructive
        onConfirm={async (reason) => {
          const write = stepUp.run(() =>
            revoke.mutateAsync({ invitationId: invitation.id, reason })
          )
          if (!(await landed(write))) return
          onRevoked()
          toast.success(
            <>
              Invitation to <Pii>{invitation.email}</Pii> revoked.
            </>
          )
        }}
      />
    </div>
  )
}

/**
 * One invitation's Resend and Revoke, in the table's Actions cell and on the
 * phone card. They are offered only for a role the actor may grant
 * (`canActorGrantRole`), as the API checks; otherwise both are shown disabled
 * with the reason. Staff acting through platform access (`asStaff`) give an
 * audited reason for each.
 */
function InvitationActions({
  slug,
  invitation,
  myRole,
  asStaff,
  tenantId,
  onRevoked,
}: {
  slug: string
  invitation: TenantInvitation
  myRole: MembershipRole
  /** Acting through platform access: each action asks for a reason. */
  asStaff: boolean
  tenantId?: string
  onRevoked: () => void
}) {
  if (!canActorGrantRole(myRole, invitation.role)) {
    return <LockedInvitationActions invitation={invitation} />
  }
  if (asStaff) {
    return (
      <StaffInvitationActions
        slug={slug}
        invitation={invitation}
        tenantId={tenantId}
        onRevoked={onRevoked}
      />
    )
  }
  return (
    <div className="flex gap-2">
      <ResendInvitationButton slug={slug} invitation={invitation} tenantId={tenantId} />
      <RevokeInvitationButton
        slug={slug}
        invitation={invitation}
        tenantId={tenantId}
        onRevoked={onRevoked}
      />
    </div>
  )
}

/**
 * One pending invitation as a stacked card, for phones, where the scrolling
 * table puts the Actions column off-screen. The actions are the table
 * cells' own.
 */
function InvitationItem({
  slug,
  invitation,
  myRole,
  asStaff,
  tenantId,
  onRevoked,
}: {
  slug: string
  invitation: TenantInvitation
  myRole: MembershipRole
  /** Acting through platform access: each action asks for a reason. */
  asStaff: boolean
  tenantId?: string
  onRevoked: () => void
}) {
  return (
    <Item variant="outline" role="listitem">
      <ItemContent className="min-w-0">
        <ItemTitle className="line-clamp-none">
          <Pii className="break-all">{invitation.email}</Pii>
        </ItemTitle>
        <ItemDescription className="line-clamp-none">
          {ROLE_LABELS[invitation.role]} · Invited by <Pii>{inviterName(invitation.invitedBy)}</Pii>
        </ItemDescription>
        <ItemDescription className="line-clamp-none">
          Expires {expiresOn(invitation.expiresAt)}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <InvitationActions
          slug={slug}
          invitation={invitation}
          myRole={myRole}
          asStaff={asStaff}
          tenantId={tenantId}
          onRevoked={onRevoked}
        />
      </ItemActions>
    </Item>
  )
}

/** What the invitations card hands its cells: the tenant, the caller's role and the revoke callback. */
interface InvitationsCardContext {
  slug: string
  myRole: MembershipRole
  asStaff: boolean
  tenantId?: string
  onRevoked: () => void
}

const InvitationsCardScope = createContext<InvitationsCardContext | null>(null)

/**
 * The table's Actions cell. The columns are module-level, so the cell reads
 * what changes between renders from context, and re-renders in place rather
 * than remounting with its dialog state.
 */
function InvitationActionsCell({ invitation }: { invitation: TenantInvitation }) {
  const card = useContext(InvitationsCardScope)
  if (card === null) throw new Error('An invitation cell renders inside the invitations card.')
  return <InvitationActions {...card} invitation={invitation} />
}

const column = createColumnHelper<DataTableFeatures, TenantInvitation>()

/** The email, role, sent, expiry and actions columns. */
const INVITATION_COLUMNS = column.columns([
  column.accessor('email', {
    header: 'Email',
    meta: { sorts: ['email'], sortName: analyticsKey('email') },
    cell: ({ getValue }) => <Pii className="break-all">{getValue()}</Pii>,
  }),
  column.accessor('role', { header: 'Role', cell: ({ getValue }) => ROLE_LABELS[getValue()] }),
  column.accessor('createdAt', {
    header: 'Invited',
    meta: { sorts: ['-created'], sortName: analyticsKey('created'), sortWords: 'date' },
    cell: ({ row }) => (
      <span className="grid">
        <span>{formatDate(row.original.createdAt, 'medium') ?? 'Unknown'}</span>
        <span className="text-xs text-muted-foreground">
          by <Pii>{inviterName(row.original.invitedBy)}</Pii>
        </span>
      </span>
    ),
  }),
  column.accessor('expiresAt', {
    header: 'Expires',
    cell: ({ getValue }) => expiresOn(getValue()),
  }),
  column.display({
    id: 'actions',
    header: () => <span className="sr-only">Actions</span>,
    meta: { label: 'Actions', actions: true },
    cell: ({ row }) => <InvitationActionsCell invitation={row.original} />,
  }),
])

/**
 * Invitations sent and not yet accepted. Mount it for owners and admins
 * only: the list endpoint is `requireRole('owner', 'admin')`, and mounting it
 * is what issues the request. A successful revoke moves focus to this heading,
 * since the row that held the button is gone. The list is a table, or cards on
 * a phone; its failure copy, empty state and loading are `DataTable`'s.
 */
export function PendingInvitations({
  slug,
  myRole,
  asStaff = false,
  tenantId,
}: {
  slug: string
  myRole: MembershipRole
  /** Acting through platform access (`access: 'platform'`): each action asks for a reason. */
  asStaff?: boolean
  tenantId?: string
}) {
  const list = useListSearch(invitationsList)
  const invitations = useListQuery(list, (request) =>
    invitationsListOptions(slug, tenantId, request)
  )
  const focus = useFocusAfter<'heading'>()
  /** Moves focus to the card heading once a revoke has taken the acted-on row away. */
  const focusHeading = () => focus.focusAfter('heading')

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 ref={focus.target('heading')} tabIndex={-1} className="outline-none">
            Pending invitations
          </h2>
        </CardTitle>
        <CardDescription>Sent, and not yet accepted.</CardDescription>
      </CardHeader>
      <CardContent>
        <InvitationsCardScope value={{ slug, myRole, asStaff, tenantId, onRevoked: focusHeading }}>
          <DataTable
            columns={INVITATION_COLUMNS}
            query={invitations}
            label="Pending invitations"
            errorMessage={INVITATIONS_ERROR}
            getRowId={(invitation) => invitation.id}
            search={{ label: 'Search invitations', placeholder: 'Search by email' }}
            filters={[ROLE_FILTER]}
            card={(invitation) => (
              <InvitationItem
                key={invitation.id}
                slug={slug}
                invitation={invitation}
                myRole={myRole}
                asStaff={asStaff}
                tenantId={tenantId}
                onRevoked={focusHeading}
              />
            )}
            empty={<EmptyState size="compact" title="No invitations are waiting to be accepted." />}
          />
        </InvitationsCardScope>
      </CardContent>
    </Card>
  )
}
