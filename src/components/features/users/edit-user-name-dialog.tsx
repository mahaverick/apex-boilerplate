import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
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
import { useChangedFields } from '@/hooks/use-changed-fields'
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useUpdateUser } from '@/queries/user-admin.queries'
import { updateUserNameSchema } from '@/schemas/user-admin.schemas'
import type { PlatformUserDetail } from '@/types/api.types'

/**
 * A user's two name fields. Only a name changed from the stored names (as
 * loaded until the first edit, blur or save attempt, or as last saved) is
 * checked and sent, so a stored name that today's rules refuse does not block
 * changing the other, and a refetch does not send a stale name back. A field
 * emptied is sent as `null`, which clears it. Saving with nothing changed
 * sends nothing and asks for a change instead.
 */
export function EditUserNameDialog({
  user,
  open,
  onOpenChange,
}: {
  user: PlatformUserDetail
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const update = useUpdateUser()
  const serverErrors = useServerErrors()
  const { baseline, changes, changedBody, listeners, rebase } = useChangedFields(
    updateUserNameSchema,
    { firstName: user.firstName ?? '', lastName: user.lastName ?? '' },
    serverErrors,
    'Change a name before saving.'
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
        await update.mutateAsync({ userId: user.id, ...body })
        rebase(value)
        toast.success('Name updated.')
        onOpenChange(false)
      } catch (error) {
        serverErrors.capture(error)
      }
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit name</DialogTitle>
        </DialogHeader>
        <Form form={form} serverErrors={serverErrors}>
          <FormField form={form} name="firstName">
            {(field) => (
              <FormItem>
                <FormLabel>First name</FormLabel>
                <FormControl>
                  <Input
                    value={fieldValue(field.state.value)}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          </FormField>
          <FormField form={form} name="lastName">
            {(field) => (
              <FormItem>
                <FormLabel>Last name</FormLabel>
                <FormControl>
                  <Input
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
      </DialogContent>
    </Dialog>
  )
}
