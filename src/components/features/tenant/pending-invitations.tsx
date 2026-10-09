import { useState } from 'react'
import { toast } from 'sonner'
import { LoadError } from '@/components/features/load-error'
import { ReasonDialog } from '@/components/features/reason-dialog'
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
import { Skeleton } from '@/components/ui/skeleton'
import { canActorGrantRole, ROLE_LABELS, type MembershipRole } from '@/constants/roles'
import { useFocusAfter } from '@/hooks/use-focus-after'
import { useStepUp } from '@/hooks/use-step-up'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { formatDate } from '@/lib/format'
import { inviterName } from '@/queries/invitation.queries'
import { useResendInvitation, useRevokeInvitation } from '@/queries/tenant-writes.queries'
import { useInvitations } from '@/queries/tenant.queries'
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
 * Waits for a staff resend or revoke. One that found the invitation no longer
 * pending is said in the member buttons' words; every other refusal rejects,
 * for the reason dialog to show.
 * @param write - The write in flight.
 * @returns True when the write landed, false when the invitation was no longer pending.
 */
async function landed(write: Promise<unknown>): Promise<boolean> {
  try {
    await write
    return true
  } catch (error) {
    if (codeFrom(error) !== INVITATION_NOT_FOUND) throw error
    toast.error(NO_LONGER_PENDING)
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

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={resend.isPending}
      aria-label={`Resend invitation to ${invitation.email}`}
      onClick={() => {
        stepUp
          .run(() => resend.mutateAsync({ invitationId: invitation.id }))
          .then(
            () => toast.success(<Pii>{`Invitation resent to ${invitation.email}.`}</Pii>),
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
            <Pii>{`Revoke the invitation to ${invitation.email}?`}</Pii>
          </AlertDialogTitle>
          <AlertDialogDescription>
            The link in their email stops working immediately. You can invite them again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={revoke.isPending}
            onClick={() => {
              stepUp
                .run(() => revoke.mutateAsync({ invitationId: invitation.id }))
                .then(
                  () => {
                    setIsOpen(false)
                    onRevoked()
                    toast.success(<Pii>{`Invitation to ${invitation.email} revoked.`}</Pii>)
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
 * refusal there. The words and toasts are the member buttons'. An invitation
 * no longer pending is the exception: the hooks' `onSettled` refetch has
 * dropped this row, and the dialog with it, before the refusal arrives, so
 * it is a toast and the dialog closes.
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
        description={`A new link goes to ${invitation.email}; the old one stops working.`}
        confirmLabel="Resend"
        onConfirm={async (reason) => {
          const write = stepUp.run(() =>
            resend.mutateAsync({ invitationId: invitation.id, reason })
          )
          if (!(await landed(write))) return
          toast.success(<Pii>{`Invitation resent to ${invitation.email}.`}</Pii>)
        }}
      />
      <ReasonDialog
        {...dialogProps('revoke')}
        title="Revoke this invitation?"
        description={`The link sent to ${invitation.email} stops working immediately. You can invite them again later.`}
        confirmLabel="Revoke"
        destructive
        onConfirm={async (reason) => {
          const write = stepUp.run(() =>
            revoke.mutateAsync({ invitationId: invitation.id, reason })
          )
          if (!(await landed(write))) return
          onRevoked()
          toast.success(<Pii>{`Invitation to ${invitation.email} revoked.`}</Pii>)
        }}
      />
    </div>
  )
}

/**
 * One pending invitation. Resend and Revoke are offered only for a role the
 * actor may grant (`canActorGrantRole`), as the API checks; otherwise both
 * are shown disabled with the reason.
 *
 * A stacked item at every width rather than a table row with a card twin:
 * one render path keeps every id unique, and there is no fixed-width table
 * to scroll off a phone screen.
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
    <li className="grid gap-3 rounded-lg border p-4 sm:flex sm:items-center sm:justify-between">
      <div className="grid min-w-0 gap-0.5">
        <Pii className="font-medium break-all">{invitation.email}</Pii>
        <Pii className="text-sm text-muted-foreground">
          {ROLE_LABELS[invitation.role]} · Invited by {inviterName(invitation.invitedBy)}
        </Pii>
        <span className="text-sm text-muted-foreground">
          Expires {expiresOn(invitation.expiresAt)}
        </span>
      </div>
      {!canActorGrantRole(myRole, invitation.role) ? (
        <LockedInvitationActions invitation={invitation} />
      ) : asStaff ? (
        <StaffInvitationActions
          slug={slug}
          invitation={invitation}
          tenantId={tenantId}
          onRevoked={onRevoked}
        />
      ) : (
        <div className="flex gap-2">
          <ResendInvitationButton slug={slug} invitation={invitation} tenantId={tenantId} />
          <RevokeInvitationButton
            slug={slug}
            invitation={invitation}
            tenantId={tenantId}
            onRevoked={onRevoked}
          />
        </div>
      )}
    </li>
  )
}

/**
 * Invitations sent and not yet accepted. Mount it for owners and admins
 * only: the list endpoint is `requireRole('owner', 'admin')`, and mounting it
 * is what issues the request.
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
  const invitations = useInvitations(slug, tenantId)
  const focus = useFocusAfter<'heading'>()
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
        {invitations.isError ? (
          <LoadError message={INVITATIONS_ERROR} onRetry={() => void invitations.refetch()} />
        ) : invitations.isPending ? (
          <div className="grid gap-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : invitations.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No invitations are waiting to be accepted.
          </p>
        ) : (
          <ul className="grid gap-3">
            {invitations.data.map((invitation) => (
              <InvitationItem
                key={invitation.id}
                slug={slug}
                invitation={invitation}
                myRole={myRole}
                asStaff={asStaff}
                tenantId={tenantId}
                onRevoked={focusHeading}
              />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
