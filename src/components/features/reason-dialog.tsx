import { useForm } from '@tanstack/react-form'
import { useMemo, useState, type ComponentProps, type ReactNode } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom, messageFrom, statusFrom } from '@/lib/api-error'
import { isReauthRequired, stepUpRefusal } from '@/lib/step-up'
import { reasonFormSchema } from '@/schemas/reason.schemas'
import { REASON_REQUIRED, ROUTE_NOT_FOUND } from '@/types/api.types'

/** A 404 from a staff route answers the caller's role: it changed after the page loaded. */
export const ROLE_DENIED_ACTION =
  'Your role no longer allows this action. Ask a platform owner to check your role.'

/** What `ReasonDialog` shows and does: its wording, the action it confirms, and how its refusals read. */
export interface ReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /**
   * What the action will do. A plain string is masked whole as `<Pii>`, the safe default;
   * a node renders as given, so a caller whose sentence holds a person's value passes
   * `<>… <Pii>{value}</Pii> …</>` and masks only the value.
   */
  description: string | ReactNode
  confirmLabel: string
  destructive?: boolean
  /** When set, the user must type this value (a slug or an email) to confirm. */
  confirmText?: string
  /** Performs the action. Resolve to close the dialog; reject to show why inline. */
  onConfirm: (reason: string) => Promise<void>
  /** Where focus goes when the dialog closes; omitted, it returns to the element that opened it. */
  finalFocus?: ComponentProps<typeof AlertDialogContent>['finalFocus']
  /**
   * How a 403 or 409 reads instead of the server's sentence, for a refusal
   * whose detail the reader's locale should word (a time); `undefined` keeps
   * the server's.
   */
  refusalMessage?: (error: unknown) => string | undefined
}

/**
 * The confirmation for a staff action the API records a reason for: a required
 * reason (sent with the request, recorded in the audit log) and, when the caller
 * sets `confirmText`, a typed confirmation. Not every destructive action goes
 * through it (removing a member of the platform tenant, leaving a tenant and the
 * maintenance dialogs have their own `AlertDialog`); SECURITY.md "Reason prompts"
 * lists which do. The form mounts only while open, so each opening starts blank.
 *
 * A refusal shows inside the dialog, which stays open. A 403 or 409 is the
 * server's own sentence (staff-on-staff refusal, invalid transition, last
 * owner) unless `refusalMessage` returns a sentence to replace it; a 404 with
 * the route code `not_found`, or no code, is the role gate's, and one with any
 * other code is the server's sentence as is. A 400 `REASON_REQUIRED` goes on
 * the Reason field.
 *
 * A refusal that means the row is gone is the caller's to catch and resolve: a
 * dialog inside a list its write refetches on settle is unmounted with the row
 * before the refusal arrives (an invitation that is not pending, a member already
 * gone).
 */
export function ReasonDialog(props: ReasonDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(next) => {
        // While the action runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        props.onOpenChange(next)
      }}
    >
      <AlertDialogContent finalFocus={props.finalFocus}>
        {props.open && <ReasonForm {...props} onBusyChange={setBusy} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The reason form inside the open dialog; reports `onBusyChange` so the dialog holds still while the action runs. */
function ReasonForm({
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  confirmText,
  onConfirm,
  refusalMessage,
  onBusyChange,
}: ReasonDialogProps & { onBusyChange: (busy: boolean) => void }) {
  const serverErrors = useServerErrors()
  const waiting = useStepUpWaiting()
  const schema = useMemo(() => reasonFormSchema(confirmText), [confirmText])
  const form = useForm({
    defaultValues: { reason: '', confirmation: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      onBusyChange(true)
      try {
        await onConfirm(schema.parse(value).reason)
        onBusyChange(false)
        onOpenChange(false)
      } catch (error) {
        onBusyChange(false)
        if (isReauthRequired(error)) {
          serverErrors.setFormErrors([stepUpRefusal(error)])
          return
        }
        if (codeFrom(error) === REASON_REQUIRED) {
          serverErrors.setFieldError('reason', [messageFrom(error)])
          return
        }
        const status = statusFrom(error)
        // A role gate's 404 carries the route code (or none); any other code is the action's own verdict.
        if (status === 404) {
          const code = codeFrom(error)
          serverErrors.setFormErrors([
            code === undefined || code === ROUTE_NOT_FOUND
              ? ROLE_DENIED_ACTION
              : messageFrom(error),
          ])
          return
        }
        if (status === 403 || status === 409) {
          serverErrors.setFormErrors([refusalMessage?.(error) ?? messageFrom(error)])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>
          {typeof description === 'string' ? <Pii>{description}</Pii> : description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        <FormField form={form} name="reason">
          {(field) => (
            <FormItem>
              <FormLabel>Reason</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormDescription>Recorded in the audit log with your name.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        {confirmText !== undefined && (
          <FormField form={form} name="confirmation">
            {(field) => (
              <FormItem>
                <FormLabel>
                  Type <Pii>{confirmText}</Pii> to confirm
                </FormLabel>
                <FormControl>
                  <Input
                    autoComplete="off"
                    value={fieldValue(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>
        )}
        <FormError />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <BusyButton
                busy={isSubmitting}
                busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Working…'}
                type="submit"
                variant={destructive ? 'destructive' : 'default'}
              >
                {confirmLabel}
              </BusyButton>
            )}
          </form.Subscribe>
        </AlertDialogFooter>
      </Form>
    </>
  )
}
