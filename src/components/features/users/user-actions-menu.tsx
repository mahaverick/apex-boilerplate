import { useNavigate } from '@tanstack/react-router'
import { MoreHorizontal } from 'lucide-react'
import { useMemo, useState, type RefObject } from 'react'
import { toast } from 'sonner'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { EditUserNameDialog } from '@/components/features/users/edit-user-name-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ROUTES } from '@/constants/routes'
import { useStepUp } from '@/hooks/use-step-up'
import { messageFrom } from '@/lib/api-error'
import { availableUserActions } from '@/lib/user-actions'
import {
  useDeactivateUser,
  useDeleteUser,
  usePurgeUser,
  useReactivateUser,
  useResendVerification,
  useSendPasswordSetup,
  useSignOutUser,
} from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformUserDetail } from '@/types/api.types'

/**
 * A ref callback for the menu trigger. An action can leave nothing to offer
 * (an admin soft-deletes an account), which unmounts the trigger just after
 * its closing dialog handed focus back to it; focus then moves to `fallback`
 * rather than to <body>.
 */
function focusFallbackOnRemoval(fallback: RefObject<HTMLElement | null> | undefined) {
  return (node: HTMLButtonElement | null) => () => {
    if (node !== null && document.activeElement === node) fallback?.current?.focus()
  }
}

type OpenDialog = 'edit' | 'signOut' | 'deactivate' | 'reactivate' | 'delete' | 'purge' | null

/**
 * The actions the API would accept from the signed-in staff member on this
 * user (`availableUserActions`); none at all renders no menu. Deactivate,
 * delete and permanent deletion run through step-up, so a stale sign-in asks
 * who you are and retries once instead of failing.
 */
export function UserActionsMenu({
  user,
  fallbackFocus,
}: {
  user: PlatformUserDetail
  /** Where focus goes when an action removes this menu's trigger while it holds focus. */
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const me = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const stepUp = useStepUp()
  const [dialog, setDialog] = useState<OpenDialog>(null)
  const deactivate = useDeactivateUser()
  const reactivate = useReactivateUser()
  const signOut = useSignOutUser()
  const remove = useDeleteUser()
  const purge = usePurgeUser({
    onPurged: () => navigate({ to: ROUTES.users, search: { status: 'deleted' } }),
  })
  const passwordSetup = useSendPasswordSetup()
  const resendVerification = useResendVerification()

  const allowed = availableUserActions({ id: me?.id ?? '', platformRole: me?.platformRole }, user)

  const keepFocusOnPage = useMemo(() => focusFallbackOnRemoval(fallbackFocus), [fallbackFocus])

  const close = (open: boolean) => {
    if (!open) setDialog(null)
  }

  function mail(send: typeof passwordSetup, sentMessage: string) {
    send.mutate(
      { userId: user.id },
      {
        onSuccess: ({ emailSent }) => {
          if (emailSent) toast.success(sentMessage)
          else toast.warning('The email could not be sent. Try again shortly.')
        },
        onError: (error) => toast.error(messageFrom(error)),
      }
    )
  }

  const hasStateChange =
    allowed.has('signOut') || allowed.has('deactivate') || allowed.has('reactivate')

  return (
    <>
      {allowed.size > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                ref={keepFocusOnPage}
                variant="outline"
                size="sm"
                aria-label={`Actions for ${user.email}`}
              />
            }
          >
            <MoreHorizontal aria-hidden />
            Actions
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {allowed.has('edit') && (
              <DropdownMenuItem onClick={() => setDialog('edit')}>Edit name</DropdownMenuItem>
            )}
            {allowed.has('passwordSetup') && (
              <DropdownMenuItem
                onClick={() =>
                  mail(
                    passwordSetup,
                    user.hasPassword ? 'Password reset email sent.' : 'Set-password email sent.'
                  )
                }
              >
                {user.hasPassword ? 'Send password reset link' : 'Send set-password link'}
              </DropdownMenuItem>
            )}
            {allowed.has('resendVerification') && (
              <DropdownMenuItem
                onClick={() => mail(resendVerification, 'Verification email sent.')}
              >
                Resend verification email
              </DropdownMenuItem>
            )}
            {hasStateChange && <DropdownMenuSeparator />}
            {allowed.has('signOut') && (
              <DropdownMenuItem onClick={() => setDialog('signOut')}>
                Sign out everywhere
              </DropdownMenuItem>
            )}
            {allowed.has('deactivate') && (
              <DropdownMenuItem variant="destructive" onClick={() => setDialog('deactivate')}>
                Deactivate
              </DropdownMenuItem>
            )}
            {allowed.has('reactivate') && (
              <DropdownMenuItem onClick={() => setDialog('reactivate')}>
                Reactivate
              </DropdownMenuItem>
            )}
            {allowed.has('delete') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setDialog('delete')}>
                  Delete
                </DropdownMenuItem>
              </>
            )}
            {allowed.has('purge') && (
              <DropdownMenuItem variant="destructive" onClick={() => setDialog('purge')}>
                Delete permanently
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {dialog === 'edit' && <EditUserNameDialog user={user} open onOpenChange={close} />}
      <ReasonDialog
        open={dialog === 'signOut'}
        onOpenChange={close}
        title="Sign out everywhere"
        description={`Ends every session ${user.email} has. They can sign in again.`}
        confirmLabel="Sign out everywhere"
        onConfirm={async (reason) => {
          await signOut.mutateAsync({ userId: user.id, reason })
          toast.success('Signed out everywhere.')
        }}
      />
      <ReasonDialog
        open={dialog === 'deactivate'}
        onOpenChange={close}
        title="Deactivate account"
        description={`${user.email} is signed out everywhere and can’t sign in until the account is reactivated.`}
        confirmLabel="Deactivate"
        destructive
        onConfirm={async (reason) => {
          await stepUp.run(() => deactivate.mutateAsync({ userId: user.id, reason }))
          toast.success('Account deactivated.')
        }}
      />
      <ReasonDialog
        open={dialog === 'reactivate'}
        onOpenChange={close}
        title="Reactivate account"
        description={`${user.email} can sign in again.`}
        confirmLabel="Reactivate"
        onConfirm={async (reason) => {
          await reactivate.mutateAsync({ userId: user.id, reason })
          toast.success('Account reactivated.')
        }}
      />
      <ReasonDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        title="Delete user"
        description={`This deletes ${user.email}, ends their sessions, removes their Google sign-in link and revokes invitations they sent. The address can register again. A platform owner can then delete the account permanently.`}
        confirmLabel="Delete user"
        destructive
        confirmText={user.email}
        onConfirm={async (reason) => {
          await stepUp.run(() => remove.mutateAsync({ userId: user.id, reason }))
          toast.success('User deleted.')
        }}
      />
      <ReasonDialog
        open={dialog === 'purge'}
        onOpenChange={close}
        title="Permanently delete this account?"
        description={`This removes ${user.email}'s account, memberships and sign-in records for good, and anonymises their entries in the audit log. It can’t be undone.`}
        confirmLabel="Delete permanently"
        destructive
        confirmText={user.email}
        onConfirm={async (reason) => {
          await stepUp.run(() => purge.mutateAsync({ userId: user.id, reason }))
          toast.success('Account permanently deleted.')
        }}
      />
    </>
  )
}
