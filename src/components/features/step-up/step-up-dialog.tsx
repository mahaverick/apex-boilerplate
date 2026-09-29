import { useForm } from '@tanstack/react-form'
import { Link } from '@tanstack/react-router'
import { useRef } from 'react'
import { z } from 'zod'
import { LoadError } from '@/components/features/load-error'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/constants/routes'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { useAuthProviders, useReauthenticate } from '@/queries/auth.queries'

const passwordSchema = z.object({ password: z.string().min(1, 'Enter your password.') })

/**
 * Where focus goes when the step-up closes: into the dialog still open
 * beneath it (the reason dialog waiting on this confirmation), at its first
 * enabled field, else onto that dialog's popup. Base UI's default sent focus
 * outside it (to the page's Actions trigger in a browser, to `<body>` in
 * jsdom), behind a modal that is still open. With no dialog open beneath,
 * the default stands.
 * @param self - The step-up's own popup, excluded from the search.
 * @returns The element to focus, or `true` for Base UI's default.
 */
function focusBeneath(self: HTMLElement | null): HTMLElement | true {
  const beneath = [
    ...document.querySelectorAll<HTMLElement>(
      '[role="dialog"][data-open], [role="alertdialog"][data-open]'
    ),
  ].filter((popup) => popup !== self && !self?.contains(popup))
  const popup = beneath.at(-1)
  if (!popup) return true
  return (
    popup.querySelector<HTMLElement>(
      'input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
    ) ?? popup
  )
}

/**
 * "Confirm it's you". The body mounts only while open, so the sign-in
 * methods are fetched when a step-up actually happens and the form starts
 * empty every time. Closing it any way other than a successful confirmation
 * (Escape, the overlay, Cancel) is a dismissal.
 */
export function StepUpDialog({
  open,
  onConfirmed,
  onDismissed,
}: {
  open: boolean
  onConfirmed: () => void
  onDismissed: () => void
}) {
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onDismissed()
      }}
    >
      <DialogContent
        ref={popup}
        showCloseButton={false}
        finalFocus={() => focusBeneath(popup.current)}
      >
        <DialogHeader>
          <DialogTitle>Confirm it’s you</DialogTitle>
          <DialogDescription>
            This action needs a recent sign-in. Confirm who you are to continue.
          </DialogDescription>
        </DialogHeader>
        {open && <StepUpBody onConfirmed={onConfirmed} onDismissed={onDismissed} />}
      </DialogContent>
    </Dialog>
  )
}

function StepUpBody({
  onConfirmed,
  onDismissed,
}: {
  onConfirmed: () => void
  onDismissed: () => void
}) {
  const providers = useAuthProviders()
  if (providers.isPending) return <Skeleton className="h-24 w-full" />
  if (providers.isError) {
    return (
      <LoadError
        message="We could not load your sign-in methods."
        onRetry={() => void providers.refetch()}
      />
    )
  }
  return providers.data.hasPassword ? (
    <PasswordStepUp onConfirmed={onConfirmed} onDismissed={onDismissed} />
  ) : (
    <NoPasswordStepUp onDismissed={onDismissed} />
  )
}

function PasswordStepUp({
  onConfirmed,
  onDismissed,
}: {
  onConfirmed: () => void
  onDismissed: () => void
}) {
  const reauthenticate = useReauthenticate()
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { password: '' },
    validators: { onSubmit: passwordSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await reauthenticate.mutateAsync(value.password)
        onConfirmed()
      } catch (error) {
        // The API's 400s here (wrong password) name the one field there is.
        if (statusFrom(error) === 400) {
          serverErrors.setFieldError('password', [messageFrom(error)])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors} className="grid gap-4">
      <FormField form={form} name="password">
        {(field) => (
          <FormItem>
            <FormLabel>Password</FormLabel>
            <FormControl>
              <Input
                type="password"
                autoComplete="current-password"
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <FormError />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDismissed}>
          Cancel
        </Button>
        <Button type="submit" disabled={reauthenticate.isPending}>
          {reauthenticate.isPending ? 'Confirming…' : 'Confirm'}
        </Button>
      </DialogFooter>
    </Form>
  )
}

/**
 * An account without a password can't confirm who it is here: the API
 * confirms by password only. Forgot password on the sign-in page sets one;
 * Profile lists the account's sign-in methods and says the same.
 */
function NoPasswordStepUp({ onDismissed }: { onDismissed: () => void }) {
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        This account signs in with Google and has no password. Set a password to confirm sensitive
        actions: use Forgot password on the sign-in page, then repeat the action.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDismissed}>
          Close
        </Button>
        <Link to={ROUTES.profile} className={buttonVariants()} onClick={onDismissed}>
          Go to profile
        </Link>
      </DialogFooter>
    </div>
  )
}
