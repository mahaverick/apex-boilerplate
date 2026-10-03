import { useForm } from '@tanstack/react-form'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'
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
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { codeFrom, messageFrom } from '@/lib/api-error'
import { useCreatePlatformTenant } from '@/queries/tenant-admin.queries'
import { createPlatformTenantSchema } from '@/schemas/tenant.schemas'
import { INVITEE_DEACTIVATED, SLUG_TAKEN, type PlatformTenantDetail } from '@/types/api.types'

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
 * with no members; the owner joins by accepting the emailed invitation. A 409 lands on the field its code names: a taken slug on Slug,
 * a deactivated owner account on Owner email; any other error on the form.
 * `onCreated` lets the page decide where to go next.
 */
export function CreateTenantDialog({
  onCreated,
}: {
  onCreated?: (tenant: PlatformTenantDetail) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus aria-hidden />
        New tenant
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New tenant</DialogTitle>
          <DialogDescription>
            The owner gets an email invitation; the tenant has no members until they accept.
          </DialogDescription>
        </DialogHeader>
        {open && (
          <CreateTenantForm
            onDone={(tenant) => {
              setOpen(false)
              onCreated?.(tenant)
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

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
            <Pii>{`Tenant created. Owner invitation sent to ${input.ownerEmail}.`}</Pii>
          )
        } else {
          toast.warning(
            'Tenant created, but the owner invitation email could not be sent. Resend it from the tenant’s Actions menu.'
          )
        }
        onDone(tenant)
      } catch (error) {
        const field = FIELD_FOR_CODE[codeFrom(error) ?? '']
        if (field) {
          serverErrors.setFieldError(field, [messageFrom(error)])
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
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Creating…' : 'Create tenant'}
        </Button>
      </DialogFooter>
    </Form>
  )
}
