import { IconAlertCircle, IconDots, IconInfoCircle } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState, type ComponentProps, type RefObject } from 'react'
import { ReasonDialog } from '@/components/features/reason-dialog'
import { EditUserNameDialog } from '@/components/features/users/edit-user-name-dialog'
import { BusyButton } from '@/components/shared/busy-button'
import { usePaletteCommands } from '@/components/shared/command-palette/palette-registry'
import type { PaletteCommand } from '@/components/shared/command-palette/palette-types'
import { Pii } from '@/components/shared/pii'
import { Alert, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
import { availableUserActions, SIGN_IN_LINK_NOT_SENT, type UserAction } from '@/lib/user-actions'
import { analyticsKey, type AnalyticsKey } from '@/observability/telemetry'
import {
  useDeactivateUser,
  useDeleteUser,
  usePurgeUser,
  useReactivateUser,
  useSendSignInLink,
  useSignOutUser,
} from '@/queries/user-admin.queries'
import { useAuthStore } from '@/states/auth.store'
import type { PlatformUserDetail } from '@/types/api.types'

/** Which action's dialog is open, if any. */
type OpenDialog =
  'edit' | 'signInLink' | 'signOut' | 'deactivate' | 'reactivate' | 'delete' | 'purge' | null

/** The menu's order, which the palette lists them in too. */
const MENU_ORDER: readonly UserAction[] = [
  'edit',
  'signInLink',
  'signOut',
  'deactivate',
  'reactivate',
  'delete',
  'purge',
]

/** The fixed key the palette sends for each action; mapped, never built from the camelCase name. */
const PALETTE_ACTION_KEYS: Record<UserAction, AnalyticsKey> = {
  edit: analyticsKey('page_action_edit'),
  signInLink: analyticsKey('page_action_send_sign_in_link'),
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

  const allowed = availableUserActions({ id: me?.id ?? '', platformRole: me?.platformRole }, user)

  const keepFocusOnPage = useMemo(() => focusFallbackOnRemoval(fallbackFocus), [fallbackFocus])

  /** The dialogs' `onOpenChange`: any close clears the open dialog. */
  const close = (open: boolean) => {
    if (!open) setDialog(null)
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

  /** What each allowed action does from the palette: the same dialog the menu opens. */
  const paletteRuns: Record<UserAction, Pick<PaletteCommand, 'label' | 'timing' | 'run'>> = {
    edit: { label: 'Edit name', timing: 'afterClose', run: () => dialogFromPalette('edit') },
    signInLink: {
      label: 'Send sign-in link',
      timing: 'afterClose',
      run: () => dialogFromPalette('signInLink'),
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
            {allowed.has('signInLink') && (
              <DropdownMenuItem onClick={() => openFromMenu('signInLink')}>
                Send sign-in link
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

      {dialog === 'edit' && (
        <EditUserNameDialog
          user={user}
          open
          onOpenChange={close}
          finalFocus={fromPalette ? fallbackFocus : undefined}
        />
      )}
      <SendSignInLinkDialog
        user={user}
        open={dialog === 'signInLink'}
        onOpenChange={close}
        finalFocus={finalFocus}
      />
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

/**
 * Confirms a staff-sent sign-in link: no reason and no step-up, as the API
 * takes neither. Staff get a link to Apex and anyone else one to the customer
 * app, as the API decides. A refusal, or an email that did not go, shows
 * inside the dialog, which stays open so Send link can try again; a sent
 * email closes it with a toast.
 */
function SendSignInLinkDialog({
  user,
  open,
  onOpenChange,
  finalFocus,
}: {
  user: PlatformUserDetail
  open: boolean
  onOpenChange: (open: boolean) => void
  finalFocus?: ComponentProps<typeof AlertDialogContent>['finalFocus']
}) {
  const send = useSendSignInLink()
  const [refusal, setRefusal] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const target = user.platformRole === null ? 'the customer app' : 'Apex'

  /** Posts the request and reports its outcome. */
  const confirm = async () => {
    setRefusal(null)
    setNotice(null)
    try {
      const { emailSent } = await send.mutateAsync({ userId: user.id })
      if (!emailSent) {
        setNotice(SIGN_IN_LINK_NOT_SENT)
        return
      }
      toast.success(
        <>
          Sign-in link sent to <Pii>{user.email}</Pii>.
        </>
      )
      onOpenChange(false)
    } catch (error) {
      setRefusal(messageFrom(error))
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && send.isPending) return
        if (!next) {
          setRefusal(null)
          setNotice(null)
        }
        onOpenChange(next)
      }}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>Send a sign-in link?</AlertDialogTitle>
          <AlertDialogDescription>
            We email <Pii>{user.email}</Pii> a link that signs them in to {target}. It works once
            and expires in 15 minutes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {refusal !== null && (
          <Alert variant="destructive">
            <IconAlertCircle aria-hidden="true" />
            <AlertTitle>
              <Pii>{refusal}</Pii>
            </AlertTitle>
          </Alert>
        )}
        {notice !== null && (
          <Alert>
            <IconInfoCircle aria-hidden="true" />
            <AlertTitle>{notice}</AlertTitle>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <BusyButton
            busy={send.isPending}
            busyLabel="Sending…"
            type="button"
            onClick={() => void confirm()}
          >
            Send link
          </BusyButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
