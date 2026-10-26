import { useForm, useStore } from '@tanstack/react-form'
import { useId, useMemo, useState, type ComponentProps } from 'react'
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
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { billingDate } from '@/constants/billing-labels'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { refuseInForm } from '@/lib/billing-refusal'
import { toast } from '@/lib/toast'
import { useCancelBillingByStaff } from '@/queries/billing-admin.queries'
import { cancelBillingFormSchema } from '@/schemas/billing.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { StaffCancelWhen, StaffTenantBilling } from '@/types/billing.types'

/**
 * Cancel a tenant's subscription as a platform admin, at the end of the paid
 * period or now, with an audited reason, behind step-up. A cancel now asks
 * for the tenant's slug typed. A subscription already ending at its period
 * end offers only Now, since express refuses a second cycle-end cancel.
 * Refusals (nothing to cancel, payments off, the provider down) show the
 * API's sentence in the dialog.
 */
export function CancelBillingDialog({
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
  finalFocus?: ComponentProps<typeof AlertDialogContent>['finalFocus']
}) {
  const [busy, setBusy] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        // While the write runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
      <AlertDialogContent finalFocus={finalFocus}>
        {open && (
          <CancelBillingForm
            tenant={tenant}
            billing={billing}
            onDone={() => onOpenChange(false)}
            onBusyChange={setBusy}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/**
 * What a cancel does, for the chosen moment.
 * @param tenantName - The tenant's name.
 * @param when - When the subscription ends.
 * @param end - The paid period's end, read short, or null when there is none yet.
 * @param provider - The provider as a sentence names it.
 */
function cancelDescription(
  tenantName: string,
  when: StaffCancelWhen,
  end: string | null,
  provider: string
): string {
  if (when === 'now') {
    const dashboard = provider === 'Razorpay' ? 'the Razorpay dashboard' : 'its dashboard'
    return `${tenantName} moves to Free now. ${provider} charges nothing more. Refund any unused period in ${dashboard}.`
  }
  return end === null
    ? `${tenantName} keeps Paid until its paid period ends, then moves to Free. Nothing more is charged.`
    : `${tenantName} keeps Paid until ${end}, then moves to Free. Nothing more is charged.`
}

/** The cancel form inside the open dialog; `onBusyChange` holds the dialog still while it runs. */
function CancelBillingForm({
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
  const cancel = useCancelBillingByStaff(tenant.id)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const serverErrors = useServerErrors()
  const whenLabel = useId()
  const schema = useMemo(() => cancelBillingFormSchema(tenant.slug), [tenant.slug])
  const end = billing.currentPeriodEnd === null ? null : billingDate(billing.currentPeriodEnd)
  const onlyNow = billing.cancelAtPeriodEnd
  const provider = billing.provider === 'razorpay' ? 'Razorpay' : 'The payment provider'
  const initialWhen: StaffCancelWhen = onlyNow ? 'now' : 'cycle_end'
  const form = useForm({
    defaultValues: {
      when: initialWhen,
      confirmation: '',
      reason: '',
    },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const input = schema.parse(value)
      onBusyChange(true)
      try {
        const view = await stepUp.run(() => cancel.mutateAsync(input))
        onBusyChange(false)
        const endsOn = view.currentPeriodEnd ?? billing.currentPeriodEnd
        toast.success(
          input.when === 'now' || endsOn === null
            ? `${tenant.name} moved to Free.`
            : `Paid for ${tenant.name} ends on ${billingDate(endsOn)}.`
        )
        onDone()
      } catch (error) {
        onBusyChange(false)
        refuseInForm(serverErrors, error)
      }
    },
  })
  const when = useStore(form.store, (state) => state.values.when)

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel the subscription for {tenant.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          {onlyNow && end !== null && `Paid already ends on ${end}. `}
          {cancelDescription(tenant.name, when, end, provider)}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        <FormField form={form} name="when">
          {(field) => (
            <div className="grid gap-2">
              <p id={whenLabel} className="text-sm font-medium">
                When it ends
              </p>
              <RadioGroup
                aria-labelledby={whenLabel}
                value={field.state.value}
                onValueChange={(next) => {
                  field.handleChange(next as StaffCancelWhen)
                  serverErrors.clearField('confirmation')
                }}
              >
                {!onlyNow && (
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="cycle_end" />
                    {end === null
                      ? 'At the end of the paid period'
                      : `At the end of the paid period (${end})`}
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value="now" />
                  Now
                </label>
              </RadioGroup>
            </div>
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
        {when === 'now' && (
          <FormField form={form} name="confirmation">
            {(field) => (
              <FormItem>
                <FormLabel>
                  Type <Pii>{tenant.slug}</Pii> to confirm
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
          <AlertDialogCancel>Keep subscription</AlertDialogCancel>
          <BusyButton
            // The first write was refused, so it is not pending while the step-up waits.
            busy={cancel.isPending || waiting}
            busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Cancelling…'}
            type="submit"
            variant="destructive"
          >
            Cancel subscription
          </BusyButton>
        </AlertDialogFooter>
      </Form>
    </>
  )
}
