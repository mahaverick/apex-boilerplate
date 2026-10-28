import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
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
  FormDescription,
  FormError,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { providerName } from '@/constants/billing-labels'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom, fieldErrorsFrom, statusFrom } from '@/lib/api-error'
import { formatInr } from '@/lib/billing-format'
import { refuseInForm } from '@/lib/billing-refusal'
import { staffMessageFrom } from '@/lib/staff-message'
import { remainingCreditMinor } from '@/lib/tax-format'
import { toast } from '@/lib/toast'
import { useIssueManualCreditNote } from '@/queries/billing-admin.queries'
import { billingAdminKeys } from '@/queries/billing-reads.queries'
import { creditCapMinor, creditNoteSchema } from '@/schemas/tax.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import {
  TAX_DOCUMENTS_DISABLED,
  type StaffTaxDocumentItem,
  type StaffTenantBilling,
} from '@/types/billing.types'

/**
 * Issue a credit note against an invoice by hand, for a payment dispute the
 * business lost, behind step-up. The amount is typed in rupees and sent as
 * paise, from ₹1 to what is left to credit. A refusal shows in the form as
 * express words it, and a 409 (the row was stale) reloads the documents.
 * @param props.tenant - The tenant that owns the invoice.
 * @param props.invoice - The invoice row.
 * @param props.provider - The tenant's payment provider, named in the description.
 * @param props.open - Whether the dialog is open.
 * @param props.onOpenChange - Called with the next open state.
 * @param props.finalFocus - Where focus goes on close.
 */
export function CreditNoteDialog({
  tenant,
  invoice,
  provider,
  open,
  onOpenChange,
  finalFocus,
}: {
  tenant: PlatformTenantDetail
  invoice: StaffTaxDocumentItem
  provider: StaffTenantBilling['provider']
  open: boolean
  onOpenChange: (open: boolean) => void
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
          <CreditNoteForm
            tenant={tenant}
            invoice={invoice}
            provider={provider}
            onDone={() => onOpenChange(false)}
            onBusyChange={setBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The form inside the open dialog; `onBusyChange` holds the dialog still while the write runs. */
function CreditNoteForm({
  tenant,
  invoice,
  provider,
  onDone,
  onBusyChange,
}: {
  tenant: PlatformTenantDetail
  invoice: StaffTaxDocumentItem
  provider: StaffTenantBilling['provider']
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const issue = useIssueManualCreditNote(tenant.id)
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const serverErrors = useServerErrors()
  const remainingMinor = remainingCreditMinor(invoice)
  const schema = creditNoteSchema(remainingMinor)
  const form = useForm({
    defaultValues: { amountRupees: '', reason: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const body = schema.parse(value)
      onBusyChange(true)
      try {
        const item = await stepUp.run(() => issue.mutateAsync({ docId: invoice.id, ...body }))
        onBusyChange(false)
        toast.success(
          `Credit note ${item.number} issued for ${formatInr(item.amounts.totalMinor)}.`
        )
        onDone()
      } catch (error) {
        onBusyChange(false)
        await refuse(error)
      }
    },
  })

  /** Shows a refused credit note: a toast for a switched-off registration, else in the form. */
  async function refuse(error: unknown) {
    if (statusFrom(error) === 404 && codeFrom(error) === TAX_DOCUMENTS_DISABLED) {
      // The refetch removes the credit note controls and unmounts this dialog, so the sentence goes in a toast.
      toast.error(staffMessageFrom(error))
      onDone()
      await queryClient.invalidateQueries({
        queryKey: billingAdminKeys.tenant(tenant.id),
        exact: true,
      })
      return
    }
    const amount = fieldErrorsFrom(error).amountMinor
    if (amount !== undefined) {
      // The form's field is in rupees; express's is in paise.
      serverErrors.setFieldError('amountRupees', amount)
      return
    }
    refuseInForm(serverErrors, error, { tenantName: tenant.name, provider })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Issue a credit note against {invoice.number}</DialogTitle>
        <DialogDescription>
          Use this only for a payment dispute the business lost. A refund made in{' '}
          {providerName(provider)} gets its credit note automatically. {formatInr(remainingMinor)}{' '}
          of {formatInr(invoice.amounts.totalMinor)} is left to credit.
        </DialogDescription>
      </DialogHeader>
      <Form form={form} serverErrors={serverErrors} className="grid gap-4">
        <FormField form={form} name="amountRupees">
          {(field) => (
            <FormItem>
              <FormLabel>Amount (₹)</FormLabel>
              <FormControl>
                <Input
                  inputMode="decimal"
                  autoComplete="off"
                  className="w-40"
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              <FormDescription>
                From ₹1 to {formatInr(creditCapMinor(remainingMinor))}.
              </FormDescription>
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
              <FormDescription>
                Printed on the customer’s credit note. Use English letters, digits and common
                punctuation.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        </FormField>
        <FormError />
        <DialogFooter>
          <BusyButton
            // The first write was refused, so it is not pending while the step-up waits.
            busy={issue.isPending || waiting}
            busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Issuing…'}
            type="submit"
          >
            Issue credit note
          </BusyButton>
        </DialogFooter>
      </Form>
    </>
  )
}
