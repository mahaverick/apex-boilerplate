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
import { fieldValue } from '@/hooks/use-form-field'
import { useServerErrors } from '@/hooks/use-server-errors'
import { useUpdateUser } from '@/queries/user-admin.queries'
import { updateUserNameSchema } from '@/schemas/user-admin.schemas'
import type { PlatformUserDetail } from '@/types/api.types'

/** A user's two name fields, as the profile page edits one's own. */
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
  const form = useForm({
    defaultValues: { firstName: user.firstName ?? '', lastName: user.lastName ?? '' },
    validators: { onSubmit: updateUserNameSchema },
    onSubmit: async ({ value }) => {
      serverErrors.reset()
      try {
        await update.mutateAsync({ userId: user.id, ...updateUserNameSchema.parse(value) })
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
