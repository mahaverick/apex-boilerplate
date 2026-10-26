import { useForm, useStore } from '@tanstack/react-form'
import { useMemo, useState, type ComponentProps } from 'react'
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
import { fieldValue } from '@/hooks/use-form-field'
import { useNow } from '@/hooks/use-now'
import { useServerErrors } from '@/hooks/use-server-errors'
import { STEP_UP_WAITING_LABEL, useStepUp, useStepUpWaiting } from '@/hooks/use-step-up'
import { fieldErrorsFrom } from '@/lib/api-error'
import { refuseInForm } from '@/lib/billing-refusal'
import { toast } from '@/lib/toast'
import { useAddGrant } from '@/queries/billing-admin.queries'
import { grantFormSchema, LATEST_GRANT_END, localDate } from '@/schemas/billing.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'
import type { EntitlementCatalogEntry } from '@/types/billing.types'

/**
 * Raise a limit or turn on a feature for one tenant, beyond its plan, with an
 * audited reason, behind step-up. The value follows the chosen entry's kind:
 * a limit takes a number from 1 to 1,000,000 or No limit; a feature only turns
 * on. "Ends on" is a native date input from today to 31 Dec 2099, sent as the
 * end of that day in the browser's zone. The API's field errors land on the
 * fields (`expiresAt` on Ends on).
 */
export function AddGrantDialog({
  tenant,
  catalog,
  open,
  onOpenChange,
  finalFocus,
}: {
  tenant: PlatformTenantDetail
  catalog: readonly EntitlementCatalogEntry[]
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
        <DialogHeader>
          <DialogTitle>Add a grant for {tenant.name}</DialogTitle>
          <DialogDescription>
            A grant raises a limit or turns on a feature beyond the plan, until you revoke it or it
            ends.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <AddGrantForm
            tenant={tenant}
            catalog={catalog}
            onDone={() => onOpenChange(false)}
            onBusyChange={setBusy}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The grant form inside the open dialog; `onBusyChange` holds the dialog still while it runs. */
function AddGrantForm({
  tenant,
  catalog,
  onDone,
  onBusyChange,
}: {
  tenant: PlatformTenantDetail
  catalog: readonly EntitlementCatalogEntry[]
  onDone: () => void
  onBusyChange: (busy: boolean) => void
}) {
  const addGrant = useAddGrant(tenant.id)
  const stepUp = useStepUp()
  const waiting = useStepUpWaiting()
  const serverErrors = useServerErrors()
  const schema = useMemo(() => grantFormSchema(catalog), [catalog])
  const today = localDate(new Date(useNow()))
  const form = useForm({
    defaultValues: { key: '', value: '', noLimit: false, endsOn: '', reason: '' },
    validators: { onSubmit: schema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const input = schema.parse(value)
      const label = catalog.find((entry) => entry.key === input.key)?.label ?? input.key
      onBusyChange(true)
      try {
        await stepUp.run(() => addGrant.mutateAsync(input))
        onBusyChange(false)
        toast.success(`${label} grant added for ${tenant.name}.`)
        onDone()
      } catch (error) {
        onBusyChange(false)
        refuseInForm(serverErrors, error)
        // Express names the wire field; the form's is the date input.
        const expiry = fieldErrorsFrom(error).expiresAt
        if (expiry !== undefined) serverErrors.setFieldError('endsOn', expiry)
      }
    },
  })
  const key = useStore(form.store, (state) => state.values.key)
  const noLimit = useStore(form.store, (state) => state.values.noLimit)
  const entry = catalog.find((candidate) => candidate.key === key)

  return (
    <Form form={form} serverErrors={serverErrors} className="grid gap-4">
      <FormField form={form} name="key">
        {(field) => (
          <FormItem>
            <FormLabel>Limit or feature</FormLabel>
            <Select
              value={field.state.value === '' ? null : field.state.value}
              onValueChange={(next: string | null) => {
                if (next === null) return
                field.handleChange(next)
                serverErrors.clearField('key')
                serverErrors.clearField('value')
              }}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string | null) =>
                      value === null
                        ? 'Choose one'
                        : (catalog.find((candidate) => candidate.key === value)?.label ?? value)
                    }
                  </SelectValue>
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {catalog.map((candidate) => (
                  <SelectItem key={candidate.key} value={candidate.key}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      {entry?.kind === 'feature' && <p className="text-sm">Turns {entry.label} on.</p>}
      {entry?.kind === 'limit' && (
        <div className="grid gap-2">
          <FormField form={form} name="value">
            {(field) => (
              <FormItem>
                <FormLabel>New limit</FormLabel>
                <FormControl>
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-32"
                    disabled={noLimit}
                    value={fieldValue(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>
          <FormField form={form} name="noLimit">
            {(field) => (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={field.state.value === true}
                  onCheckedChange={(checked: boolean) => {
                    field.handleChange(checked === true)
                    // Base UI's checkbox raises no native change on the form, so the value's server error is cleared here.
                    serverErrors.clearField('value')
                  }}
                />
                No limit
              </label>
            )}
          </FormField>
        </div>
      )}
      <FormField form={form} name="endsOn">
        {(field) => (
          <FormItem>
            <FormLabel>Ends on (optional)</FormLabel>
            <FormControl>
              <Input
                type="date"
                className="w-44"
                min={today}
                max={LATEST_GRANT_END}
                value={fieldValue(field.state.value)}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </FormControl>
            <FormDescription>
              Empty means no end date. A date ends the grant at the end of that day, your time.
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
            <FormMessage />
          </FormItem>
        )}
      </FormField>
      <FormError />
      <DialogFooter>
        <BusyButton
          // The first write was refused, so it is not pending while the step-up waits.
          busy={addGrant.isPending || waiting}
          busyLabel={waiting ? STEP_UP_WAITING_LABEL : 'Adding…'}
          type="submit"
        >
          Add grant
        </BusyButton>
      </DialogFooter>
    </Form>
  )
}
