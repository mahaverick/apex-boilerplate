import { IconDots } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState, type RefObject } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { EditUserNameDialog } from '@/components/features/users/edit-user-name-dialog'
import { usePaletteCommands } from '@/components/shared/command-palette/palette-registry'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'
import { Pii } from '@/components/shared/pii'
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
import { focusFallbackOnRemoval } from '@/lib/focus-fallback'
import { toast } from '@/lib/toast'
import { availableUserActions, type UserAction } from '@/lib/user-actions'
import { analyticsKey, type AnalyticsKey } from '@/observability/telemetry'
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

/** Which action's dialog is open, if any. */
type OpenDialog = 'edit' | 'signOut' | 'deactivate' | 'reactivate' | 'delete' | 'purge' | null

/** The menu's order, which the palette lists them in too. */
const MENU_ORDER: readonly UserAction[] = [
  'edit',
  'passwordSetup',
  'resendVerification',
  'signOut',
  'deactivate',
  'reactivate',
  'delete',
  'purge',
]

/** The fixed key the palette sends for each action; mapped, never built from the camelCase name. */
const PALETTE_ACTION_KEYS: Record<UserAction, AnalyticsKey> = {
  edit: analyticsKey('page_action_edit'),
  passwordSetup: analyticsKey('page_action_password_setup'),
  resendVerification: analyticsKey('page_action_resend_verification'),
  signOut: analyticsKey('page_action_sign_out'),
  deactivate: analyticsKey('page_action_deactivate'),
  reactivate: analyticsKey('page_action_reactivate'),
  delete: analyticsKey('page_action_delete'),
  purge: analyticsKey('page_action_purge'),
}

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
  /** Where focus goes when an action leaves this menu no option, so its trigger is gone. */
  fallbackFocus?: RefObject<HTMLElement | null>
}) {
  const me = useAuthStore((state) => state.user)
  const navigate = useNavigate()
  const stepUp = useStepUp()
  const [dialog, setDialog] = useState<OpenDialog>(null)
  /** Whether the open dialog came from the palette, whose close has already moved focus. */
  const [fromPalette, setFromPalette] = useState(false)
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

  /** The dialogs' `onOpenChange`: any close clears the open dialog. */
  const close = (open: boolean) => {
    if (!open) setDialog(null)
  }

  /** Sends a staff-triggered account email and toasts the outcome. */
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

  const finalFocus = allowed.size > 0 && !fromPalette ? undefined : fallbackFocus

  /** Opens an action's dialog from the menu, whose trigger takes focus back on close. */
  const openFromMenu = (which: Exclude<OpenDialog, null>) => {
    setFromPalette(false)
    setDialog(which)
  }

  /** Opens an action's dialog for the palette, once the palette has closed. */
  const dialogFromPalette = (which: Exclude<OpenDialog, null>) => {
    setFromPalette(true)
    setDialog(which)
  }

  const passwordSetupLabel = user.hasPassword
    ? 'Send password reset link'
    : 'Send set-password link'
  /** What each allowed action does from the palette: the same dialog, or the same email the menu sends. */
  const paletteRuns: Record<UserAction, Pick<PaletteCommand, 'label' | 'timing' | 'run'>> = {
    edit: { label: 'Edit name', timing: 'afterClose', run: () => dialogFromPalette('edit') },
    passwordSetup: {
      label: passwordSetupLabel,
      timing: 'immediate',
      run: () =>
        mail(
          passwordSetup,
          user.hasPassword ? 'Password reset email sent.' : 'Set-password email sent.'
        ),
    },
    resendVerification: {
      label: 'Resend verification email',
      timing: 'immediate',
      run: () => mail(resendVerification, 'Verification email sent.'),
    },
    signOut: {
      label: 'Sign out everywhere',
      timing: 'afterClose',
      run: () => dialogFromPalette('signOut'),
    },
    deactivate: {
      label: 'Deactivate',
      timing: 'afterClose',
      run: () => dialogFromPalette('deactivate'),
    },
    reactivate: {
      label: 'Reactivate',
      timing: 'afterClose',
      run: () => dialogFromPalette('reactivate'),
    },
    delete: { label: 'Delete', timing: 'afterClose', run: () => dialogFromPalette('delete') },
    purge: {
      label: 'Delete permanently',
      timing: 'afterClose',
      run: () => dialogFromPalette('purge'),
    },
  }

  usePaletteCommands(
    'user-actions',
    MENU_ORDER.filter((key) => allowed.has(key)).map((key): PaletteCommand => ({
      id: key,
      action: PALETTE_ACTION_KEYS[key],
      ...paletteRuns[key],
    }))
  )

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
            <IconDots aria-hidden="true" />
            Actions
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56">
            {allowed.has('edit') && (
              <DropdownMenuItem onClick={() => openFromMenu('edit')}>Edit name</DropdownMenuItem>
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
                {passwordSetupLabel}
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
              <DropdownMenuItem onClick={() => openFromMenu('signOut')}>
                Sign out everywhere
              </DropdownMenuItem>
            )}
            {allowed.has('deactivate') && (
              <DropdownMenuItem variant="destructive" onClick={() => openFromMenu('deactivate')}>
                Deactivate
              </DropdownMenuItem>
            )}
            {allowed.has('reactivate') && (
              <DropdownMenuItem onClick={() => openFromMenu('reactivate')}>
                Reactivate
              </DropdownMenuItem>
            )}
            {allowed.has('delete') && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => openFromMenu('delete')}>
                  Delete
                </DropdownMenuItem>
              </>
            )}
            {allowed.has('purge') && (
              <DropdownMenuItem variant="destructive" onClick={() => openFromMenu('purge')}>
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
        finalFocus={finalFocus}
        title="Sign out everywhere"
        description={
          <>
            Ends every session <Pii>{user.email}</Pii> has. They can sign in again.
          </>
        }
        confirmLabel="Sign out everywhere"
        onConfirm={async (reason) => {
          await signOut.mutateAsync({ userId: user.id, reason })
          toast.success('Signed out everywhere.')
        }}
      />
      <ReasonDialog
        open={dialog === 'deactivate'}
        onOpenChange={close}
        finalFocus={finalFocus}
        title="Deactivate account"
        description={
          <>
            <Pii>{user.email}</Pii> is signed out everywhere and can’t sign in until the account is
            reactivated.
          </>
        }
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
        finalFocus={finalFocus}
        title="Reactivate account"
        description={
          <>
            <Pii>{user.email}</Pii> can sign in again.
          </>
        }
        confirmLabel="Reactivate"
        onConfirm={async (reason) => {
          await reactivate.mutateAsync({ userId: user.id, reason })
          toast.success('Account reactivated.')
        }}
      />
      <ReasonDialog
        open={dialog === 'delete'}
        onOpenChange={close}
        finalFocus={finalFocus}
        title="Delete user"
        description={
          <>
            This deletes <Pii>{user.email}</Pii>, ends their sessions, removes their Google sign-in
            link and revokes invitations they sent. The address can register again. A platform owner
            can then delete the account permanently.
          </>
        }
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
        finalFocus={finalFocus}
        title="Permanently delete this account?"
        description={
          <>
            This removes <Pii>{user.email}</Pii>’s account, memberships and sign-in records for
            good, and anonymises their entries in the audit log. It can’t be undone.
          </>
        }
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
