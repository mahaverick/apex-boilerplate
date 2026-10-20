import { IconPlus } from '@tabler/icons-react'
import { useForm } from '@tanstack/react-form'
import { useState, type ComponentProps } from 'react'
import type { z } from 'zod'
import { BusyButton } from '@/components/shared/busy-button'
import { Pii } from '@/components/shared/pii'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { useLeavingFinalFocus } from '@/hooks/use-arrival-focus'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { codeFrom } from '@/lib/api-error'
import { staffMessageFrom } from '@/lib/staff-message'
import { toast } from '@/lib/toast'
import { useCreatePlatformTenant } from '@/queries/tenant-admin.queries'
import { createPlatformTenantSchema } from '@/schemas/tenant.schemas'
import { INVITEE_DEACTIVATED, SLUG_TAKEN, type PlatformTenantDetail } from '@/types/api.types'

/** The create form's values as the schema takes them. */
type Values = z.input<typeof createPlatformTenantSchema>

const TEXT_FIELDS: {
  name: 'name' | 'slug' | 'ownerEmail' | 'website'
  label: string
  type?: string
}[] = [
  { name: 'name', label: 'Name' },
  { name: 'slug', label: 'Slug' },
  { name: 'ownerEmail', label: 'Owner email', type: 'email' },
  { name: 'website', label: 'Website' },
]

/** The form field each 409 code belongs on. */
const FIELD_FOR_CODE: Partial<Record<string, 'slug' | 'ownerEmail'>> = {
  [SLUG_TAKEN]: 'slug',
  [INVITEE_DEACTIVATED]: 'ownerEmail',
}

/**
 * "New tenant". It holds no role gate of its own: the API requires platform
 * admin, so the page renders it only for admins and owners. The tenant starts
 * with no members; the owner joins by accepting the emailed invitation. A 409
 * lands on the field its code names: a taken slug on Slug, a deactivated owner
 * account on Owner email; any other error on the form. `onCreated` decides
 * where to go next, and must navigate: both callers open the new tenant, so a
 * create asks that page's heading to take focus and the close restores none. The command palette opens it with `trigger={false}`, its own `open`
 * and a `finalFocus`, since no trigger is there to take focus back.
 */
export function CreateTenantDialog({
  onCreated,
  open: controlledOpen,
  onOpenChange,
  trigger = true,
  finalFocus,
}: {
  onCreated: (tenant: PlatformTenantDetail) => void
  /** Controls the dialog from outside, as the command palette does; it keeps its own state when unset. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** False renders no New tenant button: whoever controls `open` opens it. */
  trigger?: boolean
  /** Where focus goes on a close that creates nothing; unset returns it to whatever opened the dialog. */
  finalFocus?: ComponentProps<typeof DialogContent>['finalFocus']
}) {
  const [ownOpen, setOwnOpen] = useState(false)
  const leaving = useLeavingFinalFocus(finalFocus)
  const open = controlledOpen ?? ownOpen
  /** Sets whichever open state is in charge. */
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && (
        <DialogTrigger render={<Button />}>
          <IconPlus aria-hidden="true" />
          New tenant
        </DialogTrigger>
      )}
      <DialogContent finalFocus={leaving.finalFocus}>
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>
            The owner gets an email invitation; the tenant has no members until they accept.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateTenantForm
            onDone={(tenant) => {
              leaving.leave()
              setOpen(false)
              onCreated(tenant)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The create form inside the open dialog; it is mounted only while open, so each opening starts blank. */
function CreateTenantForm({ onDone }: { onDone: (tenant: PlatformTenantDetail) => void }) {
  const create = useCreatePlatformTenant()
  const serverErrors = useServerErrors()
  const defaultValues: Values = { name: '', slug: '', ownerEmail: '', description: '', website: '' }
  const form = useForm({
    defaultValues,
    validators: { onSubmit: createPlatformTenantSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      const input = createPlatformTenantSchema.parse(value)
      try {
        const { tenant, emailSent } = await create.mutateAsync(input)
        if (emailSent) {
          toast.success(
            <>
              Tenant created. Owner invitation sent to <Pii>{input.ownerEmail}</Pii>.
            </>
          )
        } else {
          toast.warning(
            'Tenant created, but the owner invitation email wasn’t sent. Resend it from the tenant’s Actions menu.'
          )
        }
        onDone(tenant)
      } catch (error) {
        const field = FIELD_FOR_CODE[codeFrom(error) ?? '']
        if (field) {
          serverErrors.setFieldError(field, [staffMessageFrom(error)])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors} className="grid gap-4">
      {TEXT_FIELDS.map(({ name, label, type }) => (
        <FormField key={name} form={form} name={name}>
          {(field) => (
            <FormItem>
              <FormLabel>{label}</FormLabel>
              <FormControl>
                <Input
                  type={type ?? 'text'}
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
      ))}
      <FormField form={form} name="description">
        {(field) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
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
        <BusyButton busy={create.isPending} busyLabel="Creating…" type="submit">
          Create tenant
        </BusyButton>
      </DialogFooter>
    </Form>
  )
}
