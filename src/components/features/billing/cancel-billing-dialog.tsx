import { useForm, useStore } from '@tanstack/react-form'
import { useId, useMemo, useState, type ComponentProps } from 'react'
import { ReasonHint } from '@/components/features/reason-dialog'
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
import { fieldValue } from '@/hooks/use-form-field'
import { useNow } from '@/hooks/use-now'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { cancelChoicesFor, cancelToast } from '@/lib/billing-actions'
import { refuseInForm } from '@/lib/billing-refusal'
import { toast } from '@/lib/toast'
import { useCancelBillingByStaff } from '@/queries/billing-admin.queries'
import { cancelBillingFormSchema } from '@/schemas/billing.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { StaffCancelWhen, StaffTenantBilling } from '@/types/billing.types'

/**
 * Cancel a tenant's subscription as a platform admin, with an audited
 * reason, behind step-up. The choices and their wording follow what express
 * does in this tenant's case (`cancelChoicesFor`); a single choice shows no
 * radio. A cancel now asks for the tenant's slug typed. The toast compares
 * the view express answers with the billing the dialog opened on
 * (`cancelToast`). Refusals (nothing to cancel, the
 * provider down) show the API's sentence in the dialog.
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
  const now = useNow()
  // Pinned when the dialog opens: a refetch mid-form must not swap the choices, or the toast's "before", under the reader.
  const [{ choices, note, opened }] = useState(() => ({
    ...cancelChoicesFor(tenant.name, billing, now),
    opened: billing,
  }))
  const initialWhen: StaffCancelWhen = choices[0]?.when ?? 'now'
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
        toast.success(cancelToast(tenant.name, opened, view))
        onDone()
      } catch (error) {
        onBusyChange(false)
        refuseInForm(serverErrors, error)
      }
    },
  })
  const when = useStore(form.store, (state) => state.values.when)
  const chosen = choices.find((choice) => choice.when === when) ?? choices[0]

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Cancel the subscription for {tenant.name}?</AlertDialogTitle>
        <AlertDialogDescription>
          {note !== null && `${note} `}
          {chosen?.description}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        {choices.length > 1 && (
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
                  {choices.map((choice) => (
                    <label key={choice.when} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={choice.when} />
                      {choice.label}
                    </label>
                  ))}
                </RadioGroup>
              </div>
            )}
          </FormField>
        )}
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
