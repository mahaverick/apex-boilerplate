import { useForm } from '@tanstack/react-form'
import { useState } from 'react'
import { ReasonHint } from '@/components/features/reason-dialog'
import { BusyButton } from '@/components/shared/busy-button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUpWaiting } from '@/hooks/use-step-up'
import { refuseInForm } from '@/lib/billing-refusal'
import { changeLine, tenantsOnPlan } from '@/lib/plan-editor'
import { lowerLimitsFormSchema } from '@/schemas/billing.schemas'
import type { EntitlementCatalogEntry, PlanChangePreview } from '@/types/billing.types'

/** What the lower-limits dialog shows and does. */
interface PlanChangeConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planName: string
  preview: PlanChangePreview
  catalog: readonly EntitlementCatalogEntry[]
  /** Saves the edit with the reason; resolves to close, rejects to show why. */
  onConfirm: (reason: string) => Promise<void>
}

/**
 * The confirmation a plan edit that lowers anything needs: every change it
 * makes, the tenants on the plan (express applies the edit to all of them
 * at once and deletes nothing), a second confirm and a reason. No decrease
 * saves without it.
 */
export function PlanChangeConfirmDialog(props: PlanChangeConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(next) => {
        // While the save runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        props.onOpenChange(next)
      }}
    >
      <AlertDialogContent>
        {props.open && <LowerLimitsForm {...props} onBusyChange={setBusy} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** The dialog's form; `onBusyChange` holds the dialog still while the save runs. */
function LowerLimitsForm({
  onOpenChange,
  planName,
  preview,
  catalog,
  onConfirm,
  onBusyChange,
}: PlanChangeConfirmDialogProps & { onBusyChange: (busy: boolean) => void }) {
  const serverErrors = useServerErrors()
  const waiting = useStepUpWaiting()
  const form = useForm({
    defaultValues: { checked: false, reason: '' },
    validators: { onSubmit: lowerLimitsFormSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const { reason } = lowerLimitsFormSchema.parse(value)
      onBusyChange(true)
      try {
        await onConfirm(reason)
        onBusyChange(false)
        onOpenChange(false)
      } catch (error) {
        onBusyChange(false)
        refuseInForm(serverErrors, error)
      }
    },
  })

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Lower limits on {planName}?</AlertDialogTitle>
        <AlertDialogDescription>
          {tenantsOnPlan(preview, planName)}. They get the lower limits now and keep their data. A
          tenant over a limit can’t add more.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <ul className="grid gap-1 text-sm" aria-label="Changes">
        {preview.changes.map((change) => (
          <li key={change.key}>{changeLine(change, catalog)}</li>
        ))}
      </ul>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        <FormField form={form} name="checked">
          {(field) => (
            <FormItem>
              <label className="flex items-center gap-2 text-sm">
                <FormControl>
                  <Checkbox
                    checked={field.state.value === true}
                    onCheckedChange={(checked: boolean) => {
                      field.handleChange(checked === true)
                      // Base UI's checkbox raises no native change on the form, so its error is cleared here.
                      serverErrors.clearField('checked')
                    }}
                  />
                </FormControl>
                I checked the tenants this affects
              </label>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormField form={form} name="reason">
          {(field) => (
            <FormItem>
              <FormLabel>Reason</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <ReasonHint />
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormError />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <BusyButton
                busy={isSubmitting}
                busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Saving…'}
                type="submit"
                variant="destructive"
              >
                Lower limits
              </BusyButton>
            )}
          </form.Subscribe>
        </AlertDialogFooter>
      </Form>
    </>
  )
}
