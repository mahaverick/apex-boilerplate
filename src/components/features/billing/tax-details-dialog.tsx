import { useForm, useStore } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ReasonHint } from '@/components/features/reason-dialog'
import { BusyButton } from '@/components/shared/busy-button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useChangedFields } from '@/hooks/use-changed-fields'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { codeFrom, statusFrom } from '@/lib/api-error'
import { refuseInForm } from '@/lib/billing-refusal'
import { GST_STATES } from '@/lib/gst'
import { staffMessageFrom } from '@/lib/staff-message'
import { toast } from '@/lib/toast'
import { useSaveStaffTaxDetails } from '@/queries/billing-admin.queries'
import { billingAdminKeys } from '@/queries/billing-reads.queries'
import { reasonSchema } from '@/schemas/reason.schemas'
import {
  TAX_DETAILS_UNCHANGED_MESSAGE,
  taxDetailsFieldsSchema,
  taxDetailsForm,
  taxDetailsRuleIssues,
  valuesFrom,
  type TaxDetailsValues,
} from '@/schemas/tax-details.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import {
  TAX_DETAILS_VERSION_CONFLICT,
  TAX_DOCUMENTS_DISABLED,
  type StaffTaxDetails,
} from '@/types/billing.types'

/** The form's fields that print in the address, which a GSTIN requires. */
const GSTIN_ADDRESS_FIELDS = ['addressLine1', 'city', 'pincode'] as const

/**
 * Correct a tenant's tax details, or add them the first time, with an
 * audited reason, behind step-up. Invoices issued from then on use the new
 * details; issued documents keep theirs.
 * @param props.tenant - The tenant's platform detail.
 * @param props.details - The stored details, or `null` before the first save.
 * @param props.open - Whether the dialog is open.
 * @param props.onOpenChange - Called to open or close it.
 */
export function TaxDetailsDialog({
  tenant,
  details,
  open,
  onOpenChange,
}: {
  tenant: PlatformTenantDetail
  details: StaffTaxDetails | null
  open: boolean
  onOpenChange: (open: boolean) => void
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct tax details for {tenant.name}</DialogTitle>
          <DialogDescription>
            Invoices issued from now on use these details. Issued invoices and credit notes don’t
            change.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <TaxDetailsFormBody
            tenant={tenant}
            details={details}
            onDone={() => onOpenChange(false)}
            onBusyChange={setBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The text fields below the GSTIN, with their labels. */
const TEXT_FIELDS = [
  ['legalName', 'Legal name'],
  ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2 (optional)'],
  ['city', 'City'],
  ['pincode', 'PIN code'],
] as const

/**
 * The form inside the open dialog. A first save checks every field; an update
 * checks and sends only the fields changed from the stored details, so a
 * stored value today’s rules refuse doesn’t block fixing another. The
 * cross-field rules run on the stored values with the changes laid over them.
 */
function TaxDetailsFormBody({
  tenant,
  details,
  onDone,
  onBusyChange,
}: {
  tenant: PlatformTenantDetail
  details: StaffTaxDetails | null
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const save = useSaveStaffTaxDetails(tenant.id)
  const queryClient = useQueryClient()
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const serverErrors = useServerErrors()
  const { baseline, changes, changedBody, listeners, rebase } = useChangedFields(
    taxDetailsFieldsSchema,
    taxDetailsForm(details),
    serverErrors,
    TAX_DETAILS_UNCHANGED_MESSAGE
  )
  const form = useForm({
    defaultValues: { ...baseline, reason: '' },
    listeners,
    validators: {
      onSubmit: ({ value }) => {
        const fields: Record<string, string> = {}
        const reason = reasonSchema.safeParse(value.reason)
        if (!reason.success) fields.reason = reason.error.issues[0]?.message ?? ''
        const checked =
          details === null ? taxDetailsFieldsSchema.safeParse(value) : changes.safeParse(value)
        if (!checked.success) {
          for (const issue of checked.error.issues) {
            const name = String(issue.path[0])
            fields[name] ??= issue.message
          }
        }
        return Object.keys(fields).length === 0 ? undefined : { fields }
      },
    },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const reason = reasonSchema.parse(value.reason)
      let patch: { version: number | null } & Partial<TaxDetailsValues>
      let merged: TaxDetailsValues
      let sent: ReadonlySet<keyof TaxDetailsValues>
      if (details === null) {
        const parsed = taxDetailsFieldsSchema.parse(value)
        patch = { version: null, ...parsed }
        merged = parsed
        sent = new Set(Object.keys(parsed) as Array<keyof TaxDetailsValues>)
      } else {
        const body = changedBody(value)
        if (body === null) return
        patch = { version: details.version, ...body }
        merged = { ...valuesFrom(details), ...body }
        sent = new Set(Object.keys(body) as Array<keyof TaxDetailsValues>)
      }
      const issues = taxDetailsRuleIssues(merged, sent)
      if (issues.length > 0) {
        for (const { path, message } of issues) serverErrors.setFieldError(path, [message])
        return
      }
      onBusyChange(true)
      try {
        const saved = await stepUp.run(() => save.mutateAsync({ ...patch, reason }))
        onBusyChange(false)
        rebase({ ...taxDetailsForm(saved) })
        toast.success(
          `Tax details for ${tenant.name} saved. They apply to invoices issued from now on.`
        )
        onDone()
      } catch (error) {
        onBusyChange(false)
        await refuse(error)
      }
    },
  })

  /** Shows a refused save: the API's sentence for a lost race or a switched-off registration, else as any billing write. */
  async function refuse(error: unknown) {
    const code = codeFrom(error)
    if (statusFrom(error) === 409 && code === TAX_DETAILS_VERSION_CONFLICT) {
      // The mutation refetches the details; the typed values stay.
      serverErrors.setFormErrors([staffMessageFrom(error)])
      return
    }
    if (statusFrom(error) === 404 && code === TAX_DOCUMENTS_DISABLED) {
      serverErrors.setFormErrors([staffMessageFrom(error)])
      await queryClient.invalidateQueries({
        queryKey: billingAdminKeys.tenant(tenant.id),
        exact: true,
      })
      return
    }
    refuseInForm(serverErrors, error)
  }

  const gstin = useStore(form.store, (state) => state.values.gstin)
  const hasGstin = gstin.trim() !== ''

  return (
    <Form form={form} serverErrors={serverErrors} className="grid gap-4">
      <FormField form={form} name="gstin">
        {(field) => (
          <FormItem>
            <FormLabel>GSTIN (optional)</FormLabel>
            <FormControl>
              <Input
                autoComplete="off"
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>15 characters, such as 29ABCDE1234F1ZW.</FormDescription>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      {TEXT_FIELDS.map(([name, label]) => (
        <FormField key={name} form={form} name={name}>
          {(field) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Input
                  autoComplete="off"
                  inputMode={name === 'pincode' ? 'numeric' : undefined}
                  value={fieldValue(field.state.value)}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </FormControl>
              {hasGstin && (GSTIN_ADDRESS_FIELDS as readonly string[]).includes(name) && (
                <FormDescription>Required with a GSTIN.</FormDescription>
              )}
              <FormMessage />
            </FormItem>
          )}
        </FormField>
      ))}
      <FormField form={form} name="stateCode">
        {(field) => (
          <FormItem>
            <FormLabel>State</FormLabel>
            <Select
              value={fieldValue(field.state.value) || null}
              onValueChange={(value: string | null) => {
                if (value === null) return
                field.handleChange(value)
                serverErrors.clearField('stateCode')
              }}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a state">
                    {(value: string | null) => {
                      const state = GST_STATES.find((s) => s.code === value)
                      return state === undefined ? 'Choose a state' : `${state.code} ${state.name}`
                    }}
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {GST_STATES.map((state) => (
                  <SelectItem key={state.code} value={state.code}>
                    {state.code} {state.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <FormField form={form} name="isSez">
        {(field) => (
          <FormItem>
            <label className="flex items-center gap-2 text-sm">
              <FormControl>
                <Checkbox
                  checked={field.state.value === true}
                  onCheckedChange={(checked: boolean) => field.handleChange(checked === true)}
                />
              </FormControl>
              SEZ unit (Special Economic Zone)
            </label>
            <FormDescription>
              We hold an SEZ unit’s charges, so staff issue each tax invoice by hand.
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
            <ReasonHint />
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <FormError />
      <DialogFooter>
        <BusyButton
          busy={save.isPending || waiting}
          busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Saving…'}
          type="submit"
        >
          Save tax details
        </BusyButton>
      </DialogFooter>
    </Form>
  )
}
