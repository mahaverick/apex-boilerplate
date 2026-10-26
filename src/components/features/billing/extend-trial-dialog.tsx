import { useForm, useStore } from '@tanstack/react-form'
import { useState, type ComponentProps } from 'react'
import { BusyButton } from '@/components/shared/busy-button'
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
import { Textarea } from '@/components/ui/textarea'
import { billingDate } from '@/constants/billing-labels'
import { fieldValue } from '@/hooks/use-form-field'
import { useNow } from '@/hooks/use-now'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { extendTrialPreview } from '@/lib/billing-actions'
import { refuseInForm } from '@/lib/billing-refusal'
import { toast } from '@/lib/toast'
import { useExtendTrial } from '@/queries/billing-admin.queries'
import { extendTrialFormSchema } from '@/schemas/billing.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { StaffTenantBilling } from '@/types/billing.types'

/** The days the form starts with. */
const DEFAULT_DAYS = '7'

/**
 * Extend a tenant's trial, or start one on a Free tenant, by 1–90 days with
 * an audited reason, behind step-up. The description shows the new end as
 * the days change. A 409 (`TRIAL_NOT_EXTENDABLE`: the tenant pays) shows the
 * API's sentence in the dialog.
 */
export function ExtendTrialDialog({
  tenant,
  billing,
  open,
  onOpenChange,
  finalFocus,
}: {
  tenant: PlatformTenantDetail
  billing: StaffTenantBilling
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Where focus goes on close; unset returns it to whatever opened the dialog. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus']
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // While the write runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent finalFocus={finalFocus}>
        {open && (
          <ExtendTrialForm
            tenant={tenant}
            billing={billing}
            onDone={() => onOpenChange(false)}
            onBusyChange={setBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The extend-trial form inside the open dialog; `onBusyChange` holds the dialog still while it runs. */
function ExtendTrialForm({
  tenant,
  billing,
  onDone,
  onBusyChange,
}: {
  tenant: PlatformTenantDetail
  billing: StaffTenantBilling
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const extend = useExtendTrial(tenant.id)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const serverErrors = useServerErrors()
  const now = useNow()
  const form = useForm({
    defaultValues: { days: DEFAULT_DAYS, reason: '' },
    validators: { onSubmit: extendTrialFormSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const input = extendTrialFormSchema.parse(value)
      onBusyChange(true)
      try {
        const view = await stepUp.run(() => extend.mutateAsync(input))
        onBusyChange(false)
        toast.success(
          view.trialEndsAt === null
            ? `Trial for ${tenant.name} extended.`
            : `Trial for ${tenant.name} ends on ${billingDate(view.trialEndsAt)}.`
        )
        onDone()
      } catch (error) {
        onBusyChange(false)
        refuseInForm(serverErrors, error)
      }
    },
  })
  const days = useStore(form.store, (state) => state.values.days)

  return (
    <>
      <DialogHeader>
        <DialogTitle>Extend the trial for {tenant.name}</DialogTitle>
        <DialogDescription>{extendTrialPreview(tenant.name, billing, days, now)}</DialogDescription>
      </DialogHeader>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        <FormField form={form} name="days">
          {(field) => (
            <FormItem>
              <FormLabel>Days to add</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-24"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
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
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormError />
        <DialogFooter>
          <BusyButton
            // The first write was refused, so it is not pending while the step-up waits.
            busy={extend.isPending || waiting}
            busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Extending…'}
            type="submit"
          >
            Extend trial
          </BusyButton>
        </DialogFooter>
      </Form>
    </>
  )
}
