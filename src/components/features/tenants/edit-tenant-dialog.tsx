import { useForm } from '@tanstack/react-form'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
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
import { useChangedFields } from '@/hooks/use-changed-fields'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { messageFrom, statusFrom } from '@/lib/api-error'
import { tenantAdminKeys } from '@/queries/tenant-admin.queries'
import { useUpdateTenant } from '@/queries/tenant.queries'
import { updateTenantSchema } from '@/schemas/tenant.schemas'
import type { PlatformTenantDetail } from '@/types/api.types'

/**
 * Name, description and website, through `PATCH /tenants/:slug` (the
 * tenant's own route, so it works only while the tenant is active). The slug
 * is the tenant's identity and is not editable. On success the platform
 * detail and lists refresh, since they carry the name.
 */
export function EditTenantDialog({
  tenant,
  open,
  onOpenChange,
}: {
  tenant: PlatformTenantDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit details</DialogTitle>
        </DialogHeader>
        {open && <EditTenantForm tenant={tenant} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

/**
 * The edit form. Only the fields the user changed from the tenant (as loaded
 * until the first edit, blur or save attempt, or as last saved) are checked
 * and sent, so a stored value that today's rules refuse does not block saving
 * the others, and a refetch that brings someone else's change does not send it
 * back. With nothing changed, Save sends nothing and asks for a change instead.
 * The changed fields are parsed before posting, so an emptied box goes over as
 * `null` and clears the column.
 */
function EditTenantForm({ tenant, onDone }: { tenant: PlatformTenantDetail; onDone: () => void }) {
  const update = useUpdateTenant(tenant.slug, tenant.id)
  const queryClient = useQueryClient()
  const serverErrors = useServerErrors()
  /** The schema's input type: TanStack needs the validator's input assignable to the form values. */
  const loaded: z.input<typeof updateTenantSchema> = {
    name: tenant.name,
    description: tenant.description ?? '',
    website: tenant.website ?? '',
  }
  const { baseline, changes, changedBody, listeners, rebase } = useChangedFields(
    updateTenantSchema,
    loaded,
    serverErrors,
    'Change a field before saving.'
  )
  const form = useForm({
    defaultValues: baseline,
    validators: { onSubmit: changes },
    listeners,
    onSubmit: async ({ value }) => {
      const body = changedBody(value)
      if (!body) return
      serverErrors.reset()
      try {
        await update.mutateAsync(body)
        rebase(value)
        await queryClient.invalidateQueries({ queryKey: tenantAdminKeys.detail(tenant.id) })
        await queryClient.invalidateQueries({ queryKey: tenantAdminKeys.all })
        toast.success('Details saved.')
        onDone()
      } catch (error) {
        if (statusFrom(error) === 403) {
          serverErrors.setFormErrors([messageFrom(error)])
          return
        }
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Form form={form} serverErrors={serverErrors} className="grid gap-4">
      {(['name', 'website'] as const).map((name) => (
        <FormField key={name} form={form} name={name}>
          {(field) => (
            <FormItem>
              <FormLabel>{name === 'name' ? 'Name' : 'Website'}</FormLabel>
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
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </Form>
  )
}
