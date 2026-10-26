import { useForm, useStore } from '@tanstack/react-form'
import { useState } from 'react'
import { ReasonHint } from '@/components/features/reason-dialog'
import { BusyButton } from '@/components/shared/busy-button'
import { Note } from '@/components/shared/note'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { fieldErrorsFrom } from '@/lib/api-error'
import { refuseInForm } from '@/lib/billing-refusal'
import { formatInr } from '@/lib/money'
import { INTERVAL_LABELS } from '@/lib/plan-editor'
import { toast } from '@/lib/toast'
import { useCreatePrice } from '@/queries/billing-admin.queries'
import { priceFormSchema, priceRupeesFrom } from '@/schemas/billing.schemas'
import { BILLING_INTERVALS, type BillingInterval, type StaffPlan } from '@/types/billing.types'

/** What the new-price dialog needs: the plan, the API's warning threshold, and its open state. */
interface NewPriceDialogProps {
  plan: StaffPlan
  /** The API's `priceWarningAboveMinor`, in paise. */
  warnAboveMinor: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * A new price for a plan, in whole rupees, with an audited reason, behind
 * step-up. Express retires the active price of the same interval in the
 * same write, and subscribers keep what they pay, which the confirm line
 * says with both amounts. Above the API's threshold a note warns that each
 * charge needs the customer's approval.
 */
export function NewPriceDialog(props: NewPriceDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={props.open}
      onOpenChange={(next) => {
        // While the write runs, a step-up may be open over this dialog: Escape and the backdrop belong to it.
        if (!next && busy) return
        props.onOpenChange(next)
      }}
    >
      <DialogContent>
        {props.open && (
          <NewPriceForm
            {...props}
            onDone={() => props.onOpenChange(false)}
            onBusyChange={setBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The line that says who pays what once the price is added.
 * @param plan - The plan.
 * @param interval - The chosen interval.
 * @param amountMinor - The new amount, in paise.
 */
function whoPaysWhat(plan: StaffPlan, interval: string, amountMinor: number): string {
  const active = plan.prices.find((price) => price.active && price.interval === interval)
  const pays = `New subscribers pay ${formatInr(amountMinor)}.`
  // Subscribers on older retired prices keep those too, so the line names no single old amount.
  return active === undefined
    ? pays
    : `Current subscribers keep the price they signed up at. ${pays}`
}

/** The new-price form inside the open dialog; `onBusyChange` holds the dialog still while it runs. */
function NewPriceForm({
  plan,
  warnAboveMinor,
  onDone,
  onBusyChange,
}: NewPriceDialogProps & { onDone: () => void; onBusyChange: (busy: boolean) => void }) {
  const create = useCreatePrice(plan.id)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const serverErrors = useServerErrors()
  const form = useForm({
    defaultValues: { interval: 'month', amountRupees: '', reason: '' },
    validators: { onSubmit: priceFormSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const input = priceFormSchema.parse(value)
      onBusyChange(true)
      try {
        await stepUp.run(() => create.mutateAsync(input))
        onBusyChange(false)
        toast.success(
          `New ${input.interval === 'year' ? 'yearly' : 'monthly'} price: ${formatInr(input.amountMinor)}.`
        )
        onDone()
      } catch (error) {
        onBusyChange(false)
        refuseInForm(serverErrors, error)
        // Express names the wire field, in paise; the form's is the rupees.
        const amount = fieldErrorsFrom(error).amountMinor
        if (amount !== undefined) serverErrors.setFieldError('amountRupees', amount)
      }
    },
  })
  const interval = useStore(form.store, (state) => state.values.interval)
  const rupees = priceRupeesFrom(useStore(form.store, (state) => state.values.amountRupees))
  const amountMinor = rupees === null ? null : rupees * 100

  return (
    <>
      <DialogHeader>
        <DialogTitle>New price for {plan.name}</DialogTitle>
        <DialogDescription>
          The new price replaces the active price for its interval. Subscribers keep the price they
          pay.
        </DialogDescription>
      </DialogHeader>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        <FormField form={form} name="interval">
          {(field) => (
            <FormItem>
              <FormLabel>Interval</FormLabel>
              <Select
                value={field.state.value}
                onValueChange={(next: string | null) => {
                  if (next === null) return
                  field.handleChange(next)
                  // Base UI's select raises no native change on the form, so its server error is cleared here.
                  serverErrors.clearField('interval')
                }}
              >
                <FormControl>
                  <SelectTrigger className="w-40">
                    <SelectValue>
                      {(value: string | null) =>
                        INTERVAL_LABELS[value as BillingInterval] ?? 'Choose one'
                      }
                    </SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {BILLING_INTERVALS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {INTERVAL_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormField form={form} name="amountRupees">
          {(field) => (
            <FormItem>
              <FormLabel>Amount in rupees</FormLabel>
              <FormControl>
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  className="w-40"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        {amountMinor !== null && amountMinor > warnAboveMinor && (
          <Note tone="warning">
            Charges above {formatInr(warnAboveMinor)} need the customer to approve each payment.
            Keep {interval === 'year' ? 'yearly' : 'monthly'} prices at {formatInr(warnAboveMinor)}{' '}
            or less.
          </Note>
        )}
        {amountMinor !== null && (
          <p className="text-sm">{whoPaysWhat(plan, interval, amountMinor)}</p>
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
        <FormError />
        <DialogFooter>
          <BusyButton
            // The first write was refused, so it is not pending while the step-up waits.
            busy={create.isPending || waiting}
            busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Adding…'}
            type="submit"
          >
            Add price
          </BusyButton>
        </DialogFooter>
      </Form>
    </>
  )
}
