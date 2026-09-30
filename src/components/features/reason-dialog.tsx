import { useForm } from '@tanstack/react-form'
import { useMemo, useState, type ComponentProps } from 'react'
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
import { messageFrom, statusFrom } from '@/lib/api-error'
import { isReauthRequired } from '@/lib/step-up'
import { reasonFormSchema } from '@/schemas/reason.schemas'

/** Step-up was dismissed, so the action never ran. */
export const STEP_UP_DISMISSED = 'Confirm it’s you to continue.'

/** A 404 from a staff route answers the caller's role: it changed after the page loaded. */
export const ROLE_DENIED_ACTION =
  'Your role can’t do this any more. If your access just changed, reload the page.'

export interface ReasonDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  /** When set, the user must type this value (a slug or an email) to confirm. */
  confirmText?: string
  /** Performs the action. Resolve to close the dialog; reject to show why inline. */
  onConfirm: (reason: string) => Promise<void>
  /** Where focus goes when the dialog closes; omitted, it returns to the element that opened it. */
  finalFocus?: ComponentProps<typeof AlertDialogContent>['finalFocus']
}

/**
 * The confirmation every destructive or state-changing staff action goes
 * through: a required reason (recorded in the audit log) and, for the
 * irreversible ones, a typed confirmation. The form mounts only while open,
 * so each opening starts blank. A 403 or 409 is the server's own sentence
 * (staff-on-staff refusal, invalid transition, last owner) and is shown as
 * is; the dialog stays open so the reader sees it.
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

function ReasonForm({
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  confirmText,
  onConfirm,
  onBusyChange,
}: ReasonDialogProps & { onBusyChange: (busy: boolean) => void }) {
  const serverErrors = useServerErrors()
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
          serverErrors.setFormErrors([STEP_UP_DISMISSED])
          return
        }
        const status = statusFrom(error)
        if (status === 404) {
          serverErrors.setFormErrors([ROLE_DENIED_ACTION])
          return
        }
        if (status === 403 || status === 409) {
          serverErrors.setFormErrors([messageFrom(error)])
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
        <AlertDialogDescription>{description}</AlertDialogDescription>
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
                <FormLabel>Type {confirmText} to confirm</FormLabel>
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
              <Button
                type="submit"
                variant={destructive ? 'destructive' : 'default'}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Working…' : confirmLabel}
              </Button>
            )}
          </form.Subscribe>
        </AlertDialogFooter>
      </Form>
    </>
  )
}
